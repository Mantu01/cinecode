// Size exception (>400 lines): comprehensive output format and muxer mappings per quality-standards §2.
import { spawn } from "node:child_process";
import { resolveBinary } from "../binary/resolver.js";
import { recordProcessSpawn } from "../media/instrumentation.js";
import { DEFAULT_IMAGES } from "../config/defaults.js";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Canvas, loadImage } from "@napi-rs/canvas";
import { buildHdrColorArgs, type HdrMetadata } from "./index.js";
import { createError, ErrorCode } from "../errors/index.js";
import type { GifDitherMode } from "../core/output-plan.js";

/**
 * Output-side media operations: format conversion, stitching, splitting,
 * thumbnails, frame sequences, animated GIF/APNG and sprite sheets. Frame
 * writers consume an async source so memory stays constant in duration.
 */

export interface FfmpegResult {
  readonly success: boolean;
  readonly outputPath: string;
  readonly error?: string;
}

/** Rendered frames, streamed or already collected. Writers never hold them all. */
export type FrameSource = AsyncIterable<Buffer> | readonly Buffer[];

async function* frameStream(source: FrameSource): AsyncGenerator<Buffer> {
  if (Symbol.asyncIterator in (source as object)) {
    for await (const frame of source as AsyncIterable<Buffer>) yield frame;
    return;
  }
  for (const frame of source as readonly Buffer[]) yield frame;
}

function pngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) {
    throw createError(ErrorCode.CC4002, { details: "frame sequence expects PNG frames from the renderer" });
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Index naming for `%d` / `%05d` patterns, zero-based from frame 0. */
export function frameFileName(pattern: string, index: number): string {
  return pattern.replace(/%0?(\d*)d/, (_match, pad: string) =>
    String(index).padStart(pad === "" ? 1 : Number(pad), "0"),
  );
}

interface WrittenFrames {
  readonly count: number;
  readonly width: number;
  readonly height: number;
  readonly directory: string;
  readonly pattern: string;
}

async function writeFramesToDir(
  frames: FrameSource,
  directory: string,
  options: { readonly pattern?: string; readonly maxFrames?: number; readonly overwrite?: boolean } = {},
): Promise<WrittenFrames> {
  const pattern = options.pattern ?? "frame-%05d.png";
  let count = 0;
  let width = 0;
  let height = 0;
  for await (const frame of frameStream(frames)) {
    if (options.maxFrames !== undefined && count >= options.maxFrames) break;
    if (count === 0) ({ width, height } = pngSize(frame));
    await writeFile(join(directory, frameFileName(pattern, count)), frame);
    count += 1;
  }
  return { count, width, height, directory, pattern };
}

function runFfmpeg(args: readonly string[], stdinData?: Buffer): Promise<FfmpegResult> {
  const outputPath = args[args.length - 1] ?? "";
  return new Promise<FfmpegResult>((resolve) => {
    recordProcessSpawn();
    const child = spawn(resolveBinary("ffmpeg").path, [...args], { windowsHide: true });
    let stderr = "";
    child.on("error", (err) => {
      resolve({ success: false, outputPath, error: `Failed to spawn ffmpeg: ${err.message}` });
    });
    if (stdinData) {
      child.stdin.on("error", (err) => {
        if (!stderr) stderr = err.message;
      });
      child.stdin.end(stdinData);
    }
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) resolve({ success: false, outputPath, error: `ffmpeg failed: ${stderr}` });
      else resolve({ success: true, outputPath });
    });
  });
}

export interface ConvertOptions {
  readonly overwrite?: boolean;
  readonly extraArgs?: readonly string[];
}

export type StillImageFormat = "png" | "jpg" | "webp";

export interface StillImageOptions {
  readonly overwrite?: boolean;
  /** 0-100 quality for WebP and JPEG. */
  readonly quality?: number;
  readonly lossless?: boolean;
  readonly alpha?: boolean;
  readonly hdr?: HdrMetadata;
}

