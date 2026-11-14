import { readdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CinecodePlugin, PluginKind, PluginManifest } from "./types.js";
import { parsePluginModule } from "./loader.js";

export interface DiscoveredPlugin {
  readonly packageName: string;
  readonly packagePath: string;
  readonly entryPoint: string;
  readonly kinds: readonly PluginKind[];
}

export interface DiscoveryResult {
  readonly plugins: readonly CinecodePlugin[];
  readonly discovered: readonly DiscoveredPlugin[];
  readonly warnings: readonly string[];
}

const SKIP_PACKAGES = new Set([".bin", ".cache", ".modules.yaml", ".pnpm", "@types", "@typescript", "typescript", "esbuild"]);
const ENTRY_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts"]);
const VALID_KINDS: readonly PluginKind[] = [
  "effect",
  "transition",
  "audioProcessor",
  "mediaSource",
  "renderer",
  "command",
  "encoder",
  "decoder",
  "imageProcessor",
];

interface PackageMarker {
  readonly entries: readonly string[];
  readonly kinds: readonly PluginKind[];
}

function isKind(value: unknown): value is PluginKind {
  return typeof value === "string" && (VALID_KINDS as readonly string[]).includes(value);
}

function normalizeKinds(value: unknown): PluginKind[] {
  if (typeof value === "string") return isKind(value) ? [value] : [];
  if (Array.isArray(value)) return value.filter(isKind);
  return [];
}

function normalizeEntries(value: unknown): string[] {
  if (typeof value === "string" && value.length > 0) return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return [];
}

export function readPackageMarker(raw: unknown): PackageMarker | null {
  if (!raw || typeof raw !== "object") return null;
  const pkg = raw as Record<string, unknown>;
  const pluginMarker = pkg.cinecodePlugin as Record<string, unknown> | undefined;
  const cinecode = pkg.cinecode as Record<string, unknown> | undefined;
  const entries: string[] = [];
  const kinds: PluginKind[] = [];

  if (pluginMarker) {
    entries.push(...normalizeEntries(pluginMarker.entry), ...normalizeEntries(pluginMarker.entries));
    kinds.push(...normalizeKinds(pluginMarker.kind), ...normalizeKinds(pluginMarker.kinds));
  }

  if (cinecode) {
    entries.push(...normalizeEntries(cinecode.plugins), ...normalizeEntries(cinecode.entry));
    kinds.push(...normalizeKinds(cinecode.kind), ...normalizeKinds(cinecode.kinds));
  }

  if (entries.length === 0 && (pluginMarker || cinecode)) {
    const main = typeof pkg.module === "string" ? pkg.module : typeof pkg.main === "string" ? pkg.main : undefined;
    if (main) entries.push(main);
  }

  if (entries.length === 0) return null;
  return { entries: [...new Set(entries)], kinds: [...new Set(kinds)] };
}

