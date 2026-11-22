import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface CinecodeGlobalConfig {
  aliases?: Record<string, string>;
  defaultProfile?: string;
}

export const ALIASES_ENV = "CINECODE_ALIASES";

export function getGlobalConfigPath(): string {
  const home = os.homedir();
  return path.join(home, ".cinecode", "config.json");
}

export function loadGlobalConfig(): CinecodeGlobalConfig {
  const cfgPath = getGlobalConfigPath();
  if (!fs.existsSync(cfgPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return {};
  }
}

export function saveGlobalConfig(config: CinecodeGlobalConfig): void {
  const cfgPath = getGlobalConfigPath();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), "utf8");
}

function readJson(file: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function aliasTable(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const table: Record<string, string> = {};
  for (const [name, expansion] of Object.entries(value as Record<string, unknown>)) {
    if (typeof expansion === "string" && expansion.trim() !== "") table[name] = expansion.trim();
  }
  return table;
}

/** Project tables: cinecode.json wins over package.json#cinecode.aliases. */
export function loadLocalAliases(projectDir = process.cwd()): Record<string, string> {
  const aliases: Record<string, string> = {};
  const pkg = readJson(path.join(projectDir, "package.json"));
  const pkgCinecode = pkg?.cinecode as Record<string, unknown> | undefined;
  Object.assign(aliases, aliasTable(pkgCinecode?.aliases));
  const local = readJson(path.join(projectDir, "cinecode.json"));
  Object.assign(aliases, aliasTable(local?.aliases));
  return aliases;
}

/** User-global table; only reached when alias expansion is enabled. */
export function loadGlobalAliases(): Record<string, string> {
  return aliasTable(loadGlobalConfig().aliases);
}

export function findProjectRoot(startDir = process.cwd()): string {
  let curr = path.resolve(startDir);
  while (true) {
    if (
      fs.existsSync(path.join(curr, "cinecode.config.ts")) ||
      fs.existsSync(path.join(curr, "cinecode.config.js")) ||
      fs.existsSync(path.join(curr, "cinecode.config.mjs")) ||
      fs.existsSync(path.join(curr, "cinecode.config.json")) ||
      fs.existsSync(path.join(curr, "cinecode.json"))
    ) {
      return curr;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return path.resolve(startDir);
}

export function loadAliases(projectDir = process.cwd()): Record<string, string> {
  const local = loadLocalAliases(projectDir);
  const global = loadGlobalAliases();
  if (Object.keys(global).length > 0) {
    process.stderr.write("Note: Global CLI aliases detected. Run 'cinecode alias migrate' to copy them to project-local cinecode.json.\n");
  }
  return { ...global, ...local };
}

export function aliasesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ALIASES_ENV] === "1";
}

/** Opt-in: an empty table unless CINECODE_ALIASES=1. */
export function loadEnabledAliases(projectDir = process.cwd(), env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return aliasesEnabled(env) ? loadAliases(projectDir) : {};
}

export function setAlias(name: string, expansion: string, projectDir?: string): void {
  const root = projectDir ? path.resolve(projectDir) : findProjectRoot();
  const file = path.join(root, "cinecode.json");
  const local = readJson(file) ?? {};
  const aliases = aliasTable(local.aliases);
  aliases[name] = expansion;
  local.aliases = aliases;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(local, null, 2), "utf8");
}

export function removeAlias(name: string, projectDir?: string): boolean {
  const root = projectDir ? path.resolve(projectDir) : findProjectRoot();
  const file = path.join(root, "cinecode.json");
  const local = readJson(file) ?? {};
  const aliases = aliasTable(local.aliases);
  if (!(name in aliases)) return false;
  delete aliases[name];
  local.aliases = aliases;
  fs.writeFileSync(file, JSON.stringify(local, null, 2), "utf8");
  return true;
}

export function migrateGlobalAliases(projectDir?: string): { migrated: string[] } {
  const global = loadGlobalAliases();
  const keys = Object.keys(global);
  if (keys.length === 0) return { migrated: [] };

  const root = projectDir ? path.resolve(projectDir) : findProjectRoot();
  const file = path.join(root, "cinecode.json");
  const existing = readJson(file) ?? {};
  existing.aliases = { ...global, ...aliasTable(existing.aliases) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(existing, null, 2), "utf8");

  const cfg = loadGlobalConfig();
  delete cfg.aliases;
  saveGlobalConfig(cfg);

  return { migrated: keys };
}

export interface AliasResolution {
  readonly args: string[];
  readonly applied: readonly string[];
}

const MAX_ALIAS_DEPTH = 3;

/**
 * Expands the command-position token through the alias tables. Bounded,
 * cycle-safe, never rewrites a known command and never starts from an option.
 */
export function resolveAliases(
  args: readonly string[],
  aliases: Readonly<Record<string, string>> = {},
  isKnown: (name: string) => boolean = () => false,
  tokenIndex = 0,
): AliasResolution {
  const applied: string[] = [];
  const seen = new Set<string>();
  const result = [...args];
  for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth += 1) {
    const first = result[tokenIndex];
    if (!first || first.startsWith("-") || seen.has(first) || isKnown(first)) break;
    const expansion = aliases[first];
    if (!expansion) break;
    const parts = expansion.split(/\s+/).filter(Boolean);
    applied.push(`${first} = ${expansion}`);
    if (parts.length === 0 || parts[0]!.startsWith("-")) break;
    seen.add(first);
    result.splice(tokenIndex, 1, ...parts);
  }
  return { args: result, applied };
}

export function expandCliArgs(
  args: string[],
  projectDir = process.cwd(),
  isKnown: (name: string) => boolean = () => false,
): string[] {
  return resolveAliases(args, loadEnabledAliases(projectDir), isKnown).args;
}
