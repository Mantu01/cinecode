import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import type { CinecodeConfig, Composition } from "../core/types/index.js";
import { normalizeConfig } from "./schema.js";
import { findMissingEnvVarsWithPaths, substituteEnvVarsDeep } from "./envsubst.js";
import { hotReloadEnabled, isUserModuleFile, loadUserModule } from "../loader/index.js";
import { createError, ErrorCode } from "../errors/index.js";

const BASE_CONFIG_FILES = ["cinecode.base.json", "cinecode.base.ts", "cinecode.base.js", "cinecode.base.mjs", ".cinecode.base.json"];

export interface ResolvedRawConfig {
  readonly raw: Record<string, unknown>;
  readonly chain: readonly string[];
}

type RawRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is RawRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deepMergeConfig(base: RawRecord, override: RawRecord): RawRecord {
  const result: RawRecord = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMergeConfig(existing, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function readRawConfig(configPath: string): Promise<RawRecord> {
  if (isUserModuleFile(configPath)) {
    const module = await loadUserModule<RawRecord>(configPath, dirname(configPath), { fresh: hotReloadEnabled() });
    return module ?? {};
  }
  return JSON.parse(readFileSync(configPath, "utf-8")) as RawRecord;
}

async function readConfigDocument(configPath: string): Promise<RawRecord> {
  const raw = await readRawConfig(configPath);
  const missing = findMissingEnvVarsWithPaths(raw);
  if (missing.length > 0) {
    const entry = missing[0]!;
    throw createError(
      ErrorCode.CC1005,
      { path: configPath, reason: `Missing required environment variable '${entry.name}' referenced at ${entry.path}` },
      { location: { file: configPath }, fixHint: `export ${entry.name}=... and rerun.` },
    );
  }
  return substituteEnvVarsDeep(raw);
}

function findBaseConfig(startDir: string): string | null {
  let current = startDir;
  for (;;) {
    for (const candidate of BASE_CONFIG_FILES) {
      const full = resolve(current, candidate);
      if (existsSync(full)) return full;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function resolveExtendsField(configPath: string, raw: RawRecord, chain: string[], visited: Set<string>): Promise<RawRecord> {
  const extendsPath = raw.extends;
  if (typeof extendsPath !== "string" || extendsPath.length === 0) return raw;
  const target = isAbsolute(extendsPath) ? extendsPath : resolve(dirname(configPath), extendsPath);
  if (!existsSync(target)) {
    throw createError(
      ErrorCode.CC1005,
      { path: target, reason: `Config extends target not found (${[...chain, target].join(" -> ")})` },
      { location: { file: target } },
    );
  }
  if (visited.has(target)) {
    throw createError(
      ErrorCode.CC1005,
      { path: target, reason: `Circular config inheritance: ${[...chain, target].join(" -> ")}` },
      { location: { file: target }, fixHint: "Remove the extends cycle; configs merge base then override." },
    );
  }
  visited.add(target);
  chain.push(target);
  const parentRaw = await readConfigDocument(target);
  const resolvedParent = await resolveExtendsField(target, parentRaw, chain, visited);
  return deepMergeConfig(resolvedParent, raw);
}

export async function resolveConfigChain(configPath: string, baseDirs: readonly string[] = []): Promise<CinecodeConfig> {
  const raw = await readRawConfig(configPath);
  const merged = await mergeConfigInheritance(configPath, raw, baseDirs);
  return normalizeConfig(substituteEnvVarsDeep(merged));
}

export async function mergeConfigInheritance(
  configPath: string,
  raw: RawRecord,
  baseDirs: readonly string[] = [],
): Promise<RawRecord> {
  const chain: string[] = [resolve(configPath)];
  let merged = raw;
  const visited = new Set<string>([resolve(configPath)]);

  if (typeof raw.extends === "string" && raw.extends.length > 0) {
    merged = await resolveExtendsField(resolve(configPath), raw, chain, visited);
  } else {
    for (const dir of baseDirs.map((entry) => resolve(entry))) {
      const baseFile = findBaseConfig(dir);
      if (baseFile && !visited.has(baseFile)) {
        visited.add(baseFile);
        chain.push(baseFile);
        merged = deepMergeConfig(await readConfigDocument(baseFile), merged);
      }
    }
    let currentDir = dirname(resolve(configPath));
    while (currentDir !== dirname(currentDir)) {
      currentDir = dirname(currentDir);
      const baseFile = findBaseConfig(currentDir);
      if (baseFile && !visited.has(baseFile)) {
        visited.add(baseFile);
        chain.push(baseFile);
        merged = deepMergeConfig(await readConfigDocument(baseFile), merged);
      }
    }
  }

  return merged;
}

function isMergeableObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeArrays(base: readonly unknown[], override: readonly unknown[]): readonly unknown[] {
  const baseContained = base.every((item) => override.includes(item));
  return baseContained ? override : [...base, ...override];
}

function mergeCompositionValues(base: unknown, override: unknown): unknown {
  if (override === undefined) return base;
  if (Array.isArray(base) && Array.isArray(override)) return mergeArrays(base, override);
  if (isMergeableObject(base) && isMergeableObject(override)) {
    const result: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
      result[key] = mergeCompositionValues(base[key], value);
    }
    return result;
  }
  return override;
}

export function extendComposition(base: Composition, overrides: Partial<Composition>): Composition {
  return mergeCompositionValues(base, overrides) as Composition;
}

export function extendCompositionProps(
  base: Composition,
  overrides: Partial<Composition>,
): Composition {
  return extendComposition(base, overrides);
}
