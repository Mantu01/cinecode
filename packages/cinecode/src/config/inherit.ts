import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, isAbsolute, relative, join } from "node:path";
import type { CinecodeConfig, Composition } from "../core/types/index.js";
import { normalizeConfig } from "./schema.js";
import { findMissingEnvVarsWithPaths, substituteEnvVarsDeep } from "./envsubst.js";
import { hotReloadEnabled, isUserModuleFile, loadUserModule } from "../loader/index.js";
import { createError, ErrorCode } from "../errors/index.js";
import { PROJECT_MARKERS } from "./project.js";

export interface ResolvedInheritance {
  readonly merged: Record<string, unknown>;
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

export function findProjectBoundary(startPath: string): string {
  let current = dirname(resolve(startPath));
  for (;;) {
    if (PROJECT_MARKERS.some((marker) => existsSync(join(current, marker)))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return dirname(resolve(startPath));
    current = parent;
  }
}

async function resolveExtendsField(
  configPath: string,
  raw: RawRecord,
  chain: string[],
  visited: Set<string>,
  boundaryDir?: string,
): Promise<RawRecord> {
  const extendsPath = raw.extends;
  if (typeof extendsPath !== "string" || extendsPath.trim().length === 0) return raw;

  if (isAbsolute(extendsPath)) {
    throw createError(
      ErrorCode.CC1005,
      { path: extendsPath, reason: `Config extends path must be relative: "${extendsPath}"` },
      { location: { file: configPath }, fixHint: "Specify a relative path inside the project boundary (e.g. ./base.json)." },
    );
  }

  const target = resolve(dirname(configPath), extendsPath);
  const boundary = boundaryDir ? resolve(boundaryDir) : findProjectBoundary(configPath);
  const rel = relative(boundary, target);

  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw createError(
      ErrorCode.CC1005,
      { path: target, reason: `Config extends target "${extendsPath}" resolves outside project boundary: ${target}` },
      { location: { file: configPath }, fixHint: "Base configs must reside within the project root boundary." },
    );
  }

  if (!existsSync(target)) {
    throw createError(
      ErrorCode.CC1005,
      { path: target, reason: `Config extends target not found (${[...chain, target].join(" -> ")})` },
      { location: { file: target }, fixHint: "Ensure the base config file exists at the specified relative path." },
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
  const resolvedParent = await resolveExtendsField(target, parentRaw, chain, visited, boundary);
  return deepMergeConfig(resolvedParent, raw);
}

export async function resolveConfigInheritance(
  configPath: string,
  raw: RawRecord,
  boundaryDir?: string,
): Promise<ResolvedInheritance> {
  const resolvedConfigPath = resolve(configPath);
  const chain: string[] = [resolvedConfigPath];
  const visited = new Set<string>([resolvedConfigPath]);

  let merged = raw;
  if (typeof raw.extends === "string" && raw.extends.trim().length > 0) {
    merged = await resolveExtendsField(resolvedConfigPath, raw, chain, visited, boundaryDir);
  }

  return { merged, chain };
}

export async function mergeConfigInheritance(
  configPath: string,
  raw: RawRecord,
): Promise<RawRecord> {
  const { merged } = await resolveConfigInheritance(configPath, raw);
  return merged;
}

export async function resolveConfigChain(configPath: string): Promise<CinecodeConfig> {
  const raw = await readRawConfig(configPath);
  const merged = await mergeConfigInheritance(configPath, raw);
  return normalizeConfig(substituteEnvVarsDeep(merged));
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
