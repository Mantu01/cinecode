import { mkdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { CinecodeConfig, Composition, QualitySetting, RenderFormat } from "../../core/types/index.js";
import type { VideoEncoding } from "../../core/quality.js";
import { resolveVideoEncoding } from "../../core/quality.js";
import { checkFileSizeCompliance } from "../../encoder/presets.js";
import { getPreset } from "../../encoder/platform-presets.js";
import { createRenderJob, type RenderJob } from "../../pipeline/index.js";
import type { ProgressHandler } from "../../pipeline/progress.js";
import { CinecodeIgnore } from "../../config/ignore.js";
import { parseDurationInput, parseTimeInput } from "../../core/time-input.js";
import { UsageError } from "./usage-error.js";
import type { ProjectLocation } from "../../config/project.js";
import { DEFAULT_RENDER } from "../../config/defaults.js";
import type { GifDitherMode } from "../../core/output-plan.js";
import { runReport } from "../output/run-report.js";

/** Frame index for a command-line time; malformed input is a usage error. */
export function parseTimeArgument(input: string, fps: number): number {
  const parsed = parseTimeInput(input, fps);
  if (!parsed.ok) throw new UsageError(parsed.error);
  return parsed.time.frame;
}

/** Frame index or time for CLI options (--from, --to, --range); integer is frame index. */
export function parseFrameOrTimeArgument(input: string | number, fps: number): number {
  if (typeof input === "number") return Math.round(input);
  const text = input.trim();
  if (/^-?\d+$/.test(text)) {
    return parseInt(text, 10);
  }
  return parseTimeArgument(text, fps);
}

/** Duration value as seconds; malformed input is a usage error. */
export function parseDurationArgument(value: number | string, fps: number): number {
  const parsed = parseDurationInput(value, fps);
  if (!parsed.ok) throw new UsageError(parsed.error);
  return parsed.seconds;
}

export const OUTPUT_SUBDIRS = {
  videos: "videos",
  audio: "audio",
  images: "images",
  scenes: "scenes",
} as const;

/** Prints which root and config the command resolved, and how it was found. */
export function printProjectContext(
  location: { readonly root: string; readonly configPath: string; readonly source: string },
  always = false,
): void {
  if (!always) return;
  runReport.diagnostic(`Project: ${location.root}`);
  runReport.diagnostic(`Config: ${location.configPath} (${location.source})`);
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
  const platform = getPreset(config.render?.platformPreset ?? "");
  const renderConfig = platform
    ? {
        ...config.render,
        codec: config.render?.codec ?? platform.video.codec,
        crf: config.render?.crf ?? platform.video.crf,
        preset: config.render?.preset ?? platform.video.encoderPreset,
      }
    : config.render;
  return resolveVideoEncoding({ render: renderConfig, quality: overrides.quality });
}

import { normalizeColorManagement, type ColorManagementInput } from "./color-management.js";

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
  readonly verbose?: boolean;
  readonly onProgress?: ProgressHandler;
  readonly twoPass?: boolean;
  readonly alpha?: boolean;
  readonly bitrateKbps?: number;
  readonly forceAudio?: boolean;
  readonly audioCodec?: import("../../audio/muxer.js").AudioMuxCodec;
  readonly audioBitrateKbps?: number;
  readonly colorManagement?: ColorManagementInput;
  readonly allowInvalidTimeline?: boolean;
  readonly gifQuality?: number;
  readonly gifDither?: GifDitherMode;
  readonly gifMaxFrames?: number;
  readonly fonts?: readonly import("../../core/types/index.js").FontEntry[];
  readonly projectRoot: string;
  readonly mediaDir?: string;
  readonly strictFonts?: boolean;
  readonly strict?: boolean;
  readonly frameErrorPolicy?: "placeholder" | "repeat-previous" | "abort";
  readonly entryContent?: string | Buffer;
}

/** Wires a composition into the multi-worker render pipeline. */
export function startCompositionRender(options: StartRenderOptions): RenderJob {
  if (options.resume === true && options.noCache === true) {
    throw new UsageError("--resume requires the frame cache. Remove --no-cache or use --fresh.");
  }
  const encoding = resolveEncoding(options.config, {
    quality: options.quality,
    encoding: options.encoding,
  });
  const concurrency = options.concurrency ?? options.config.render?.concurrency ?? "auto";

  const job = createRenderJob({
    composition: options.composition,
    outputPath: options.outputPath,
    cacheDir: resolve(options.projectRoot, options.config.cacheDir ?? ".cinecode/cache"),
    seed: options.seed ?? 0,
    concurrency,
    chunkSize: options.chunkSize ?? options.config.render?.chunkSize ?? DEFAULT_RENDER.chunkSize,
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
    verbose: options.verbose ?? false,
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
    strict: options.strict,
    frameErrorPolicy: options.frameErrorPolicy ?? options.config.render?.frameErrorPolicy,
    entryContent: options.entryContent,
    binaries: options.config.binaries,
  });

  const preset = getPreset(options.config.render?.platformPreset ?? "");
  if (!preset?.maxFileSizeMB) return job;
  return {
    ...job,
    promise: job.promise.then((result) => {
      const compliance = checkFileSizeCompliance(result.fileSize, preset);
      if (!compliance.compliant && compliance.message) runReport.warn("CC1012", compliance.message);
      return result;
    }),
  };
}
