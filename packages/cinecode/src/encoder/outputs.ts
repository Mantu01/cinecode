import { spawn } from "node:child_process";
import ffmpegStatic from "@ffmpeg-installer/ffmpeg";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { Canvas, loadImage } from "@napi-rs/canvas";
import { buildHdrColorArgs, type HdrMetadata } from "./index.js";

/**
 * Output-side media operations: format conversion, stitching, splitting,
 * thumbnails, frame sequences, and animated GIF. All are ffmpeg-coordinated
 * and deterministic for the same inputs.
 */

export interface FfmpegResult {
  readonly success: boolean;
  readonly outputPath: string;
  readonly error?: string;
}

function runFfmpeg(args: readonly string[], stdinData?: Buffer): Promise<FfmpegResult> {
  const outputPath = args[args.length - 1] ?? "";
  return new Promise<FfmpegResult>((resolve) => {
    const child = spawn(ffmpegStatic.path, [...args], { windowsHide: true });
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

export type StillImageFormat = "png" | "jpg" | "webp" | "avif";

export interface StillImageOptions {
  readonly overwrite?: boolean;
  /** 0-100 for WebP/JPEG, 0-63 for AVIF (lower = better quality). */
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
    codec.push("-c:v", "png", "-pix_fmt", alpha ? "rgba" : "rgb24");
  } else if (format === "jpg") {
    codec.push("-c:v", "mjpeg", "-pix_fmt", "yuvj420p", "-q:v", String(Math.max(2, Math.round(31 - (options.quality ?? 90) * 0.29))));
  } else if (format === "webp") {
    codec.push("-c:v", "libwebp", "-quality", String(Math.max(0, Math.min(100, Math.round(options.quality ?? 90)))));
    if (options.lossless) codec.push("-lossless", "1");
    codec.push("-pix_fmt", alpha ? "yuva420p" : "yuv420p");
  } else {
    codec.push(
      "-c:v", "libaom-av1",
      "-crf", String(Math.max(0, Math.min(63, Math.round(options.quality === undefined ? 24 : options.quality / 100 * 63)))),
      "-b:v", "0",
      "-pix_fmt", "yuv420p",
    );
    if (alpha) codec.push("-alpha_mode", "1");
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
}

/** Encode frames as an APNG using ffmpeg's apng muxer. */
export async function encodeAnimatedPng(
  frames: readonly Buffer[],
  outputPath: string,
  options: AnimatedPngOptions = {},
): Promise<FfmpegResult> {
  if (frames.length === 0) return { success: false, outputPath, error: "No frames supplied" };
  const { fps = 30, overwrite = false, plays = 0 } = options;
  return runFfmpeg([
    "-v", "error",
    ...(overwrite ? ["-y"] : ["-n"]),
    "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-f", "apng",
    "-plays", String(Math.max(0, Math.round(plays))),
    outputPath,
  ], Buffer.concat([...frames]));
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
  const results = await Promise.all(
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
  return results;
}

export interface ThumbnailOptions {
  readonly overwrite?: boolean;
  readonly width?: number;
}

/** Extract a still thumbnail at the given timestamp (seconds). */
export async function generateThumbnail(inputPath: string, timestamp: number, outputPath: string, options: ThumbnailOptions = {}): Promise<FfmpegResult> {
  const { overwrite = false, width } = options;
  const scale = width ? ["-vf", `scale=${width}:-2`] : [];
  return runFfmpeg([
    "-v", "error",
    ...(overwrite ? ["-y"] : ["-n"]),
    "-ss", String(timestamp),
    "-i", inputPath,
    "-frames:v", "1",
    ...scale,
    outputPath,
  ]);
}

export interface FrameSequenceOptions {
  readonly overwrite?: boolean;
  readonly pattern?: string;
}

/**
 * Write a directory of per-frame PNG images (a frame sequence) for external
 * compositing/interchange. `frames` are raw PNG buffers in frame order.
 * Written directly — no ffmpeg involved — so the sequence is exactly the
 * rendered frames.
 */
export async function writeFrameSequence(
  frames: readonly Buffer[],
  outputDir: string,
  options: FrameSequenceOptions = {},
): Promise<FfmpegResult> {
  const { overwrite = false, pattern = "frame-%05d.png" } = options;
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, pattern);
  if (frames.length === 0) return { success: false, outputPath, error: "No frames supplied" };
  const writes = frames.map((frame, index) => {
    const name = pattern.replace("%05d", String(index).padStart(5, "0"));
    return writeFile(join(outputDir, name), frame);
  });
  await Promise.all(writes);
  void overwrite;
  return { success: true, outputPath };
}

export interface AnimatedGifOptions {
  readonly fps?: number;
  readonly overwrite?: boolean;
  readonly maxWidth?: number;
  /** Palette quality 1–8 (higher = more colors, larger file). */
  readonly quality?: number;
  /** Dithering algorithm: floyd-steinberg, sierra-2, atkinson, or none. */
  readonly dither?: "floyd-steinberg" | "sierra-2" | "atkinson" | "none";
  /** Number of loop iterations; 0 = infinite. */
  readonly loops?: number;
}

/**
 * Multi-pass GIF encoding with palette optimization and configurable dithering.
 * Pass 1 generates an optimal palette with diff_mode for transparency support.
 * Pass 2 applies the palette with the selected dithering algorithm.
 * Returns the output path and actual file size.
 */
export interface GifOptimizedResult extends FfmpegResult {
  readonly fileSize?: number;
}

export async function encodeAnimatedGifOptimized(
  frames: readonly Buffer[],
  outputPath: string,
  options: AnimatedGifOptions = {},
): Promise<GifOptimizedResult> {
  const {
    fps = 12,
    overwrite = false,
    maxWidth,
    quality = 8,
    dither = "floyd-steinberg",
    loops = 0,
  } = options;

  const first = frames[0];
  if (!first) return { success: false, outputPath, error: "No frames supplied" };

  const tempDir = join((await import("node:os")).tmpdir(), `cinecode-gif-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  try {
    const palettePath = join(tempDir, "palette.png");
    const maxColors = Math.max(16, Math.round(256 * quality / 8));

    // Pass 1: generate optimal palette with diff_mode for transparency
    const paletteResult = await runFfmpeg(
      [
        "-v", "error", "-y",
        "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
        "-vf", maxWidth
          ? `fps=${fps},scale=${maxWidth}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${maxColors}:diff_mode=diff[p];[s1][p]paletteuse=dither=${dither}`
          : `fps=${fps},split[s0][s1];[s0]palettegen=max_colors=${maxColors}:diff_mode=diff[p];[s1][p]paletteuse=dither=${dither}`,
        palettePath,
      ],
      Buffer.concat([...frames]),
    );

    if (!paletteResult.success) {
      return { success: false, outputPath, error: `Palette generation failed: ${paletteResult.error}` };
    }

    // Pass 2: encode with generated palette
    const filter = maxWidth
      ? `fps=${fps},scale=${maxWidth}:-1:flags=lanczos,paletteuse=dither=${dither}:diff_mode=rectangle`
      : `fps=${fps},paletteuse=dither=${dither}:diff_mode=rectangle`;

    const result = await runFfmpeg(
      [
        "-v", "error",
        ...(overwrite ? ["-y"] : ["-n"]),
        "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
        "-i", palettePath,
        "-filter_complex", filter,
        "-loop", String(loops),
        outputPath,
      ],
      Buffer.concat([...frames]),
    );

    const { stat } = await import("node:fs/promises");
    const fileSize = (await stat(outputPath).catch(() => null))?.size;

    return {
      success: result.success,
      outputPath,
      error: result.error,
      fileSize,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Drops duplicate consecutive frames (by MD5 hash prefix) and caps total count.
 * Reduces GIF frame count and file size when content is mostly static.
 */
export interface GifOptimizeOptions {
  readonly skipDuplicateFrames?: boolean;
  readonly minFrameDuration?: number;
  readonly maxFrames?: number;
}

export function optimizeGifFrames(frames: Buffer[], options: GifOptimizeOptions = {}): Buffer[] {
  const { skipDuplicateFrames = true, maxFrames } = options;
  const optimized: Buffer[] = [];
  let lastHash = "";

  for (const frame of frames) {
    const hash = createHash("md5").update(frame).digest("hex").slice(0, 8);
    if (skipDuplicateFrames && hash === lastHash) continue;
    lastHash = hash;
    optimized.push(frame);
    if (maxFrames && optimized.length >= maxFrames) break;
  }
  return optimized;
}

/**
 * Encode rendered PNG frames into an animated GIF with a generated palette
 * for acceptable quality. Deterministic for the same frame buffers.
 */
export async function encodeAnimatedGif(frames: readonly Buffer[], outputPath: string, options: AnimatedGifOptions = {}): Promise<FfmpegResult> {
  const { fps = 12, overwrite = false, maxWidth } = options;
  const first = frames[0];
  if (!first) return { success: false, outputPath, error: "No frames supplied" };
  await mkdir(dirname(outputPath), { recursive: true }).catch(() => undefined);
  const filters = maxWidth
    ? `fps=${fps},scale=${maxWidth}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`
    : `fps=${fps},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
  return runFfmpeg(
    [
      "-v", "error",
      ...(overwrite ? ["-y"] : ["-n"]),
      "-f", "image2pipe",
      "-framerate", String(fps),
      "-i", "-",
      "-vf", filters,
      "-loop", "0",
      outputPath,
    ],
    Buffer.concat([...frames]),
  );
}

export interface SpriteSheetOptions {
  readonly columns?: number;
  readonly padding?: number;
  readonly background?: string;
  readonly overwrite?: boolean;
}

export interface SpriteSheetResult extends FfmpegResult {
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly frames: number;
}

/**
 * Compose rendered PNG frames into a sprite sheet (texture atlas) laid out in a
 * grid, writing the atlas PNG plus a JSON metadata sidecar describing each
 * frame's rectangle. Deterministic for the same frame buffers.
 */
export async function writeSpriteSheet(
  frames: readonly Buffer[],
  outputPngPath: string,
  options: SpriteSheetOptions = {},
): Promise<SpriteSheetResult> {
  const { padding = 0, background = "#00000000", overwrite = false } = options;
  const first = frames[0];
  if (!first) return { success: false, outputPath: outputPngPath, error: "No frames supplied", columns: 0, rows: 0, cellWidth: 0, cellHeight: 0, frames: 0 };

  const images = await Promise.all(frames.map((frame) => loadImage(frame)));
  const cellWidth = Math.max(...images.map((img) => img.width));
  const cellHeight = Math.max(...images.map((img) => img.height));
  const columns = options.columns && options.columns > 0 ? Math.min(options.columns, frames.length) : Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / columns);

  const width = columns * cellWidth + (columns - 1) * padding;
  const height = rows * cellHeight + (rows - 1) * padding;
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext("2d");
  if (background !== "#00000000") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }

  const rects: { index: number; x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < images.length; i += 1) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = col * (cellWidth + padding);
    const y = row * (cellHeight + padding);
    ctx.drawImage(images[i]!, x, y, images[i]!.width, images[i]!.height);
    rects.push({ index: i, x, y, w: images[i]!.width, h: images[i]!.height });
  }

  await mkdir(dirname(outputPngPath), { recursive: true });
  if (!overwrite) {
    const { access } = await import("node:fs/promises");
    try {
      await access(outputPngPath);
      return { success: false, outputPath: outputPngPath, error: "File exists (use overwrite)", columns, rows, cellWidth, cellHeight, frames: frames.length };
    } catch { /* ENOENT expected */ }
  }

  const buffer = canvas.toBuffer("image/png");
  await writeFile(outputPngPath, buffer);
  const metadataPath = outputPngPath.replace(/\.[^.]+$/, "") + ".json";
  await writeFile(metadataPath, `${JSON.stringify({ width, height, columns, rows, cellWidth, cellHeight, frames: rects }, null, 2)}\n`, "utf-8");

  return { success: true, outputPath: outputPngPath, columns, rows, cellWidth, cellHeight, frames: frames.length };
}
