import { spawn } from "node:child_process";
import ffmpegStatic from "@ffmpeg-installer/ffmpeg";
import type { MediaCache } from "./cache.js";
import { frameCacheKey, getDefaultFrameCache, type FrameCache } from "./frame-cache.js";
import { createError, ErrorCode } from "../errors/codes.js";
import { recordDegradation } from "../errors/degradations.js";

async function getFfprobeStatic(): Promise<{ path: string }> {
  const mod = await import("@ffprobe-installer/ffprobe");
  return mod.default;
}

export interface FrameExtractorOptions {
  cache: MediaCache;
}

export interface ExtractedFrame {
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
  readonly format: "rgba" | "rgb24";
}

function parseResolution(res: string): { width: number; height: number } {
  const parts = res.split("x");
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  return { width: w, height: h };
}

export async function extractFrameByIndex(
  filePath: string,
  frameIndex: number,
  options: FrameExtractorOptions,
  fps?: number,
): Promise<ExtractedFrame> {
  const cached = await options.cache.getFrame(filePath, frameIndex);
  if (cached) {
    const { width, height } = await getVideoResolution(filePath);
    return { buffer: cached, width, height, format: "rgba" };
  }

  const { width, height } = await getVideoResolution(filePath);
  const buffer = await extractFrameWithFfmpeg(filePath, frameIndex, width, height, fps);
  await options.cache.setFrame(filePath, frameIndex, buffer);

  return { buffer, width, height, format: "rgba" };
}

export async function getVideoResolution(filePath: string): Promise<{ width: number; height: number }> {
  const ffprobeStatic = await getFfprobeStatic();
  return new Promise((resolve, reject) => {
    const args = [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0:s=x",
      filePath,
    ];

    const child = spawn(ffprobeStatic.path, args, { windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error("Failed to get video resolution"));
        return;
      }
      const trimmed = stdout.trim();
      if (trimmed) {
        resolve(parseResolution(trimmed));
      } else {
        reject(new Error("No video stream found"));
      }
    });
    child.on("error", reject);
  });
}

/**
 * Lanczos scaling — the gold standard for video downscaling. Produces
 * noticeably sharper frames than bilinear with only a modest CPU cost, and
 * the difference is fully preserved once H.264 encodes the output.
 */
const SCALE_FILTER = "scale=w=iw:h=ih:flags=lanczos";

