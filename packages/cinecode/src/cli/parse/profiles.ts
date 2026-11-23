import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILENAMES } from "../../config/project.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { asManifestId } from "../../manifest/ids.js";

export const ALIASES_ENV = "CINECODE_ALIASES";
export const ALIAS_STORE = "cinecode.json";
export const MAX_ALIAS_DEPTH = 3;

export function loadLocalAliases(projectDir = process.cwd()): Record<string, string> {
  const file = path.join(projectDir, ALIAS_STORE);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { aliases?: unknown };
    return aliasTable(parsed.aliases);
  } catch {
    return {};
  }
}

export function findProjectRoot(startDir = process.cwd()): string {
  let current = path.resolve(startDir);
  while (true) {
    if (CONFIG_FILENAMES.some((name) => fs.existsSync(path.join(current, name)))) return current;
    if (fs.existsSync(path.join(current, ALIAS_STORE))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(startDir);
}

export function loadAliases(projectDir = process.cwd()): Record<string, string> {
  return loadLocalAliases(projectDir);
}

export function aliasesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ALIASES_ENV] === "1";
}

export function loadEnabledAliases(projectDir = process.cwd(), env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return aliasesEnabled(env) ? loadAliases(projectDir) : {};
}

function aliasTable(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const table: Record<string, string> = {};
  for (const [name, expansion] of Object.entries(value as Record<string, unknown>)) {
    if (typeof expansion === "string" && expansion.trim() !== "") table[name] = expansion.trim();
  }
  return table;
}

function readStore(root: string): Record<string, unknown> {
  const file = path.join(root, ALIAS_STORE);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeStore(root: string, store: Record<string, unknown>): void {
  fs.writeFileSync(path.join(root, ALIAS_STORE), JSON.stringify(store, null, 2), "utf8");
}

function validateExpansion(name: string, expansion: string, aliases: Record<string, string>, isKnown: (name: string) => boolean): void {
  const parts = expansion.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw createError(ErrorCode.CC0001, { reason: `Alias '${name}' needs an expansion, e.g. 'render --all'.` });
  }
  if (parts[0]!.startsWith("-")) {
    throw createError(ErrorCode.CC0001, { reason: `Alias '${name}' expansion must start with a command, not an option.` });
  }
  for (const part of parts) {
    if (part.includes("\n") || part.includes("\r")) {
      throw createError(ErrorCode.CC0001, { reason: `Alias '${name}' expansion must be a single line.` });
    }
  }
  const chain: string[] = [name];
  let current = parts[0]!;
  for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth += 1) {
    if (isKnown(current)) return;
    if (chain.includes(current)) {
      throw createError(ErrorCode.CC0001, { reason: `Alias cycle detected: ${[...chain, current].join(" -> ")}.` });
    }
    const next = aliases[current];
    if (!next) return;
    chain.push(current);
    current = next.split(/\s+/).filter(Boolean)[0] ?? "";
    if (!current) return;
  }
  if (!isKnown(current) && chain.length >= MAX_ALIAS_DEPTH) {
    throw createError(ErrorCode.CC0001, { reason: `Alias chain for '${name}' exceeds ${MAX_ALIAS_DEPTH} expansions.` });
  }
}

export function setAlias(
  name: string,
  expansion: string,
  projectDir?: string,
  isKnown: (name: string) => boolean = () => false,
): void {
  asManifestId(name, "alias");
  if (isKnown(name)) {
    throw createError(ErrorCode.CC0001, { reason: `Alias '${name}' would shadow the real command '${name}'.` });
  }
  const root = projectDir ? path.resolve(projectDir) : findProjectRoot();
  const store = readStore(root);
  const aliases = aliasTable(store.aliases);
  validateExpansion(name, expansion, aliases, isKnown);
  aliases[name] = expansion;
  store.aliases = aliases;
  fs.mkdirSync(path.dirname(path.join(root, ALIAS_STORE)), { recursive: true });
  writeStore(root, store);
}

export function removeAlias(name: string, projectDir?: string): boolean {
  asManifestId(name, "alias");
  const root = projectDir ? path.resolve(projectDir) : findProjectRoot();
  const store = readStore(root);
  const aliases = aliasTable(store.aliases);
  if (!(name in aliases)) return false;
  delete aliases[name];
  store.aliases = aliases;
  writeStore(root, store);
  return true;
}

export function migrateLegacyAliases(projectDir?: string): { migrated: string[] } {
  const root = projectDir ? path.resolve(projectDir) : findProjectRoot();
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return { migrated: [] };
  let legacy: Record<string, string> = {};
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { cinecode?: { aliases?: unknown } };
    legacy = aliasTable(pkg.cinecode?.aliases);
  } catch {
    return { migrated: [] };
  }
  const keys = Object.keys(legacy);
  if (keys.length === 0) return { migrated: [] };
  const store = readStore(root);
  store.aliases = { ...legacy, ...aliasTable(store.aliases) };
  writeStore(root, store);
  return { migrated: keys };
}

export interface AliasResolution {
  readonly args: string[];
  readonly applied: readonly string[];
}

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
