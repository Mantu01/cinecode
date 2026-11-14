import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, isAbsolute, extname } from "node:path";
import { pathToFileURL } from "node:url";
import type { CinecodeConfig, Composition } from "../core/types/index.js";
import { normalizeConfig } from "./schema.js";
import { substituteEnvVars, substituteEnvVarsDeep } from "./envsubst.js";

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
  const ext = extname(configPath).toLowerCase();
  if (ext === ".ts" || ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".mts") {
    const module = await import(pathToFileURL(configPath).href);
    return ((module.default ?? module) ?? {}) as RawRecord;
  }
  const text = substituteEnvVars(readFileSync(configPath, "utf-8"));
  return JSON.parse(text) as RawRecord;
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

function resolveExtendsField(configPath: string, raw: RawRecord, chain: string[], visited: Set<string>): RawRecord {
  const extendsPath = raw.extends;
  if (typeof extendsPath !== "string" || extendsPath.length === 0) return raw;
  const target = isAbsolute(extendsPath) ? extendsPath : resolve(dirname(configPath), extendsPath);
  if (!existsSync(target)) {
    throw new Error(`Config extends target not found: ${target}`);
  }
  if (visited.has(target)) {
    throw new Error(`Circular config inheritance detected: ${target}`);
  }
  visited.add(target);
  const parentRaw = substituteEnvVarsDeep(readRawConfigSync(target));
  const resolvedParent = resolveExtendsField(target, parentRaw, chain, visited);
  chain.push(target);
  return deepMergeConfig(resolvedParent, raw);
}

function readRawConfigSync(configPath: string): RawRecord {
  const ext = extname(configPath).toLowerCase();
  if (ext === ".ts" || ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".mts") {
    throw new Error(`Async config "${configPath}" cannot participate in extends chains loaded synchronously`);
  }
  const text = substituteEnvVars(readFileSync(configPath, "utf-8"));
  return JSON.parse(text) as RawRecord;
}

function extnameSync(path: string): string {
  let name = path;
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  if (slash >= 0) name = name.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
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
    merged = resolveExtendsField(resolve(configPath), raw, chain, visited);
  } else {
    for (const dir of baseDirs.map((entry) => resolve(entry))) {
      const baseFile = findBaseConfig(dir);
      if (baseFile && !visited.has(baseFile)) {
        visited.add(baseFile);
        chain.push(baseFile);
        const baseRaw = substituteEnvVarsDeep(readRawConfigSync(baseFile));
        merged = deepMergeConfig(baseRaw, merged);
      }
    }
    let currentDir = dirname(resolve(configPath));
    while (currentDir !== dirname(currentDir)) {
      currentDir = dirname(currentDir);
      const baseFile = findBaseConfig(currentDir);
      if (baseFile && !visited.has(baseFile)) {
        visited.add(baseFile);
        chain.push(baseFile);
        const baseRaw = substituteEnvVarsDeep(readRawConfigSync(baseFile));
        merged = deepMergeConfig(baseRaw, merged);
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
