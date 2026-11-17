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
import {
  findMissingEnvVars,
  findMissingEnvVarsDeep,
  substituteEnvVars,
  substituteEnvVarsDeep,
} from "./envsubst.js";
import { mergeConfigInheritance } from "./inherit.js";
import { isUserModuleFile, loadUserModule } from "../loader/index.js";
import { createError, ErrorCode, isCinecodeError } from "../errors/index.js";
import { RESOLUTION_DIMENSIONS, SCHEMA_VERSION } from "./zod-schema.js";

export { SCHEMA_VERSION };
import { validateAuthoringConfig, validateNormalizedConfig } from "./validator.js";

export interface LoadConfigOptions {
  readonly configPath?: string;
  readonly fresh?: boolean;
}

export const DEFAULT_PROJECT: ProjectConfig = {
  entry: "./main.ts",
  sourceDir: "./src",
  outputDir: "./output",
  cacheDir: ".cinecode/cache",
};

export const DEFAULT_VIDEO: VideoConfig = {
  width: 1920,
  height: 1080,
  fps: 30,
  background: "#000000",
};

export const DEFAULT_RENDER: RenderConfig = {
  fps: 30,
  resolution: "1920x1080",
  format: "mp4",
  quality: "final",
  codec: "h264",
  preset: "slow",
  hardwareAcceleration: "off",
};

export const DEFAULT_IMAGES: ImageConfig = {
  defaultFormat: "png",
  quality: 92,
  scaleFactor: 1,
};

export const DEFAULT_DEV: DevConfig = {
  port: 3000,
  host: "localhost",
  open: false,
  hmr: true,
  metricsPort: undefined,
};

const DEFAULT_CONFIG: CinecodeConfig = {
  schemaVersion: SCHEMA_VERSION,
  project: DEFAULT_PROJECT,
  video: DEFAULT_VIDEO,
  images: DEFAULT_IMAGES,
  dev: DEFAULT_DEV,
  sourceDir: DEFAULT_PROJECT.sourceDir,
  outputDir: DEFAULT_PROJECT.outputDir,
  cacheDir: DEFAULT_PROJECT.cacheDir,
  cloudMedia: [],
  render: DEFAULT_RENDER,
  audio: {
    sampleRate: 48000,
    channels: 2,
    masterVolume: 1,
  },
  fonts: [],
  concurrency: "auto",
  overwrite: false,
  gitignore: true,
  plugins: [],
  pluginPrecedence: [],
  autoDiscoverPlugins: true,
  ignorePatterns: [],
};

const EXPLICIT_PATHS = Symbol("cinecode.config.explicitPaths");

/** Authoring paths that were present in the source config, for precedence. */
export function explicitConfigPaths(config: CinecodeConfig): ReadonlySet<string> {
  return (config as CinecodeConfig & { [EXPLICIT_PATHS]?: ReadonlySet<string> })[EXPLICIT_PATHS] ?? new Set();
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

export async function loadConfig(configPath: string, options: LoadConfigOptions = {}): Promise<CinecodeConfig> {
  const resolvedPath = resolve(configPath);
  const ext = extname(resolvedPath).toLowerCase();

  let rawConfig: Record<string, unknown>;

  try {
    if (isUserModuleFile(resolvedPath)) {
      rawConfig = await loadUserModule<Record<string, unknown>>(resolvedPath, dirname(resolvedPath), { fresh: options.fresh });
    } else if (ext === ".json") {
      const rawText = readFileSync(resolvedPath, "utf-8");
      assertEnvVarsPresent(findMissingEnvVars(rawText), resolvedPath);
      try {
        rawConfig = JSON.parse(substituteEnvVars(rawText));
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
    assertEnvVarsPresent(findMissingEnvVarsDeep(rawConfig), resolvedPath);
    const withEnv = substituteEnvVarsDeep(rawConfig);
    const merged = await mergeConfigInheritance(resolvedPath, withEnv);
    const declaredVersion = merged.schemaVersion;
    if (typeof declaredVersion === "number" && declaredVersion > SCHEMA_VERSION) {
      throw createError(
        ErrorCode.CC1004,
        { version: String(declaredVersion), expected: String(SCHEMA_VERSION) },
        { location: { file: resolvedPath }, fixHint: `This Cinecode release supports schema version ${SCHEMA_VERSION}; upgrade cinecode or lower schemaVersion.` },
      );
    }
    assertAuthoringSchema(merged, resolvedPath);
    const config = normalizeConfig(merged);
    const normalized = validateNormalizedConfig(config, resolvedPath);
    if (normalized.errors.length > 0) throw normalized.errors[0];
    return config;
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

function assertAuthoringSchema(raw: Record<string, unknown>, configPath: string): void {
  const { errors } = validateAuthoringConfig(raw, configPath);
  if (errors.length > 0) throw errors[0];
}

function assertEnvVarsPresent(missing: readonly string[], configPath: string): void {
  if (missing.length === 0) return;
  const list = missing.map((name) => `'${name}'`).join(", ");
  throw createError(
    ErrorCode.CC1005,
    {
      path: configPath,
      reason: `Missing required environment variable${missing.length > 1 ? "s" : ""} ${list}. Set ${missing.length > 1 ? "them" : "it"} before running cinecode: export ${missing[0]}=...`,
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

  const entry =
    rawProject.entry ??
    (raw.entry as string | undefined) ??
    DEFAULT_PROJECT.entry;

  const sourceDir =
    rawProject.sourceDir ??
    (raw.sourceDir as string | undefined) ??
    DEFAULT_PROJECT.sourceDir;

  const outputDir =
    rawProject.outputDir ??
    (raw.outputDir as string | undefined) ??
    DEFAULT_PROJECT.outputDir;

  const cacheDir =
    rawProject.cacheDir ??
    (raw.cacheDir as string | undefined) ??
    DEFAULT_PROJECT.cacheDir;

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

  const project: ProjectConfig = { entry, sourceDir, outputDir, cacheDir };

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
    chunkSize: rawRender.chunkSize,
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
      metricsPort: rawDev.metricsPort ?? DEFAULT_DEV.metricsPort,
    },
    sourceDir,
    outputDir,
    cacheDir,
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

  Object.defineProperty(config, EXPLICIT_PATHS, { value: new Set(collectExplicitPaths(raw)), enumerable: false });
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

export function getDefaultConfig(): CinecodeConfig {
  return normalizeConfig({});
}