async function extractFrameWithFfmpeg(
  filePath: string,
  frameIndex: number,
  width: number,
  height: number,
  fps: number = 30,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const seekTime = frameIndex / fps;
    const args = [
      "-v", "error",
      "-ss", String(seekTime),
      "-i", filePath,
      "-frames:v", "1",
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-vf", SCALE_FILTER,
      "-",
    ];

    const child = spawn(ffmpegStatic.path, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk) => { chunks.push(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg frame extraction failed: ${stderr}`));
        return;
      }
      const buffer = Buffer.concat(chunks);
      if (buffer.length !== width * height * 4) {
        reject(new Error(`Frame buffer size mismatch: expected ${width * height * 4}, got ${buffer.length}`));
        return;
      }
      resolve(buffer);
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });
  });
}

/**
 * Extract multiple consecutive frames using a single ffmpeg process.
 * Much faster than N separate invocations. Uses Lanczos scaling for quality.
 */
async function extractFrameBatchWithFfmpeg(
  filePath: string,
  startFrame: number,
  count: number,
  width: number,
  height: number,
  fps: number = 30,
): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const seekTime = startFrame / fps;
    const args = [
      "-v", "error",
      "-ss", String(seekTime),
      "-i", filePath,
      "-frames:v", String(count),
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-vf", SCALE_FILTER,
      "-",
    ];

    const child = spawn(ffmpegStatic.path, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk) => { chunks.push(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(createError(ErrorCode.CC4001, { frame: startFrame, source: filePath, reason: stderr.trim() || `ffmpeg exited with code ${code}` }, { location: { file: filePath } }));
        return;
      }
      const buffer = Buffer.concat(chunks);
      const frameSize = width * height * 4;
      if (buffer.length === 0) {
        reject(new Error("ffmpeg batch frame extraction returned no data"));
        return;
      }

      // A run that starts near the end of the file comes back short of the
      // requested count. Return every complete frame instead of failing the
      // whole batch — the caller clamps what it does not need.
      const available = Math.floor(buffer.length / frameSize);
      const frameBuffers: Buffer[] = [];
      for (let i = 0; i < available; i++) {
        frameBuffers.push(buffer.subarray(i * frameSize, (i + 1) * frameSize));
      }
      resolve(frameBuffers);
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });
  });
}

export async function extractFramesByIndex(
  filePath: string,
  startFrame: number,
  count: number,
  options: FrameExtractorOptions,
  fps?: number,
): Promise<ExtractedFrame[]> {
  const frames: ExtractedFrame[] = [];

  const cachedResult = await options.cache.getBatchFrames(filePath, startFrame, count);
  if (cachedResult) {
    let resolution: { width: number; height: number };
    try {
      resolution = await getVideoResolution(filePath);
    } catch (error) {
      throw createError(
        ErrorCode.CC2003,
        { path: filePath, reason: "cached frames exist but the video resolution is unreadable" },
        { location: { file: filePath }, cause: error },
      );
    }
    return cachedResult.map((buffer) => ({ buffer, ...resolution, format: "rgba" as const }));
  }

  try {
    const { width, height } = await getVideoResolution(filePath);
    const buffer = await extractFrameBatchWithFfmpeg(filePath, startFrame, count, width, height, fps);

    for (let i = 0; i < buffer.length; i++) {
      const frameBuffer = buffer[i];
      if (frameBuffer) {
        await options.cache.setFrame(filePath, startFrame + i, frameBuffer);
      }
    }

    for (let i = 0; i < buffer.length; i++) {
      const frameBuffer = buffer[i];
      if (frameBuffer) {
        frames.push({ buffer: frameBuffer, width, height, format: "rgba" });
      }
    }
  } catch (error) {
    recordDegradation({
      code: "CC4001",
      what: "batch frame extraction failed",
      reason: error instanceof Error ? error.message : String(error),
      input: filePath,
      instead: "frames are decoded one at a time",
    });
    for (let i = 0; i < count; i++) {
      try {
        frames.push(await extractFrameByIndex(filePath, startFrame + i, options, fps));
      } catch (frameError) {
        throw createError(
          ErrorCode.CC4001,
          { frame: startFrame + i, source: filePath },
          { location: { file: filePath }, cause: frameError },
        );
      }
    }
  }

  return frames;
}

/**
 * Decode `count` frames starting at `startFrame` entirely in memory — no disk
 * cache writes. Video sources are large (raw RGBA runs into GBs over a full
 * composition), so the renderer keeps these in a bounded LRU instead.
 */
export async function extractFramesInMemory(
  filePath: string,
  startFrame: number,
  count: number,
  resolution?: { readonly width: number; readonly height: number },
  fps?: number,
): Promise<ExtractedFrame[]> {
  if (count <= 0) return [];
  const { width, height } = resolution ?? (await getVideoResolution(filePath));
  const buffers = await extractFrameBatchWithFfmpeg(filePath, startFrame, count, width, height, fps);
  return buffers.map((buffer) => ({ buffer, width, height, format: "rgba" as const }));
}

export type FrameOutputFormat = "rgba" | "png" | "webp";

export interface FrameExtractOptions {
  readonly format?: FrameOutputFormat;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly quality?: number;
  readonly cache?: FrameCache;
  readonly useCache?: boolean;
}

function outputFormatArgs(format: FrameOutputFormat, quality: number): string[] {
  switch (format) {
    case "rgba":
      return ["-f", "rawvideo", "-pix_fmt", "rgba"];
    case "webp":
      return ["-f", "image2pipe", "-c:v", "libwebp", "-quality", String(Math.max(1, Math.min(100, quality)))];
    case "png":
      return ["-f", "image2pipe", "-c:v", "png"];
  }
}

function scaleArgs(options: FrameExtractOptions): string[] {
  if (options.width === undefined && options.height === undefined) return [];
  const width = options.width !== undefined ? String(Math.max(1, Math.round(options.width))) : "-2";
  const height = options.height !== undefined ? String(Math.max(1, Math.round(options.height))) : "-2";
  return ["-vf", `scale=${width}:${height}:flags=lanczos`];
}

function seekToTimestamp(timestampSeconds: number): number {
  if (!Number.isFinite(timestampSeconds)) return 0;
  return Math.max(0, timestampSeconds);
}

function collectFfmpeg(args: readonly string[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(ffmpegStatic.path, [...args], { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`[CC2601] frame extraction failed: ${stderr.trim() || `exit code ${code}`}`));
        return;
      }
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) {
        reject(new Error("[CC2602] frame extraction produced no data; check the timestamp is inside the media duration"));
        return;
      }
      resolve(buffer);
    });
  });
}

async function extractFrameUncached(
  videoPath: string,
  timestampSeconds: number,
  options: FrameExtractOptions,
): Promise<Buffer> {
  const format = options.format ?? "png";
  const timestamp = seekToTimestamp(timestampSeconds);
  return collectFfmpeg([
    "-v", "error",
    "-ss", String(timestamp),
    "-accurate_seek",
    "-i", videoPath,
    "-frames:v", "1",
    ...scaleArgs(options),
    ...outputFormatArgs(format, options.quality ?? 82),
    "-",
  ]);
}

export async function extractFrame(
  videoPath: string,
  timestampSeconds: number,
  options: FrameExtractOptions = {},
): Promise<Buffer> {
  if (options.useCache === false) return extractFrameUncached(videoPath, timestampSeconds, options);
  const cache = options.cache ?? getDefaultFrameCache();
  const key = frameCacheKey({
    source: videoPath,
    timestamp: timestampSeconds,
    format: options.format ?? "png",
    width: options.width,
    height: options.height,
  });
  return cache.getOrLoad(key, () => extractFrameUncached(videoPath, timestampSeconds, options));
}

export async function extractFrames(
  videoPath: string,
  timestamps: readonly number[],
  options: FrameExtractOptions = {},
): Promise<Buffer[]> {
  if (timestamps.length === 0) return [];
  const frames: Buffer[] = [];
  for (const timestamp of timestamps) {
    frames.push(await extractFrame(videoPath, timestamp, options));
  }
  return frames;
}

export async function* extractFrameRange(
  videoPath: string,
  startSec: number,
  endSec: number,
  fps: number,
  options: FrameExtractOptions = {},
): AsyncIterable<Buffer> {
  const start = seekToTimestamp(startSec);
  const end = Math.max(start, endSec);
  const duration = end - start;
  if (duration <= 0 || fps <= 0) return;
  const resolution = await getVideoResolution(videoPath).catch(() => ({ width: 1920, height: 1080 }));
  const width = options.width !== undefined ? Math.max(1, Math.round(options.width)) : resolution.width;
  const height = options.height !== undefined ? Math.max(1, Math.round(options.height)) : resolution.height;
  const frameBytes = width * height * 4;
  const args = [
    "-v", "error",
    "-ss", String(start),
    "-i", videoPath,
    "-t", String(duration),
    "-vf", `fps=${fps},scale=${width}:${height}:flags=lanczos`,
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-",
  ];
  const child = spawn(ffmpegStatic.path, args, { windowsHide: true });
  const queue: Buffer[] = [];
  let pending: Buffer = Buffer.alloc(0);
  let stderr = "";
  let finished = false;
  let failure: Error | null = null;
  let notify: (() => void) | null = null;

  const wake = (): void => {
    const resolver = notify;
    notify = null;
    resolver?.();
  };

  child.stdout.on("data", (chunk: Buffer) => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    while (pending.length >= frameBytes) {
      queue.push(Buffer.from(pending.subarray(0, frameBytes)));
      pending = pending.subarray(frameBytes);
    }
    wake();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.on("error", (error) => {
    failure = new Error(`Failed to spawn ffmpeg: ${error.message}`);
    finished = true;
    wake();
  });
  child.on("close", (code) => {
    if (code !== 0) failure = new Error(`[CC2601] frame range extraction failed: ${stderr.trim() || `exit code ${code}`}`);
    finished = true;
    wake();
  });

  try {
    while (!finished || queue.length > 0) {
      const frame = queue.shift();
      if (frame) {
        yield frame;
        continue;
      }
      if (finished) break;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
    if (failure) throw failure;
  } finally {
    if (!child.killed && !finished) child.kill("SIGKILL");
  }
}
