import { mkdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { CinecodeConfig, Composition, QualitySetting, RenderFormat } from "../core/types/index.js";
import type { VideoEncoding } from "../core/quality.js";
import { resolveVideoEncoding } from "../core/quality.js";
import { checkFileSizeCompliance, resolvePlatformPreset } from "../encoder/presets.js";
import { createRenderJob, type RenderJob } from "../pipeline/index.js";
import type { ProgressHandler } from "../pipeline/progress.js";
import { CinecodeIgnore } from "../config/ignore.js";
import type { ProjectLocation } from "../config/project.js";

/** Parses HH:MM:SS:FF, HH:MM:SS or seconds into a frame number. */
export function parseTimeInput(input: string, fps: number): number {
  if (input.includes(":")) {
    const parts = input.split(":").map(Number);
    if (parts.length === 4) {
      return ((parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)) * fps + (parts[3] ?? 0);
    }
    if (parts.length === 3) {
      return ((parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)) * fps;
    }
  }
  return Math.round(parseFloat(input) * fps);
}

export const OUTPUT_SUBDIRS = {
  videos: "videos",
  audio: "audio",
  images: "images",
  scenes: "scenes",
} as const;

export function resolveCacheDir(config: CinecodeConfig): string {
  return resolve(config.cacheDir ?? ".cinecode/cache");
}

export function resolveOutputDir(config: CinecodeConfig): string {
  return resolve(config.outputDir ?? "output");
}

/** Prints which root and config the command resolved, and how it was found. */
export function printProjectContext(
  location: { readonly root: string; readonly configPath: string; readonly source: string },
  always = false,
): void {
  if (!always) return;
  console.log(`Project: ${location.root}`);
  console.log(`Config: ${location.configPath} (${location.source})`);
}

/** Media-index ignore predicate built from `ignorePatterns`; undefined when empty. */
export function mediaIgnore(config: CinecodeConfig): ((relativePath: string) => boolean) | undefined {
  if (!config.ignorePatterns || config.ignorePatterns.length === 0) return undefined;
  const ignore = new CinecodeIgnore({ patterns: config.ignorePatterns, useDefaults: false });
  return (relativePath) => ignore.shouldIgnore(relativePath);
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/** Appends `-v2`, `-v3`, … when the target exists and overwrite is off. */
export async function resolveOutputPath(basePath: string, overwrite: boolean): Promise<string> {
  if (overwrite) return basePath;
  try {
    await stat(basePath);
  } catch {
    return basePath;
  }
  const dir = dirname(basePath);
  const stem = basename(basePath, extname(basePath));
  let i = 2;
  while (true) {
    const candidate = join(dir, `${stem}-v${i}${extname(basePath)}`);
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
    i += 1;
  }
}

export function resolveEncoding(
  config: CinecodeConfig,
  overrides: { quality?: QualitySetting; encoding?: VideoEncoding } = {},
): VideoEncoding {
  if (overrides.encoding) return overrides.encoding;
  const platform = resolvePlatformPreset(config.render?.platformPreset);
  const renderConfig = platform
    ? {
        ...config.render,
        codec: config.render?.codec ?? platform.codec,
        crf: config.render?.crf ?? platform.crf,
        preset: config.render?.preset ?? platform.preset,
      }
    : config.render;
  return resolveVideoEncoding({ render: renderConfig, quality: overrides.quality });
}

import { normalizeColorManagement, type ColorManagementInput } from "./precedence.js";

export interface StartRenderOptions {
  readonly composition: Composition;
  readonly outputPath: string;
  readonly config: CinecodeConfig;
  readonly seed?: number;
  readonly concurrency?: number | "auto";
  readonly chunkSize?: number;
  readonly memoryBudgetMb?: number;
  readonly overwrite?: boolean;
  readonly fresh?: boolean;
  readonly noCache?: boolean;
  readonly resume?: boolean;
  readonly quality?: QualitySetting;
  readonly encoding?: VideoEncoding;
  readonly format?: RenderFormat;
  readonly fromFrame?: number;
  readonly toFrame?: number;
  readonly silent?: boolean;
  readonly onProgress?: ProgressHandler;
  readonly twoPass?: boolean;
  readonly alpha?: boolean;
  readonly bitrateKbps?: number;
  readonly forceAudio?: boolean;
  readonly audioCodec?: import("../audio/muxer.js").AudioMuxCodec;
  readonly audioBitrateKbps?: number;
  readonly colorManagement?: ColorManagementInput;
  readonly allowInvalidTimeline?: boolean;
  readonly gifQuality?: number;
  readonly gifDither?: "floyd-steinberg" | "sierra-2" | "atkinson" | "none";
  readonly gifMaxFrames?: number;
  readonly fonts?: readonly import("../core/types/index.js").FontEntry[];
  readonly projectRoot?: string;
  readonly mediaDir?: string;
  readonly strictFonts?: boolean;
}

/** Wires a composition into the multi-worker render pipeline. */
export function startCompositionRender(options: StartRenderOptions): RenderJob {
  const encoding = resolveEncoding(options.config, {
    quality: options.quality,
    encoding: options.encoding,
  });
  const concurrency = options.concurrency ?? options.config.render?.concurrency ?? "auto";

  const job = createRenderJob({
    composition: options.composition,
    outputPath: options.outputPath,
    cacheDir: resolveCacheDir(options.config),
    seed: options.seed ?? 0,
    concurrency,
    chunkSize: options.chunkSize ?? options.config.render?.chunkSize ?? 32,
    memoryBudgetMb: options.memoryBudgetMb ?? options.config.render?.memoryBudgetMb,
    encoding,
    quality: options.quality,
    format: options.format ?? options.config.render?.format ?? "mp4",
    overwrite: options.overwrite ?? options.config.overwrite ?? false,
    fresh: options.fresh ?? false,
    noCache: options.noCache ?? false,
    resume: options.resume ?? false,
    fromFrame: options.fromFrame ?? 0,
    toFrame: options.toFrame,
    silent: options.silent ?? false,
    onProgress: options.onProgress,
    twoPass: options.twoPass ?? (options.config.render?.twoPass === true),
    alpha: options.alpha ?? (options.config.render?.alpha === true),
    bitrateKbps: options.bitrateKbps ?? options.config.render?.bitrate,
    forceAudio: options.forceAudio,
    audioCodec: options.audioCodec,
    audioBitrateKbps: options.audioBitrateKbps,
    colorManagement: normalizeColorManagement(options.colorManagement ?? options.config.render?.colorManagement),
    allowInvalidTimeline: options.allowInvalidTimeline,
    gifQuality: options.gifQuality,
    gifDither: options.gifDither,
    gifMaxFrames: options.gifMaxFrames,
    fonts: options.fonts,
    projectRoot: options.projectRoot,
    mediaDir: options.mediaDir,
    strictFonts: options.strictFonts,
  });

  const preset = resolvePlatformPreset(options.config.render?.platformPreset);
  if (!preset?.maxFileSizeMB) return job;
  return {
    ...job,
    promise: job.promise.then((result) => {
      const compliance = checkFileSizeCompliance(result.fileSize, preset);
      if (!compliance.compliant && compliance.message) console.warn(compliance.message);
      return result;
    }),
  };
}
