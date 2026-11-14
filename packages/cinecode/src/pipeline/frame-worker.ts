import { parentPort, workerData } from "node:worker_threads";
import { Canvas } from "@napi-rs/canvas";
import { join } from "node:path";
import type { Composition } from "../core/types/index.js";
import { renderFrame, primeVideoFramesForRange, setMediaCacheForRenderer } from "../renderer/engine.js";
import { createMediaCache } from "../media/cache.js";

export type FrameErrorPolicy = "placeholder" | "repeat-previous" | "abort";

interface WorkerStartup {
  compositionJson: string;
  seed: number;
  cacheDir: string;
  errorPolicy?: FrameErrorPolicy;
  frameWidth?: number;
  frameHeight?: number;
}

interface ChunkInput {
  frames: readonly number[];
}

export interface FrameFailure {
  readonly frame: number;
  readonly timecode: number;
  readonly message: string;
  readonly stack?: string;
  readonly clip?: string;
}

interface WorkerOutput {
  frames: readonly { index: number; buffer: Buffer }[];
  error?: string;
  failures?: readonly FrameFailure[];
  aborted?: boolean;
  diagnostics?: string;
}

const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_FAILURE_RATIO = 0.02;

function frameToBuffer(canvas: Canvas): Buffer {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bgra = new Uint8Array(imageData.data.length);
  for (let i = 0; i < imageData.data.length; i += 4) {
    bgra[i] = imageData.data[i + 2]!;
    bgra[i + 1] = imageData.data[i + 1]!;
    bgra[i + 2] = imageData.data[i]!;
    bgra[i + 3] = imageData.data[i + 3]!;
  }
  return Buffer.from(bgra.buffer);
}

function placeholderBuffer(width: number, height: number, message: string): Buffer {
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101418";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255, 64, 64, 0.18)";
  ctx.fillRect(0, 0, width, height);
  const fontSize = Math.max(12, Math.min(48, Math.round(width / 24)));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
  ctx.fillText("FRAME RENDER ERROR", width / 2, height / 2 - fontSize);
  ctx.font = `${Math.max(10, Math.round(fontSize * 0.5))}px sans-serif`;
  ctx.fillStyle = "rgba(255, 220, 220, 0.7)";
  const trimmed = message.length > 96 ? `${message.slice(0, 93)}...` : message;
  ctx.fillText(trimmed, width / 2, height / 2 + fontSize * 0.8);
  return frameToBuffer(canvas);
}

function extractClipReference(message: string): string | undefined {
  const match = message.match(/clip\s+"([^"]+)"/i);
  return match?.[1];
}

function isCircuitBroken(failures: number, consecutiveFailures: number, totalFrames: number): boolean {
  if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) return true;
  if (totalFrames === 0) return false;
  return failures / totalFrames > MAX_FAILURE_RATIO;
}

let ready: Promise<void> | null = null;
function ensureMediaCache(cacheDir: string): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const mediaCache = createMediaCache(join(cacheDir, "media"));
      await mediaCache.initialize();
      setMediaCacheForRenderer(mediaCache);
    })();
  }
  return ready;
}

async function processFrames(
  composition: Composition,
  seed: number,
  frames: readonly number[],
  policy: FrameErrorPolicy,
  frameWidth: number,
  frameHeight: number,
): Promise<WorkerOutput> {
  const results: { index: number; buffer: Buffer }[] = [];
  const failures: FrameFailure[] = [];
  let consecutiveFailures = 0;
  let previousBuffer: Buffer | null = null;

  await primeVideoFramesForRange(composition, frames);

  for (const frame of frames) {
    try {
      const result = await renderFrame(composition, frame, seed);
      const buffer = frameToBuffer(result.canvas);
      results.push({ index: frame, buffer });
      previousBuffer = buffer;
      consecutiveFailures = 0;
    } catch (error) {
      const failure: FrameFailure = {
        frame,
        timecode: frame / Math.max(1, composition.fps),
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        clip: error instanceof Error ? extractClipReference(error.message) : undefined,
      };
      failures.push(failure);
      consecutiveFailures += 1;
      console.error(JSON.stringify({
        level: "error",
        stage: "frame-render",
        frame,
        timecodeSeconds: failure.timecode,
        clip: failure.clip,
        message: failure.message,
      }));

      if (policy === "abort") {
        return {
          frames: results,
          failures,
          aborted: true,
          error: failure.message,
          diagnostics: formatDiagnostics(failures, frames.length),
        };
      }

      if (isCircuitBroken(failures.length, consecutiveFailures, frames.length)) {
        return {
          frames: results,
          failures,
          aborted: true,
          error: `[CC4003] circuit breaker tripped after ${failures.length} failed frame(s): ${failure.message}`,
          diagnostics: formatDiagnostics(failures, frames.length),
        };
      }

      if (policy === "repeat-previous" && previousBuffer) {
        results.push({ index: frame, buffer: previousBuffer });
        continue;
      }

      results.push({ index: frame, buffer: placeholderBuffer(frameWidth, frameHeight, failure.message) });
    }
  }

  return {
    frames: results,
    failures,
    ...(failures.length > 0 ? { diagnostics: formatDiagnostics(failures, frames.length) } : {}),
  };
}

function formatDiagnostics(failures: readonly FrameFailure[], total: number): string {
  const head = failures.slice(0, 8).map((failure) => `frame ${failure.frame} (${failure.timecode.toFixed(3)}s): ${failure.message}`);
  return [
    `failed frames: ${failures.length}/${total}`,
    ...head,
    ...(failures.length > head.length ? [`... ${failures.length - head.length} more`] : []),
  ].join("\n");
}

if (!parentPort) {
  throw new Error("Frame worker must be run as a worker thread");
}

const startup = workerData as WorkerStartup;
if (!startup || !startup.compositionJson) {
  process.exit(0);
}
const { seed, cacheDir } = startup;
const policy: FrameErrorPolicy = startup.errorPolicy ?? "placeholder";
const composition = JSON.parse(startup.compositionJson) as Composition;
const frameWidth = startup.frameWidth ?? composition.width;
const frameHeight = startup.frameHeight ?? composition.height;

parentPort!.on("message", (msg: ChunkInput) => {
  ensureMediaCache(cacheDir)
    .then(() => processFrames(composition, seed, msg.frames, policy, frameWidth, frameHeight))
    .then((output) => {
      parentPort!.postMessage(output);
    })
    .catch((error) => {
      parentPort!.postMessage({
        frames: [],
        error: error instanceof Error ? error.message : "Unknown error",
        aborted: true,
        diagnostics: error instanceof Error ? error.stack : undefined,
      });
    });
});