async function readPackageJson(packageDir: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(packageDir, "package.json"), "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function scanNodeModules(
  nodeModulesDir: string,
  warnings: string[],
  results: DiscoveredPlugin[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(nodeModulesDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_PACKAGES.has(entry.name)) continue;
    const isDirectory = entry.isDirectory() || entry.isSymbolicLink();
    if (!isDirectory) continue;
    const fullPath = join(nodeModulesDir, entry.name);

    if (entry.name.startsWith("@")) {
      let scoped;
      try {
        scoped = await readdir(fullPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of scoped) {
        if (!(child.isDirectory() || child.isSymbolicLink())) continue;
        await inspectPackage(join(fullPath, child.name), `${entry.name}/${child.name}`, warnings, results);
      }
      continue;
    }

    await inspectPackage(fullPath, entry.name, warnings, results);
  }
}

async function inspectPackage(
  packageDir: string,
  packageName: string,
  warnings: string[],
  results: DiscoveredPlugin[],
): Promise<void> {
  const pkg = await readPackageJson(packageDir);
  if (!pkg) return;
  const marker = readPackageMarker(pkg);
  if (!marker) return;

  for (const relativeEntry of marker.entries) {
    const entryPoint = resolve(packageDir, relativeEntry);
    if (!existsSync(entryPoint)) {
      warnings.push(`Skipped ${packageName}: entry point not found (${relativeEntry})`);
      continue;
    }
    const ext = extname(entryPoint).toLowerCase();
    if (!ENTRY_EXTENSIONS.has(ext)) {
      warnings.push(`Skipped ${packageName}: unsupported entry extension ${ext}`);
      continue;
    }
    const kinds = marker.kinds.length > 0 ? marker.kinds : inferKindsFromName(packageName);
    results.push({ packageName, packagePath: packageDir, entryPoint, kinds });
  }
}

function inferKindsFromName(packageName: string): PluginKind[] {
  const name = packageName.toLowerCase();
  if (name.includes("transition")) return ["transition"];
  if (name.includes("audio")) return ["audioProcessor"];
  if (name.includes("encoder")) return ["encoder"];
  return ["effect"];
}

export async function discoverPluginsDetailed(baseDir: string): Promise<DiscoveryResult> {
  const plugins: CinecodePlugin[] = [];
  const discovered: DiscoveredPlugin[] = [];
  const warnings: string[] = [];
  const seenNames = new Set<string>();
  const seenEntries = new Set<string>();

  let current = resolve(baseDir);
  for (;;) {
    const nodeModules = join(current, "node_modules");
    if (existsSync(nodeModules)) {
      const found: DiscoveredPlugin[] = [];
      await scanNodeModules(nodeModules, warnings, found);
      for (const entry of found) {
        if (seenEntries.has(entry.entryPoint)) continue;
        seenEntries.add(entry.entryPoint);
        discovered.push(entry);
        try {
          const mod = await import(pathToFileURL(entry.entryPoint).href);
          const plugin = parsePluginModule(mod, entry.entryPoint);
          if (seenNames.has(plugin.manifest.name)) continue;
          seenNames.add(plugin.manifest.name);
          plugins.push(plugin);
        } catch (error) {
          warnings.push(
            `Failed to load ${entry.packageName}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    if (existsSync(join(current, ".git"))) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  await discoverLocalPlugins(baseDir, plugins, warnings, seenNames, seenEntries);

  return { plugins, discovered, warnings };
}

async function discoverLocalPlugins(
  root: string,
  plugins: CinecodePlugin[],
  warnings: string[],
  seenNames: Set<string>,
  seenEntries: Set<string>,
): Promise<void> {
  const localPluginsDir = join(resolve(root), "plugins");
  if (!existsSync(localPluginsDir)) return;
  let files;
  try {
    files = await readdir(localPluginsDir, { withFileTypes: true });
  } catch (error) {
    warnings.push(`Failed to scan plugins directory: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  for (const entry of files) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (!ENTRY_EXTENSIONS.has(ext)) continue;
    const filePath = join(localPluginsDir, entry.name);
    if (seenEntries.has(filePath)) continue;
    seenEntries.add(filePath);
    try {
      const mod = await import(pathToFileURL(filePath).href);
      const plugin = parsePluginModule(mod, filePath);
      if (seenNames.has(plugin.manifest.name)) continue;
      seenNames.add(plugin.manifest.name);
      plugins.push(plugin);
    } catch (error) {
      warnings.push(`Failed to load plugin ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export async function discoverPlugins(baseDir: string): Promise<readonly CinecodePlugin[]> {
  const { plugins, warnings } = await discoverPluginsDetailed(baseDir);
  for (const warning of warnings) {
    console.warn(`[cinecode:plugin] ${warning}`);
  }
  return plugins;
}

export function manifestFromPackageJson(packageDir: string): PluginManifest | null {
  const jsonPath = join(packageDir, "package.json");
  if (!existsSync(jsonPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(jsonPath, "utf-8")) as Record<string, unknown>;
    const marker = readPackageMarker(raw);
    if (!marker) return null;
    return {
      name: typeof raw.name === "string" ? raw.name : "unknown",
      version: typeof raw.version === "string" ? raw.version : "0.0.0",
      kind: marker.kinds[0] ?? "effect",
      main: marker.entries[0],
    };
  } catch {
    return null;
  }
}
