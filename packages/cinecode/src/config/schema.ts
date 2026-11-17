import { existsSync, readFileSync } from "node:fs";
import { resolve, extname, isAbsolute, dirname } from "node:path";
import type {
  AspectRatio,
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
import { RESOLUTION_DIMENSIONS } from "./zod-schema.js";
import { validateAuthoringConfig, validateNormalizedConfig } from "./validator.js";

export interface LoadConfigOptions {
  readonly configPath?: string;
  readonly fresh?: boolean;
}

export const DEFAULT_PROJECT: ProjectConfig = {
  name: "cinecode-video",
  entry: "./main.ts",
  sourceDir: "./src",
  outputDir: "./output",
  cacheDir: ".cinecode/cache",
};

export const DEFAULT_VIDEO: VideoConfig = {
  title: "Cinecode Video",
  width: 1920,
  height: 1080,
  fps: 30,
  background: "#000000",
  colorSpace: "srgb",
  pixelAspectRatio: 1,
};

export const DEFAULT_RENDER: RenderConfig = {
  fps: 30,
  resolution: "1920x1080",
  format: "mp4",
  background: "#000000",
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
  historyDepth: 50,
  metricsPort: undefined,
};

const DEFAULT_CONFIG: CinecodeConfig = {
  schemaVersion: 2,
  project: DEFAULT_PROJECT,
  video: DEFAULT_VIDEO,
  images: DEFAULT_IMAGES,
  dev: DEFAULT_DEV,
  name: DEFAULT_PROJECT.name,
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
  logLevel: "info",
  overwrite: false,
  gitignore: true,
  plugins: [],
  pluginPrecedence: [],
  pluginPermissions: {},
  security: {
    pluginVerification: "warn",
    trustedKeys: [],
  },
  telemetry: {
    enabled: false,
    endpoint: "https://telemetry.cinecode.dev/v1/events",
  },
  autoDiscoverPlugins: true,
  ignorePatterns: [],
};

export const SCHEMA_VERSION = 2;

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

  const name =
    (raw.name as string | undefined) ??
    rawProject.name ??
    rawVideo.title ??
    DEFAULT_PROJECT.name;

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
    rawRender.background ??
    DEFAULT_VIDEO.background;
  const duration =
    rawVideo.defaultDuration ??
    (raw.duration as number | string | undefined);

  const project: ProjectConfig = { name, entry, sourceDir, outputDir, cacheDir };

  const video: VideoConfig = {
    title: rawVideo.title ?? name,
    description: rawVideo.description,
    author: rawVideo.author,
    version: rawVideo.version,
    tags: rawVideo.tags,
    license: rawVideo.license,
    width,
    height,
    aspectRatio: rawVideo.aspectRatio ?? guessAspectRatio(width, height),
    fps,
    defaultDuration: duration,
    background,
    colorSpace: rawVideo.colorSpace ?? DEFAULT_VIDEO.colorSpace,
    pixelAspectRatio: rawVideo.pixelAspectRatio ?? DEFAULT_VIDEO.pixelAspectRatio,
  };

  const render: RenderConfig = {
    fps,
    resolution: `${width}x${height}`,
    format: rawRender.format ?? DEFAULT_RENDER.format!,
    background,
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
    enforceAspectRatio: rawRender.enforceAspectRatio,
    variants: rawRender.variants,
    colorManagement: rawRender.colorManagement,
  };

  return {
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
      historyDepth: rawDev.historyDepth ?? DEFAULT_DEV.historyDepth,
      metricsPort: rawDev.metricsPort ?? DEFAULT_DEV.metricsPort,
    },
    name,
    sourceDir,
    outputDir,
    cacheDir,
    cloudMedia: (raw.cloudMedia as CinecodeConfig["cloudMedia"]) ?? DEFAULT_CONFIG.cloudMedia,
    render,
    audio: {
      sampleRate: rawAudio?.sampleRate ?? DEFAULT_CONFIG.audio?.sampleRate,
      channels: rawAudio?.channels ?? DEFAULT_CONFIG.audio?.channels,
      masterVolume: rawAudio?.masterVolume ?? DEFAULT_CONFIG.audio?.masterVolume,
      normalize: rawAudio?.normalize,
      limiter: rawAudio?.limiter,
      sidechains: rawAudio?.sidechains,
    },
    fonts: (raw.fonts as CinecodeConfig["fonts"]) ?? DEFAULT_CONFIG.fonts,
    concurrency: (raw.concurrency as CinecodeConfig["concurrency"]) ?? DEFAULT_CONFIG.concurrency,
    logLevel: (raw.logLevel as CinecodeConfig["logLevel"]) ?? DEFAULT_CONFIG.logLevel,
    overwrite: (raw.overwrite as boolean | undefined) ?? DEFAULT_CONFIG.overwrite,
    gitignore: (raw.gitignore as boolean | undefined) ?? DEFAULT_CONFIG.gitignore,
    plugins: normalizePluginEntries(raw.plugins),
    pluginPrecedence: (raw.pluginPrecedence as string[] | undefined) ?? DEFAULT_CONFIG.pluginPrecedence,
    pluginPermissions:
      (raw.pluginPermissions as Record<string, string[]> | undefined) ?? DEFAULT_CONFIG.pluginPermissions,
    security: {
      ...DEFAULT_CONFIG.security,
      ...(raw.security as CinecodeConfig["security"] | undefined),
    },
    telemetry: {
      ...DEFAULT_CONFIG.telemetry,
      ...(raw.telemetry as CinecodeConfig["telemetry"] | undefined),
    },
    autoDiscoverPlugins:
      (raw.autoDiscoverPlugins as boolean | undefined) ?? DEFAULT_CONFIG.autoDiscoverPlugins,
    ignorePatterns: (raw.ignorePatterns as string[] | undefined) ?? DEFAULT_CONFIG.ignorePatterns,
  };
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

export function guessAspectRatio(width: number, height: number): AspectRatio {
  const ratio = width / height;
  const candidates: Array<[AspectRatio, number]> = [
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
    ["1:1", 1],
    ["4:3", 4 / 3],
    ["21:9", 21 / 9],
  ];
  let best: AspectRatio = "16:9";
  let bestDiff = Infinity;
  for (const [label, value] of candidates) {
    const diff = Math.abs(ratio - value);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = label;
    }
  }
  return best;
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