/** Encode a single PNG frame buffer into a still image format via ffmpeg. */
export async function encodeStillImage(
  frame: Buffer,
  outputPath: string,
  format: StillImageFormat,
  options: StillImageOptions = {},
): Promise<FfmpegResult> {
  const { overwrite = false, alpha = false, hdr } = options;
  const codec: string[] = [];
  if (format === "png") {
    codec.push("-c:v", "png", "-f", "image2", "-pix_fmt", alpha ? "rgba" : "rgb24");
  } else if (format === "jpg") {
    codec.push("-c:v", "mjpeg", "-f", "image2", "-pix_fmt", "yuvj420p", "-q:v", String(Math.max(2, Math.round(31 - (options.quality ?? DEFAULT_IMAGES.quality) * 0.29))));
  } else {
    codec.push("-f", "webp", "-c:v", "libwebp", "-quality", String(Math.max(0, Math.min(100, Math.round(options.quality ?? DEFAULT_IMAGES.quality)))));
    if (options.lossless) codec.push("-lossless", "1");
    codec.push("-pix_fmt", alpha ? "yuva420p" : "yuv420p");
  }
  if (hdr) codec.push(...buildHdrColorArgs(hdr));
  return runFfmpeg([
    "-v", "error",
    ...(overwrite ? ["-y"] : ["-n"]),
    "-f", "image2pipe", "-i", "-",
    ...codec,
    "-frames:v", "1",
    outputPath,
  ], frame);
}

export interface AnimatedWebpOptions {
  readonly fps?: number;
  readonly quality?: number;
  readonly lossless?: boolean;
  readonly overwrite?: boolean;
  readonly maxWidth?: number;
}

/** Encode frames as an animated WebP (lossy or lossless). */
export async function encodeAnimatedWebp(
  frames: readonly Buffer[],
  outputPath: string,
  options: AnimatedWebpOptions = {},
): Promise<FfmpegResult> {
  if (frames.length === 0) return { success: false, outputPath, error: "No frames supplied" };
  const { fps = 30, quality = 80, lossless = false, overwrite = false, maxWidth } = options;
  const filters = maxWidth ? ["-vf", `scale=${maxWidth}:-2:flags=lanczos`] : [];
  return runFfmpeg([
    "-v", "error",
    ...(overwrite ? ["-y"] : ["-n"]),
    "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    ...filters,
    "-c:v", "libwebp",
    "-quality", String(Math.max(0, Math.min(100, Math.round(quality)))),
    ...(lossless ? ["-lossless", "1"] : []),
    "-loop", "0",
    outputPath,
  ], Buffer.concat([...frames]));
}

export interface AnimatedPngOptions {
  readonly fps?: number;
  readonly overwrite?: boolean;
  readonly plays?: number;
  readonly maxFrames?: number;
}

