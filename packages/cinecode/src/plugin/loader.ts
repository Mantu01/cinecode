import { pathToFileURL } from "node:url";
import { resolve, isAbsolute } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createError, ErrorCode } from "../errors/codes.js";
import type { CinecodeConfig } from "../core/types/index.js";
import type { CinecodePlugin, PluginKind } from "./types.js";
import { PluginRegistry } from "./registry.js";

export interface LoadPluginOptions {
  readonly options?: Record<string, unknown>;
  readonly registry?: PluginRegistry;
  readonly rootDir?: string;
}

export interface PackagePluginInfo {
  readonly name: string;
  readonly version: string;
  readonly kind: PluginKind;
  readonly source: string;
  readonly main?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
}

function parseManifest(raw: unknown, source: string): PackagePluginInfo {
  const pkg = (raw ?? {}) as Record<string, unknown>;
  const cinecode = (pkg.cinecode ?? {}) as Record<string, unknown>;
  const name = typeof pkg.name === "string" ? pkg.name : typeof cinecode.name === "string" ? cinecode.name : source;
  const version = typeof pkg.version === "string" ? pkg.version : "0.0.0";
  const kind = (typeof cinecode.kind === "string" ? cinecode.kind : "effect") as PluginKind;
  const main = typeof pkg.main === "string" ? pkg.main : typeof cinecode.main === "string" ? cinecode.main : undefined;
  const dependencies = (pkg.dependencies ?? undefined) as Readonly<Record<string, string>> | undefined;
  return { name, version, kind, source, main, dependencies };
}

