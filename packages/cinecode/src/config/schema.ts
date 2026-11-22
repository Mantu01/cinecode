import { existsSync, readFileSync } from "node:fs";
import { resolve, extname, isAbsolute, dirname } from "node:path";
import type {
  CinecodeConfig,
  DevConfig,
  ImageConfig,
  PluginConfigEntry,
  ProjectConfig,
  RenderConfig,
  VideoConfig,
} from "../core/types/index.js";
import { findMissingEnvVarsWithPaths, substituteEnvVarsDeep, type MissingEnvVar } from "./envsubst.js";
import { resolveConfigInheritance, mergeConfigInheritance } from "./inherit.js";
import { isUserModuleFile, loadUserModule } from "../loader/index.js";
import { createError, ErrorCode, isCinecodeError } from "../errors/index.js";
import { RESOLUTION_DIMENSIONS, SCHEMA_VERSION } from "./zod-schema.js";

export { SCHEMA_VERSION };
import {
  validateAuthoringConfig,
  validateNormalizedConfig,
  assertNotCompositionExport,
  assertNoConflictingAliases,
} from "./validator.js";
import { rootOfConfig, validateProjectRoots } from "./roots.js";
import { migrateV1ToV2Transform } from "./migration/engine.js";

export interface LoadConfigOptions {
  readonly configPath?: string;
  readonly fresh?: boolean;
  /** Project root the four roots resolve against; defaults to the config folder. */
  readonly root?: string;
}

import {
  DEFAULT_PROJECT,
  DEFAULT_VIDEO,
  DEFAULT_IMAGES,
  DEFAULT_DEV,
  DEFAULT_AUDIO,
  DEFAULT_RENDER,
  DEFAULT_COLOR_MANAGEMENT,
  DEFAULT_CHUNK_SIZE,
  calculateAdaptiveChunkSize,
  DEFAULTS,
} from "./defaults.js";

export {
  DEFAULT_PROJECT,
  DEFAULT_VIDEO,
  DEFAULT_IMAGES,
  DEFAULT_DEV,
  DEFAULT_AUDIO,
  DEFAULT_RENDER,
  DEFAULT_COLOR_MANAGEMENT,
  DEFAULT_CHUNK_SIZE,
  calculateAdaptiveChunkSize,
  DEFAULTS,
};

export const DEFAULT_CONFIG: CinecodeConfig = {
  schemaVersion: SCHEMA_VERSION,
  project: DEFAULT_PROJECT,
  video: DEFAULT_VIDEO,
  images: DEFAULT_IMAGES,
  dev: DEFAULT_DEV,
  sourceDir: DEFAULT_PROJECT.sourceDir,
  mediaDir: DEFAULT_PROJECT.mediaDir,
  outputDir: DEFAULT_PROJECT.outputDir,
  cacheDir: DEFAULT_PROJECT.cacheDir,
  cloudMedia: [],
  render: DEFAULT_RENDER,
  audio: DEFAULT_AUDIO,
  fonts: [],
  concurrency: "auto",
  overwrite: false,
  gitignore: true,
  plugins: [],
  pluginPrecedence: [],
  autoDiscoverPlugins: true,
  ignorePatterns: [],
};

export function getDefaultConfig(): CinecodeConfig {
  return DEFAULT_CONFIG;
}

export interface ConfigFieldTrace {
  readonly path: string;
  readonly value: unknown;
  readonly source: "explicit" | "inherited" | "default";
  readonly chain: readonly string[];
}

/** The loader's result: the normalized config plus the keys the author actually wrote and the resolution trace. */
export interface LoadedConfig {
  readonly config: CinecodeConfig;
  readonly explicit: ReadonlySet<string>;
  readonly trace: ReadonlyMap<string, ConfigFieldTrace>;
}

function buildResolutionTrace(
  config: CinecodeConfig,
  explicit: ReadonlySet<string>,
  chain: readonly string[],
  configPath: string,
): ReadonlyMap<string, ConfigFieldTrace> {
  const trace = new Map<string, ConfigFieldTrace>();

  function record(path: string, val: unknown): void {
    if (val === undefined) return;
    const isExplicit = explicit.has(path);
    const source: "explicit" | "inherited" | "default" = isExplicit
      ? "explicit"
      : chain.length > 1
        ? "inherited"
        : "default";
    const fieldChain = isExplicit ? [configPath] : chain.length > 1 ? chain : ["defaults"];
    trace.set(path, { path, value: val, source, chain: fieldChain });
  }

  function walk(prefix: string, obj: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        walk(p, v as Record<string, unknown>);
      } else {
        record(p, v);
      }
    }
  }

  walk("", config as unknown as Record<string, unknown>);
  return trace;
}