export interface AnimatedPngResult extends FfmpegResult {
  readonly frames: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Encode frames as an APNG. Frames are spooled to a temp sequence directory so
 * memory stays constant; the png encoder and rgba pixel format are explicit.
 */
export async function encodeAnimatedPng(
  frames: FrameSource,
  outputPath: string,
  options: AnimatedPngOptions = {},
): Promise<AnimatedPngResult> {
  const { fps = 30, overwrite = false, plays = 0, maxFrames } = options;
  const work = await mkdtemp(join(tmpdir(), "cinecode-apng-"));
  try {
    const written = await writeFramesToDir(frames, work, { maxFrames });
    if (written.count === 0) {
      return { success: false, outputPath, error: "No frames supplied", frames: 0, width: 0, height: 0 };
    }
    const result = await runFfmpeg([
      "-v", "error",
      ...(overwrite ? ["-y"] : ["-n"]),
      "-framerate", String(fps),
      "-start_number", "0",
      "-i", join(work, written.pattern),
      "-c:v", "apng",
      "-pix_fmt", "rgba",
      "-f", "apng",
      "-plays", String(Math.max(0, Math.round(plays))),
      outputPath,
    ]);
    return { ...result, frames: written.count, width: written.width, height: written.height };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Transcode a media file to another container/codec. */
export async function convertMediaFormat(inputPath: string, outputPath: string, options: ConvertOptions = {}): Promise<FfmpegResult> {
  const { overwrite = false, extraArgs = [] } = options;
  return runFfmpeg([
    "-v", "error",
    ...(overwrite ? ["-y"] : ["-n"]),
    "-i", inputPath,
    ...extraArgs,
    outputPath,
  ]);
}

export interface StitchOptions {
  readonly overwrite?: boolean;
}

/** Concatenate media files with identical codecs into one output. */
export async function stitchVideos(inputPaths: readonly string[], outputPath: string, options: StitchOptions = {}): Promise<FfmpegResult> {
  const { overwrite = false } = options;
  const listArg = inputPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  return runFfmpeg([
    "-v", "error",
    ...(overwrite ? ["-y"] : ["-n"]),
    "-f", "concat",
    "-safe", "0",
    "-i", "-",
    "-c", "copy",
    outputPath,
  ], Buffer.from(listArg, "utf-8"));
}

export interface SplitSegment {
  readonly start: number;
  readonly end: number;
  readonly outputPath: string;
}

export interface SplitOptions {
  readonly overwrite?: boolean;
}

/** Split a video into segments at given second ranges. */
export async function splitVideo(inputPath: string, segments: readonly SplitSegment[], options: SplitOptions = {}): Promise<FfmpegResult[]> {
  const { overwrite = false } = options;
  return Promise.all(
    segments.map((segment) =>
      runFfmpeg([
        "-v", "error",
        ...(overwrite ? ["-y"] : ["-n"]),
        "-i", inputPath,
        "-ss", String(segment.start),
        "-to", String(segment.end),
        "-c", "copy",
        segment.outputPath,
      ]),
    ),
  );
}

export interface FrameSequenceOptions {
  readonly overwrite?: boolean;
  readonly pattern?: string;
  readonly maxFrames?: number;
}

export interface FrameSequenceResult extends FfmpegResult {
  readonly frames: number;
  readonly width: number;
  readonly height: number;
  readonly directory: string;
  readonly pattern: string;
}

/**
 * Write a directory of per-frame PNG images (a frame sequence) for external
 * compositing/interchange. Frames are written one at a time with zero-based
 * `%05d` naming, so memory does not grow with frame count.
 */
export async function writeFrameSequence(
  frames: FrameSource,
  outputDir: string,
  options: FrameSequenceOptions = {},
): Promise<FrameSequenceResult> {
  const { overwrite = false, pattern = "frame-%05d.png", maxFrames } = options;
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, pattern);
  const existing = await stat(join(outputDir, frameFileName(pattern, 0))).catch(() => null);
  if (existing && !overwrite) {
    return {
      success: false,
      outputPath,
      error: "Frame sequence already exists (use overwrite)",
      frames: 0,
      width: 0,
      height: 0,
      directory: outputDir,
      pattern,
    };
  }
  const written = await writeFramesToDir(frames, outputDir, { pattern, maxFrames });
  if (written.count === 0) {
    return { success: false, outputPath, error: "No frames supplied", frames: 0, width: 0, height: 0, directory: outputDir, pattern };
  }
  return {
    success: true,
    outputPath,
    frames: written.count,
    width: written.width,
    height: written.height,
    directory: outputDir,
    pattern,
  };
}

export interface AnimatedGifOptions {
  readonly fps?: number;
  readonly overwrite?: boolean;
  readonly maxWidth?: number;
  /** Palette quality 1–8 (higher = more colors, larger file). */
  readonly quality?: number;
  /** Dithering algorithm: floyd-steinberg, sierra-2, atkinson, or none. */
  readonly dither?: GifDitherMode;
  /** Number of loop iterations; 0 = infinite. */
  readonly loops?: number;
  readonly maxFrames?: number;
}

export interface AnimatedGifResult extends FfmpegResult {
  readonly frames: number;
  readonly width: number;
  readonly height: number;
  readonly fileSize: number;
}

const FFMPEG_DITHER: Readonly<Record<NonNullable<AnimatedGifOptions["dither"]>, string>> = {
  "floyd-steinberg": "floyd_steinberg",
  "sierra-2": "sierra2",
  atkinson: "atkinson",
  none: "none",
};

/**
 * Two-pass GIF encode. Pass 1 writes an optimal palette from the whole
 * sequence, pass 2 applies that palette to the same sequence, so both passes
 * read the frames from a spooled directory and memory stays constant.
 */
export async function encodeAnimatedGif(
  frames: FrameSource,
  outputPath: string,
  options: AnimatedGifOptions = {},
): Promise<AnimatedGifResult> {
  const {
    fps = 12,
    overwrite = false,
    maxWidth,
    quality = 8,
    dither = "floyd-steinberg",
    loops = 0,
    maxFrames,
  } = options;
  const work = await mkdtemp(join(tmpdir(), "cinecode-gif-"));
  try {
    const written = await writeFramesToDir(frames, work, { maxFrames });
    if (written.count === 0) {
      return { success: false, outputPath, error: "No frames supplied", frames: 0, width: 0, height: 0, fileSize: 0 };
    }
    const maxColors = Math.max(16, Math.min(256, Math.round((256 * quality) / 8)));
    const chain = [`fps=${fps}`, ...(maxWidth ? [`scale=${maxWidth}:-1:flags=lanczos`] : [])].join(",");
    const palettePath = join(work, "palette.png");
    const source = join(work, written.pattern);

    const palettePass = await runFfmpeg([
      "-v", "error", "-y",
      "-framerate", String(fps),
      "-start_number", "0",
      "-i", source,
      "-vf", `${chain},palettegen=max_colors=${maxColors}:stats_mode=diff`,
      palettePath,
    ]);
    if (!palettePass.success) {
      return {
        success: false,
        outputPath,
        error: `Palette generation failed: ${palettePass.error}`,
        frames: written.count,
        width: written.width,
        height: written.height,
        fileSize: 0,
      };
    }

    const encoded = await runFfmpeg([
      "-v", "error",
      ...(overwrite ? ["-y"] : ["-n"]),
      "-framerate", String(fps),
      "-start_number", "0",
      "-i", source,
      "-i", palettePath,
      "-lavfi", `[0:v]${chain}[x];[x][1:v]paletteuse=dither=${FFMPEG_DITHER[dither]}:diff_mode=rectangle`,
      "-loop", String(Math.max(0, Math.round(loops))),
      outputPath,
    ]);
    const fileSize = (await stat(outputPath).catch(() => null))?.size ?? 0;
    return {
      ...encoded,
      frames: written.count,
      width: written.width,
      height: written.height,
      fileSize,
    };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface SpriteSheetOptions {
  readonly columns?: number;
  readonly padding?: number;
  readonly background?: string;
  readonly overwrite?: boolean;
  /** Total frame count, needed to size the grid before frames arrive. */
  readonly frameCount?: number;
  readonly maxFrames?: number;
}

export interface SpriteSheetResult extends FfmpegResult {
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly frames: number;
  readonly width: number;
  readonly height: number;
  readonly metadataPath: string;
}

/**
 * Compose rendered PNG frames into a sprite sheet (texture atlas) laid out in a
 * grid, writing the atlas PNG plus a JSON sidecar describing each frame's
 * rectangle. Frames are drawn one at a time from a uniform cell size.
 */
export async function writeSpriteSheet(
  frames: FrameSource,
  outputPngPath: string,
  options: SpriteSheetOptions = {},
): Promise<SpriteSheetResult> {
  const { padding = 0, background = "#00000000", overwrite = false, frameCount, maxFrames } = options;
  const metadataPath = outputPngPath.replace(/\.[^.]+$/, "") + ".json";
  const empty = (error: string): SpriteSheetResult => ({
    success: false,
    outputPath: outputPngPath,
    error,
    columns: 0,
    rows: 0,
    cellWidth: 0,
    cellHeight: 0,
    frames: 0,
    width: 0,
    height: 0,
    metadataPath,
  });

  const total = frameCount ?? (Array.isArray(frames) ? frames.length : undefined);
  if (total === undefined && options.columns === undefined) {
    return empty("Sprite sheets from a frame stream need frameCount or columns");
  }
  const planned = Math.min(maxFrames ?? total ?? Infinity, total ?? Infinity);
  const columns = options.columns && options.columns > 0 ? Math.min(options.columns, planned) : Math.ceil(Math.sqrt(planned || 1));
  const rows = Math.max(1, Math.ceil((planned || 1) / columns));

  if (!overwrite) {
    try {
      await stat(outputPngPath);
      return empty("File exists (use overwrite)");
    } catch {
      // Note: no existing sheet
    }
  }

  let cellWidth = 0;
  let cellHeight = 0;
  let canvas: Canvas | null = null;
  let ctx: ReturnType<Canvas["getContext"]> | null = null;
  const rects: { index: number; x: number; y: number; w: number; h: number }[] = [];

  for await (const frame of frameStream(frames)) {
    if (maxFrames !== undefined && rects.length >= maxFrames) break;
    if (rects.length >= planned) break;
    if (!canvas) {
      ({ width: cellWidth, height: cellHeight } = pngSize(frame));
      const width = columns * cellWidth + (columns - 1) * padding;
      const height = rows * cellHeight + (rows - 1) * padding;
      canvas = new Canvas(width, height);
      ctx = canvas.getContext("2d");
      if (background !== "#00000000") {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
    }
    const image = await loadImage(frame);
    const index = rects.length;
    const x = (index % columns) * (cellWidth + padding);
    const y = Math.floor(index / columns) * (cellHeight + padding);
    ctx!.drawImage(image, x, y, image.width, image.height);
    rects.push({ index, x, y, w: image.width, h: image.height });
  }

  if (!canvas || rects.length === 0) return empty("No frames supplied");

  await mkdir(dirname(outputPngPath), { recursive: true });
  const width = columns * cellWidth + (columns - 1) * padding;
  const height = rows * cellHeight + (rows - 1) * padding;
  await writeFile(outputPngPath, canvas.toBuffer("image/png"));
  await writeFile(
    metadataPath,
    `${JSON.stringify({ width, height, columns, rows, cellWidth, cellHeight, frames: rects }, null, 2)}\n`,
    "utf-8",
  );

  return {
    success: true,
    outputPath: outputPngPath,
    columns,
    rows,
    cellWidth,
    cellHeight,
    frames: rects.length,
    width,
    height,
    metadataPath,
  };
}