export function discoverPluginFromPackageJson(packageJsonPath: string): PackagePluginInfo | null {
  if (!existsSync(packageJsonPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    const pkg = (raw ?? {}) as Record<string, unknown>;
    const cinecode = (pkg.cinecode ?? undefined) as Record<string, unknown> | undefined;
    if (!cinecode && typeof pkg.name !== "string") return null;
    if (!cinecode && !(pkg as Record<string, unknown>).main) return null;
    if (!cinecode && typeof pkg.name === "string" && !pkg.name.includes("cinecode")) return null;
    return parseManifest(raw, packageJsonPath);
  } catch {
    return null;
  }
}

function semverParts(version: string): [number, number, number] {
  const cleaned = version.trim().replace(/^v/, "").split("-")[0]!.split(".");
  const major = Number.parseInt(cleaned[0] ?? "0", 10) || 0;
  const minor = Number.parseInt(cleaned[1] ?? "0", 10) || 0;
  const patch = Number.parseInt(cleaned[2] ?? "0", 10) || 0;
  return [major, minor, patch];
}

export function isCompatibleVersion(required: string, actual: string): boolean {
  const req = required.trim();
  if (req === "*" || req === "") return true;
  const [aMaj, aMin, aPat] = semverParts(actual);
  const operators: readonly ((">" | "<" | ">=" | "<=" | "^" | "~" | "=") | undefined)[] = [">=", "<=", ">", "<", "^", "~", "="];
  let op: string | undefined;
  let rest = req;
  for (const candidate of operators) {
    if (candidate && rest.startsWith(candidate)) {
      op = candidate;
      rest = rest.slice(candidate.length).trim();
      break;
    }
  }
  const [rMaj, rMin, rPat] = semverParts(rest || "0.0.0");
  const cmp = (x: readonly [number, number, number], y: readonly [number, number, number]): number =>
    x[0] !== y[0] ? x[0] - y[0] : x[1] !== y[1] ? x[1] - y[1] : x[2] - y[2];
  const actual3: [number, number, number] = [aMaj, aMin, aPat];
  const req3: [number, number, number] = [rMaj, rMin, rPat];
  const diff = cmp(actual3, req3);
  switch (op) {
    case undefined:
    case "=":
      return diff === 0;
    case ">":
      return diff > 0;
    case "<":
      return diff < 0;
    case ">=":
      return diff >= 0;
    case "<=":
      return diff <= 0;
    case "^":
      if (rMaj > 0) return aMaj === rMaj && diff >= 0;
      if (rMin > 0) return aMaj === 0 && aMin === rMin && diff >= 0;
      return aMaj === 0 && aMin === 0 && aPat === rPat;
    case "~":
      return aMaj === rMaj && aMin === rMin && diff >= 0;
    default:
      return diff === 0;
  }
}

import { checkPluginDeprecation, formatDeprecationNotice } from "./deprecation.js";

function validatePlugin(plugin: unknown, source: string): CinecodePlugin {
  if (!plugin || typeof plugin !== "object") {
    throw createError(ErrorCode.CC8001, { plugin: source, reason: "module does not export a plugin object" });
  }
  const candidate = plugin as Partial<CinecodePlugin> & { default?: Partial<CinecodePlugin> };
  const resolved = (candidate.manifest ? candidate : candidate.default && candidate.default.manifest ? candidate.default : candidate) as Partial<CinecodePlugin>;
  if (!resolved.manifest || typeof resolved.manifest !== "object") {
    throw createError(ErrorCode.CC8001, { plugin: source, reason: "plugin is missing a manifest" });
  }
  if (typeof resolved.manifest.name !== "string" || resolved.manifest.name.length === 0) {
    throw createError(ErrorCode.CC8001, { plugin: source, reason: "manifest.name must be a non-empty string" });
  }
  if (typeof resolved.manifest.version !== "string") {
    throw createError(ErrorCode.CC8001, { plugin: source, reason: "manifest.version must be a semver string" });
  }
  if (typeof resolved.manifest.kind !== "string") {
    throw createError(ErrorCode.CC8001, { plugin: source, reason: "manifest.kind must be a plugin kind" });
  }
  if (resolved.hooks && typeof resolved.hooks !== "object") {
    throw createError(ErrorCode.CC8001, { plugin: resolved.manifest.name, reason: "hooks must be an object" });
  }

  if (resolved.manifest.permissions && !Array.isArray(resolved.manifest.permissions)) {
    throw createError(ErrorCode.CC8001, { plugin: resolved.manifest.name, reason: "manifest.permissions must be an array of strings" });
  }
  if (resolved.manifest.minEngineVersion && !isCompatibleVersion(`>=${resolved.manifest.minEngineVersion}`, "1.0.0")) {
    throw createError(ErrorCode.CC8001, {
      plugin: resolved.manifest.name,
      reason: `requires Cinecode >=${resolved.manifest.minEngineVersion}, but running 1.0.0`,
    });
  }

  const deprecation = checkPluginDeprecation(resolved.manifest as any);
  if (deprecation.isDeprecated || deprecation.isIncompatible) {
    console.warn(formatDeprecationNotice(resolved.manifest as any, deprecation));
  }

  return resolved as CinecodePlugin;
}

export function parsePluginModule(mod: unknown, source: string): CinecodePlugin {
  const ns = (mod ?? {}) as Record<string, unknown>;
  const candidates = [ns.default, ns.plugin, ns];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && (candidate as Record<string, unknown>).manifest) {
      return validatePlugin(candidate, source);
    }
  }
  throw createError(ErrorCode.CC8001, { plugin: source, reason: "no plugin export found (expected default export with a manifest)" });
}

export async function loadPluginFromFile(filePath: string, options: LoadPluginOptions = {}): Promise<CinecodePlugin> {
  const base = options.rootDir ?? process.cwd();
  const resolved = isAbsolute(filePath) ? filePath : resolve(base, filePath);
  if (!existsSync(resolved)) {
    throw createError(ErrorCode.CC8001, { plugin: filePath, reason: `file not found: ${resolved}` });
  }
  let mod: unknown;
  try {
    mod = await import(pathToFileURL(resolved).href);
  } catch (error) {
    throw createError(ErrorCode.CC8001, { plugin: filePath, reason: error instanceof Error ? error.message : String(error) });
  }
  const plugin = parsePluginModule(mod, filePath);
  options.registry?.register(plugin, options.options ?? {}, resolved);
  return plugin;
}

export async function loadPluginFromPackage(packageName: string, options: LoadPluginOptions = {}): Promise<CinecodePlugin> {
  let mod: unknown;
  try {
    mod = await import(packageName);
  } catch (error) {
    throw createError(ErrorCode.CC8001, { plugin: packageName, reason: error instanceof Error ? error.message : String(error) });
  }
  const plugin = parsePluginModule(mod, packageName);
  options.registry?.register(plugin, options.options ?? {}, packageName);
  return plugin;
}