/** Authoring paths present in a source document, for the precedence engine. */
export function explicitPathsOf(raw: unknown): ReadonlySet<string> {
  return new Set(collectExplicitPaths(raw ?? {}));
}

function collectExplicitPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return prefix ? [prefix] : [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectExplicitPaths(entry, `${prefix}[${index}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectExplicitPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

export async function loadConfigDocument(
  configPath: string,
  options: LoadConfigOptions = {},
): Promise<LoadedConfig> {
  const resolvedPath = resolve(configPath);
  const ext = extname(resolvedPath).toLowerCase();

  let rawConfig: Record<string, unknown>;

  try {
    if (isUserModuleFile(resolvedPath)) {
      rawConfig = await loadUserModule<Record<string, unknown>>(resolvedPath, dirname(resolvedPath), { fresh: options.fresh });
    } else if (ext === ".json") {
      const rawText = readFileSync(resolvedPath, "utf-8");
      try {
        rawConfig = JSON.parse(rawText);
      } catch (parseError) {
        throw createError(
          ErrorCode.CC1006,
          { path: resolvedPath, reason: parseError instanceof Error ? parseError.message : String(parseError) },
          { location: { file: resolvedPath }, cause: parseError },
        );
      }
    } else {
      throw createError(ErrorCode.CC1007, { path: resolvedPath }, { location: { file: resolvedPath } });
    }
  } catch (e) {
    if (isCinecodeError(e)) throw e;
    const reason = e instanceof Error ? e.message : String(e);
    throw createError(
      ErrorCode.CC1005,
      { path: resolvedPath, reason },
      { location: { file: resolvedPath }, cause: e },
    );
  }

  try {
    assertNotCompositionExport(rawConfig, resolvedPath);

    // Schema-version handling: v1 migrated in-memory to v2 with warning, invalid versions rejected
    if (rawConfig.schemaVersion === 1) {
      migrateV1ToV2Transform(rawConfig);
      rawConfig.schemaVersion = SCHEMA_VERSION;
    } else if (
      rawConfig.schemaVersion !== undefined &&
      rawConfig.schemaVersion !== SCHEMA_VERSION
    ) {
      throw createError(
        ErrorCode.CC1004,
        { version: String(rawConfig.schemaVersion), expected: String(SCHEMA_VERSION) },
        {
          location: { file: resolvedPath },
          fixHint: `This Cinecode release supports schema version ${SCHEMA_VERSION}; upgrade cinecode or lower schemaVersion.`,
        },
      );
    }

    assertEnvVarsPresent(findMissingEnvVarsWithPaths(rawConfig), resolvedPath);
    const withEnv = substituteEnvVarsDeep(rawConfig);
    const { merged, chain } = await resolveConfigInheritance(resolvedPath, withEnv, options.root);

    assertNoConflictingAliases(merged, resolvedPath);
    assertAuthoringSchema(merged, resolvedPath);

    const config = normalizeConfig(merged);
    const normalized = validateNormalizedConfig(config, resolvedPath);
    if (normalized.errors.length > 0) throw normalized.errors[0];

    const rootErrors = validateProjectRoots(options.root ?? rootOfConfig(resolvedPath), config, {
      configPath: resolvedPath,
    });
    if (rootErrors.length > 0) {
      (rootErrors[0] as { issues?: readonly unknown[] }).issues = rootErrors;
      throw rootErrors[0];
    }

    const { setBinaryConfig } = await import("../binary/resolver.js");
    setBinaryConfig({
      ffmpegPath: config.binaries?.ffmpegPath,
      ffprobePath: config.binaries?.ffprobePath,
      root: options.root ?? rootOfConfig(resolvedPath),
    });

    const explicit = explicitPathsOf(merged);
    const trace = buildResolutionTrace(config, explicit, chain, resolvedPath);

    // Freeze validated configuration so downstream code cannot mutate it
    Object.freeze(config.project);
    Object.freeze(config.video);
    Object.freeze(config.images);
    Object.freeze(config.dev);
    Object.freeze(config.render);
    Object.freeze(config.audio);
    Object.freeze(config);

    return { config, explicit, trace };
  } catch (e) {
    if (isCinecodeError(e)) throw e;
    const reason = e instanceof Error ? e.message : String(e);
    throw createError(
      ErrorCode.CC1005,
      { path: resolvedPath, reason },
      { location: { file: resolvedPath }, cause: e },
    );
  }
}

export async function loadConfig(configPath: string, options: LoadConfigOptions = {}): Promise<CinecodeConfig> {
  return (await loadConfigDocument(configPath, options)).config;
}

function assertAuthoringSchema(raw: Record<string, unknown>, configPath: string): void {
  const { errors } = validateAuthoringConfig(raw, configPath);
  if (errors.length > 0) throw errors[0];
}

function assertEnvVarsPresent(missing: readonly MissingEnvVar[], configPath: string): void {
  if (missing.length === 0) return;
  const list = missing.map((entry) => `'${entry.name}' (at ${entry.path})`).join(", ");
  throw createError(
    ErrorCode.CC1005,
    {
      path: configPath,
      reason: `Missing required environment variable${missing.length > 1 ? "s" : ""} ${list}. Set ${missing.length > 1 ? "them" : "it"} before running cinecode: export ${missing[0]!.name}=...`,
    },
    { location: { file: configPath } },
  );
}

function normalizePluginEntries(raw: unknown): PluginConfigEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => (typeof entry === "string" ? { source: entry } : (entry as PluginConfigEntry)));
}

export function normalizeConfig(raw: Record<string, unknown>): CinecodeConfig {
  const rawProject = (raw.project as Partial<ProjectConfig> | undefined) ?? {};
  const rawVideo = (raw.video as Partial<VideoConfig> | undefined) ?? {};
  const rawImages = (raw.images as Partial<ImageConfig> | undefined) ?? {};
  const rawDev = (raw.dev as Partial<DevConfig> | undefined) ?? {};
  const rawRender = (raw.render as Partial<RenderConfig> | undefined) ?? {};
  const rawAudio = (raw.audio as CinecodeConfig["audio"]) ?? {};
  const rawBinaries = raw.binaries as CinecodeConfig["binaries"] | undefined;

  const entry =
    rawProject.entry ??
    (raw.entry as string | undefined) ??
    DEFAULT_PROJECT.entry;

  const sourceDir =
    rawProject.sourceDir ??
    (raw.sourceDir as string | undefined) ??
    DEFAULT_PROJECT.sourceDir;

  const mediaDir =
    rawProject.mediaDir ??
    (raw.mediaDir as string | undefined) ??
    DEFAULT_PROJECT.mediaDir;

  const outputDir =
    rawProject.outputDir ??
    (raw.outputDir as string | undefined) ??
    DEFAULT_PROJECT.outputDir;

  const cacheDir =
    rawProject.cacheDir ??
    (raw.cacheDir as string | undefined) ??
    DEFAULT_PROJECT.cacheDir;

  const allowCoLocatedMedia =
    (raw.allowCoLocatedMedia as boolean | undefined) ?? false;

  // Resolution may come from the v2 `video` block, a legacy `render.resolution`
  // preset, or a raw composition's width/height.
  const legacyResolution = rawRender.resolution;
  const fromLegacy = parseResolutionString(legacyResolution);
  const width =
    rawVideo.width ??
    (raw.width as number | undefined) ??
    fromLegacy?.width ??
    DEFAULT_VIDEO.width;
  const height =
    rawVideo.height ??
    (raw.height as number | undefined) ??
    fromLegacy?.height ??
    DEFAULT_VIDEO.height;
  const fps =
    rawVideo.fps ??
    (raw.fps as number | undefined) ??
    rawRender.fps ??
    DEFAULT_VIDEO.fps;
  const background =
    rawVideo.background ??
    (raw.background as string | undefined) ??
    (rawRender as { background?: string }).background ??
    DEFAULT_VIDEO.background;
  const duration =
    rawVideo.defaultDuration ??
    (raw.duration as number | string | undefined);

  const project: ProjectConfig = { entry, sourceDir, mediaDir, outputDir, cacheDir };

  const video: VideoConfig = {
    width,
    height,
    fps,
    defaultDuration: duration,
    background,
  };

  const render: RenderConfig = {
    fps,
    resolution: `${width}x${height}`,
    format: rawRender.format ?? DEFAULT_RENDER.format!,
    quality: rawRender.quality ?? DEFAULT_RENDER.quality!,
    codec: rawRender.codec ?? DEFAULT_RENDER.codec!,
    crf: rawRender.crf,
    preset: rawRender.preset ?? DEFAULT_RENDER.preset!,
    hardwareAcceleration: rawRender.hardwareAcceleration ?? DEFAULT_RENDER.hardwareAcceleration!,
    concurrency: rawRender.concurrency ?? (raw.concurrency as number | "auto" | undefined),
    chunkSize: rawRender.chunkSize ?? DEFAULT_RENDER.chunkSize,
    ...(rawRender.memoryBudgetMb !== undefined ? { memoryBudgetMb: rawRender.memoryBudgetMb } : {}),
    alpha: rawRender.alpha,
    twoPass: rawRender.twoPass,
    platformPreset: rawRender.platformPreset,
    bitrate: rawRender.bitrate,
    colorManagement: rawRender.colorManagement,
  };

  const config: CinecodeConfig = {
    schemaVersion: (raw.schemaVersion as CinecodeConfig["schemaVersion"] | undefined) ?? SCHEMA_VERSION,
    project,
    video,
    images: {
      defaultFormat: rawImages.defaultFormat ?? DEFAULT_IMAGES.defaultFormat,
      quality: rawImages.quality ?? DEFAULT_IMAGES.quality,
      scaleFactor: rawImages.scaleFactor ?? DEFAULT_IMAGES.scaleFactor,
    },
    dev: {
      port: rawDev.port ?? DEFAULT_DEV.port,
      host: rawDev.host ?? DEFAULT_DEV.host,
      open: rawDev.open ?? DEFAULT_DEV.open,
      hmr: rawDev.hmr ?? DEFAULT_DEV.hmr,
    },
    sourceDir,
    mediaDir,
    outputDir,
    cacheDir,
    binaries: rawBinaries ? { ffmpegPath: rawBinaries.ffmpegPath, ffprobePath: rawBinaries.ffprobePath } : undefined,
    allowCoLocatedMedia,
    cloudMedia: (raw.cloudMedia as CinecodeConfig["cloudMedia"]) ?? DEFAULT_CONFIG.cloudMedia,
    render,
    audio: {
      sampleRate: rawAudio?.sampleRate ?? DEFAULT_CONFIG.audio?.sampleRate,
      channels: rawAudio?.channels ?? DEFAULT_CONFIG.audio?.channels,
      masterVolume: rawAudio?.masterVolume ?? DEFAULT_CONFIG.audio?.masterVolume,
    },
    fonts: (raw.fonts as CinecodeConfig["fonts"]) ?? DEFAULT_CONFIG.fonts,
    concurrency: (raw.concurrency as CinecodeConfig["concurrency"]) ?? DEFAULT_CONFIG.concurrency,
    overwrite: (raw.overwrite as boolean | undefined) ?? DEFAULT_CONFIG.overwrite,
    gitignore: (raw.gitignore as boolean | undefined) ?? DEFAULT_CONFIG.gitignore,
    plugins: normalizePluginEntries(raw.plugins),
    pluginPrecedence: (raw.pluginPrecedence as string[] | undefined) ?? DEFAULT_CONFIG.pluginPrecedence,
    autoDiscoverPlugins:
      (raw.autoDiscoverPlugins as boolean | undefined) ?? DEFAULT_CONFIG.autoDiscoverPlugins,
    ignorePatterns: (raw.ignorePatterns as string[] | undefined) ?? DEFAULT_CONFIG.ignorePatterns,
  };

  return config;
}

export function parseResolutionString(
  value: string | undefined,
): { width: number; height: number } | null {
  if (!value) return null;
  const preset = RESOLUTION_DIMENSIONS[value.toLowerCase() as keyof typeof RESOLUTION_DIMENSIONS];
  if (preset) return preset;
  const match = value.match(/^(\d+)x(\d+)$/i);
  if (!match) return null;
  return { width: parseInt(match[1]!, 10), height: parseInt(match[2]!, 10) };
}

export function resolveConfigPath(configPath: string | undefined, cwd = process.cwd()): string {
  return isAbsolute(configPath ?? "") ? configPath! : resolve(cwd, configPath ?? "cinecode.config.js");
}

/** Convenience: locate `cinecode.config.{ts,js,mjs,json}` in a directory. */
export function findConfigFile(dir = process.cwd()): string {
  const candidates = ["cinecode.config.ts", "cinecode.config.js", "cinecode.config.mjs", "cinecode.config.json"];
  for (const candidate of candidates) {
    const full = resolve(dir, candidate);
    if (existsSync(full)) return full;
  }
  return resolve(dir, "cinecode.config.js");
}
