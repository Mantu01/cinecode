import { mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { Composition, ResolutionVariant, RenderFormat, VideoCodec } from "../core/types/index.js";
import type { VideoEncoding } from "../core/quality.js";
import { resolveVideoEncoding, clampCrf } from "../core/quality.js";
import { renderVideo } from "./index.js";
import type { ProgressHandler } from "./progress.js";

export interface MultiResolutionRenderOptions {
  readonly composition: Composition;
  readonly variants: readonly ResolutionVariant[];
  readonly outputDir: string;
  readonly cacheDir: string;
  readonly seed: number;
  readonly concurrency: number;
  readonly overwrite: boolean;
  readonly format?: RenderFormat;
  readonly encoding?: VideoEncoding;
  readonly onProgress?: ProgressHandler;
}

export interface MultiResolutionVariantResult {
  readonly label: string;
  readonly outputPath: string;
  readonly width: number;
  readonly height: number;
  readonly fileSize: number;
  readonly duration: number;
  readonly error?: string;
}

export interface MultiResolutionResult {
  readonly variants: readonly MultiResolutionVariantResult[];
  readonly totalDuration: number;
  readonly totalTimeMs: number;
}

export const PREDEFINED_VARIANTS: Readonly<Record<string, { width: number; height: number }>> = {
  "480p": { width: 854, height: 480 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
  "4k": { width: 3840, height: 2160 },
};

export function parseVariantLabel(label: string): ResolutionVariant {
  const preset = PREDEFINED_VARIANTS[label.toLowerCase()];
  if (preset) return { label, ...preset };
  const match = label.match(/^(\d+)x(\d+)$/i);
  if (match) return { label, width: Number(match[1]), height: Number(match[2]) };
  const scale = Number(label.replace(/x$/i, ""));
  if (Number.isFinite(scale) && scale > 0 && scale <= 8) return { label, scaleFactor: scale };
  throw new Error(`Unknown variant: ${label}. Use 480p, 720p, 1080p, 4k, WIDTHxHEIGHT or a scale factor like 0.5x.`);
}

export function resolveVariantDimensions(
  composition: Pick<Composition, "width" | "height">,
  variant: ResolutionVariant,
): { width: number; height: number } {
  if (variant.width && variant.height) return { width: variant.width, height: variant.height };
  const scale = variant.scaleFactor ?? (variant.width ? variant.width / composition.width : variant.height ? variant.height / composition.height : 1);
  return {
    width: Math.max(2, Math.round((composition.width * scale) / 2) * 2),
    height: Math.max(2, Math.round((composition.height * scale) / 2) * 2),
  };
}

function variantEncoding(base: VideoEncoding, variant: ResolutionVariant): VideoEncoding {
  const codec: VideoCodec = variant.codec ?? base.codec;
  return {
    ...base,
    codec,
    crf: clampCrf(variant.crf ?? base.crf, codec),
  };
}

export async function renderMultiResolution(
  options: MultiResolutionRenderOptions,
): Promise<MultiResolutionResult> {
  const started = Date.now();
  await mkdir(options.outputDir, { recursive: true });
  const format = options.format ?? "mp4";
  const baseEncoding = options.encoding ?? resolveVideoEncoding();
  const stem = basename(options.composition.name).replace(extname(options.composition.name), "") || "output";
  const ext = format === "mp4" ? "mp4" : format === "webm" ? "webm" : format === "prores" ? "mov" : format;
  const results: MultiResolutionVariantResult[] = [];
  let totalDuration = 0;

  for (const variant of options.variants) {
    const dimensions = resolveVariantDimensions(options.composition, variant);
    const outputPath = join(options.outputDir, `${stem}-${variant.label}.${ext}`);
    try {
      const result = await renderVideo({
        composition: { ...options.composition, width: dimensions.width, height: dimensions.height },
        outputPath,
        cacheDir: options.cacheDir,
        seed: options.seed,
        concurrency: options.concurrency,
        chunkSize: 32,
        encoding: variantEncoding(baseEncoding, variant),
        format,
        overwrite: options.overwrite,
        fresh: false,
        noCache: false,
        onProgress: options.onProgress,
        silent: true,
      });
      totalDuration += result.duration;
      results.push({
        label: variant.label,
        outputPath: result.outputPath,
        width: dimensions.width,
        height: dimensions.height,
        fileSize: result.fileSize,
        duration: result.duration,
      });
    } catch (error) {
      results.push({
        label: variant.label,
        outputPath,
        width: dimensions.width,
        height: dimensions.height,
        fileSize: 0,
        duration: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { variants: results, totalDuration, totalTimeMs: Date.now() - started };
}
