import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, extname, isAbsolute } from "node:path";
import type {
  AspectRatio,
  CinecodeConfig,
  DevConfig,
  ImageConfig,
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

export interface LoadConfigOptions {
  readonly configPath?: string;
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

const DEFAULT_CONFIG: Required<CinecodeConfig> = {
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

export async function loadConfig(configPath: string): Promise<CinecodeConfig> {
  const resolvedPath = resolve(configPath);
  const ext = extname(resolvedPath).toLowerCase();

  let rawConfig: Record<string, unknown>;

  try {
    if (ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".ts" || ext === ".mts") {
      const module = await import(pathToFileURL(resolvedPath).href);
      rawConfig = (module.default ?? module) as Record<string, unknown>;
    } else if (ext === ".json") {
      const rawText = readFileSync(resolvedPath, "utf-8");
      assertEnvVarsPresent(findMissingEnvVars(rawText));
      rawConfig = JSON.parse(substituteEnvVars(rawText));
    } else {
      throw new Error(`Unsupported config file extension: ${ext}`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to load config from ${resolvedPath}: ${message}`, { cause: e });
  }

  assertEnvVarsPresent(findMissingEnvVarsDeep(rawConfig));
  const withEnv = substituteEnvVarsDeep(rawConfig);
  const merged = await mergeConfigInheritance(resolvedPath, withEnv);
  return normalizeConfig(merged);
}

function assertEnvVarsPresent(missing: readonly string[]): void {
  if (missing.length === 0) return;
  const list = missing.map((name) => `'${name}'`).join(", ");
  throw new Error(
    `Missing required environment variable${missing.length > 1 ? "s" : ""} ${list}. ` +
      `Set ${missing.length > 1 ? "them" : "it"} before running cinecode: export ${missing[0]}=...`,
  );
}

/**
 * Flattens a raw config (schema v1 or v2, optionally merged with a raw
 * composition export) into a fully-populated `CinecodeConfig`. Both the
 * structured v2 blocks and the legacy flattened fields are always present.
 */
export function normalizeConfig(raw: Record<string, unknown>): CinecodeConfig {
  const rawProject = (raw.project as Partial<ProjectConfig> | undefined) ?? {};
  const rawVideo = (raw.video as Partial<VideoConfig> | undefined) ?? {};
  const rawImages = (raw.images as Partial<ImageConfig> | undefined) ?? {};
  const rawDev = (raw.dev as Partial<DevConfig> | undefined) ?? {};
  const rawRender = (raw.render as RenderConfig | undefined) ?? {};
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
    format: rawRender.format ?? DEFAULT_RENDER.format,
    background,
    quality: rawRender.quality ?? DEFAULT_RENDER.quality,
    codec: rawRender.codec ?? DEFAULT_RENDER.codec,
    crf: rawRender.crf,
    preset: rawRender.preset ?? DEFAULT_RENDER.preset,
    hardwareAcceleration:
      rawRender.hardwareAcceleration ?? DEFAULT_RENDER.hardwareAcceleration,
    concurrency: rawRender.concurrency ?? (raw.concurrency as number | "auto" | undefined),
    chunkSize: rawRender.chunkSize,
  };

  return {
    schemaVersion: (raw.schemaVersion as number | undefined) ?? SCHEMA_VERSION,
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
    },
    fonts: (raw.fonts as CinecodeConfig["fonts"]) ?? DEFAULT_CONFIG.fonts,
    concurrency: (raw.concurrency as CinecodeConfig["concurrency"]) ?? DEFAULT_CONFIG.concurrency,
    logLevel: (raw.logLevel as CinecodeConfig["logLevel"]) ?? DEFAULT_CONFIG.logLevel,
    overwrite: (raw.overwrite as boolean | undefined) ?? DEFAULT_CONFIG.overwrite,
    gitignore: (raw.gitignore as boolean | undefined) ?? DEFAULT_CONFIG.gitignore,
    plugins: (raw.plugins as CinecodeConfig["plugins"]) ?? DEFAULT_CONFIG.plugins,
    autoDiscoverPlugins:
      (raw.autoDiscoverPlugins as boolean | undefined) ?? DEFAULT_CONFIG.autoDiscoverPlugins,
    ignorePatterns: (raw.ignorePatterns as string[] | undefined) ?? DEFAULT_CONFIG.ignorePatterns,
  };
}

const RESOLUTION_PRESETS: Record<string, { width: number; height: number }> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
  "4k": { width: 3840, height: 2160 },
  "vertical-1080": { width: 1080, height: 1920 },
  "square-1080": { width: 1080, height: 1080 },
};

export function parseResolutionString(
  value: string | undefined,
): { width: number; height: number } | null {
  if (!value) return null;
  const preset = RESOLUTION_PRESETS[value.toLowerCase()];
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

// Legacy shallow validator retained for backwards compatibility.
export function validateConfig(config: CinecodeConfig): string[] {
  const errors: string[] = [];

  if (config.schemaVersion !== 1 && config.schemaVersion !== 2) {
    errors.push(`Unsupported schema version: ${config.schemaVersion}`);
  }
  if (!config.sourceDir || typeof config.sourceDir !== "string") {
    errors.push("sourceDir is required");
  }
  if (config.render?.fps !== undefined && (config.render.fps < 1 || config.render.fps > 120)) {
    errors.push("render.fps must be between 1 and 120");
  }
  if (config.render?.resolution) {
    if (!parseResolutionString(config.render.resolution)) {
      errors.push('render.resolution must be a preset or "WIDTHxHEIGHT"');
    }
  }
  if (config.audio?.sampleRate !== undefined && ![22050, 44100, 48000, 96000].includes(config.audio.sampleRate)) {
    errors.push("audio.sampleRate must be 22050, 44100, 48000, or 96000");
  }
  if (config.audio?.channels !== undefined && ![1, 2].includes(config.audio.channels)) {
    errors.push("audio.channels must be 1 or 2");
  }
  return errors;
}

export function getDefaultConfig(): CinecodeConfig {
  return normalizeConfig({});
}