export async function loadPlugin(spec: string, options: LoadPluginOptions = {}): Promise<CinecodePlugin> {
  const looksLikePath =
    spec.startsWith("./") ||
    spec.startsWith("../") ||
    spec.startsWith("file:") ||
    isAbsolute(spec) ||
    /\.(m?js|c?js)$/.test(spec);
  return looksLikePath ? loadPluginFromFile(spec, options) : loadPluginFromPackage(spec, options);
}

export interface PluginDependencyIssue {
  readonly plugin: string;
  readonly dependency: string;
  readonly requirement: string;
  readonly found: string | null;
}

export function checkDependencies(plugins: readonly CinecodePlugin[]): readonly PluginDependencyIssue[] {
  const byName = new Map<string, CinecodePlugin>();
  for (const plugin of plugins) byName.set(plugin.manifest.name, plugin);
  const issues: PluginDependencyIssue[] = [];
  for (const plugin of plugins) {
    const deps = plugin.manifest.dependencies;
    if (!deps) continue;
    for (const [depName, requirement] of Object.entries(deps)) {
      const found = byName.get(depName);
      if (!found) {
        issues.push({ plugin: plugin.manifest.name, dependency: depName, requirement, found: null });
      } else if (!isCompatibleVersion(requirement, found.manifest.version)) {
        issues.push({ plugin: plugin.manifest.name, dependency: depName, requirement, found: found.manifest.version });
      }
    }
  }
  return issues;
}

export function assertDependencies(plugins: readonly CinecodePlugin[]): void {
  const issues = checkDependencies(plugins);
  const first = issues[0];
  if (!first) return;
  throw createError(
    ErrorCode.CC8004,
    { plugin: first.plugin, dependency: first.dependency, requirement: first.requirement, found: first.found ?? "not registered" },
    { fixHint: issues.length > 1 ? `and ${issues.length - 1} more dependency issue(s)` : "Register the required plugin version before this one." }
  );
}

export interface PluginConfigEntryLike {
  readonly source: string;
  readonly options?: Readonly<Record<string, unknown>>;
  readonly enabled?: boolean;
}

/**
 * Load every enabled plugin declared in `cinecode.config.ts`, validate
 * dependencies across the batch, then initialize the registry. Config entries
 * are the canonical plugin wiring for a project.
 */
export async function loadPluginsFromConfig(
  entries: readonly PluginConfigEntryLike[] | undefined,
  registry: PluginRegistry,
  options: { readonly rootDir?: string; readonly autoDiscover?: boolean } = {},
): Promise<readonly CinecodePlugin[]> {
  const loaded: CinecodePlugin[] = [];
  for (const entry of entries ?? []) {
    if (entry.enabled === false) continue;
    const plugin = await loadPlugin(entry.source, { options: entry.options ?? {}, registry, rootDir: options.rootDir });
    loaded.push(plugin);
  }

  if (options.autoDiscover !== false) {
    const { discoverPluginsDetailed } = await import("./discover.js");
    const result = await discoverPluginsDetailed(options.rootDir ?? process.cwd());
    for (const plugin of result.plugins) {
      if (registry.has(plugin.manifest.name)) continue;
      registry.register(plugin);
      loaded.push(plugin);
    }
  }

  if (loaded.length === 0) return [];
  assertDependencies(loaded);
  await registry.init();
  return loaded;
}

/** Loads explicitly configured plugins plus auto-discovered packages. */
export async function loadProjectPlugins(
  config: CinecodeConfig,
  registry: PluginRegistry,
  rootDir = process.cwd(),
): Promise<readonly CinecodePlugin[]> {
  registry.setAutoDiscovery(config.autoDiscoverPlugins !== false);
  registry.setPrecedence(config.pluginPrecedence ?? []);
  return loadPluginsFromConfig(config.plugins, registry, {
    rootDir,
    autoDiscover: config.autoDiscoverPlugins !== false,
  });
}
