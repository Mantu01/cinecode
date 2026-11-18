import { parentPort, workerData } from "node:worker_threads";
import { Canvas } from "@napi-rs/canvas";
import { join } from "node:path";
import type { Composition, FontEntry } from "../core/types/index.js";
import {
  renderFrame,
  primeVideoFramesForRange,
  setMediaCacheForRenderer,
  videoFrameRefsFor,
  hasVideoFrameCached,
  storeRemoteVideoFrame,
  createRenderSession,
  clearRendererCaches,
} from "../renderer/engine.js";
import { createMediaCache } from "../media/cache.js";
import { createCacheClient } from "./cache-channel.js";
import { registerProjectFonts } from "../renderer/text/fonts.js";
import { createBuiltinRegistry } from "../extensions/bootstrap.js";
import { createRenderRuntime, type RenderRuntime } from "../renderer/runtime.js";
import { frameFromPixels, frameTransfer } from "./frame-format.js";

export type FrameErrorPolicy = "placeholder" | "repeat-previous" | "abort";

interface WorkerStartup {
  compositionJson: string;
  seed: number;
  cacheDir: string;
  errorPolicy?: FrameErrorPolicy;
  frameWidth?: number;
  frameHeight?: number;
  fonts?: readonly FontEntry[];
  projectRoot?: string;
  mediaDir?: string;
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

interface TransportFrame {
  readonly index: number;
  readonly pixels: Uint8Array;
}

const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_FAILURE_RATIO = 0.02;

/** One read out of the canvas; straight RGBA with its own transferable buffer. */
function frameToBuffer(canvas: Canvas): Buffer {
  const imageData = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  return frameFromPixels(imageData.data);
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

function isCircuitBroken(
  failures: number,
  consecutiveFailures: number,
  totalFrames: number,
): boolean {
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

async function fetchRemoteFrames(
  composition: Composition,
  frames: readonly number[],
): Promise<void> {
  const cacheClient = parentPort ? createCacheClient(parentPort) : null;
  if (!cacheClient) return;
  const refs = await videoFrameRefsFor(composition, frames);
  const misses = refs.filter((ref) => !hasVideoFrameCached(ref.src, ref.sourceFrame));
  for (const ref of misses) {
    const response = await cacheClient.request(`video:${ref.src}@${ref.sourceFrame}`);
    if (!response.hit || !response.data) continue;
    const payload = JSON.parse(response.data.toString("utf8")) as {
      buffer: string;
      width: number;
      height: number;
      format: "rgba" | "rgb24";
    };
    storeRemoteVideoFrame(
      ref.src,
      {
        buffer: Buffer.from(payload.buffer, "base64"),
        width: payload.width,
        height: payload.height,
        format: payload.format,
      },
      ref.sourceFrame,
    );
  }
}

async function processFrames(
  composition: Composition,
  seed: number,
  frames: readonly number[],
  policy: FrameErrorPolicy,
  frameWidth: number,
  frameHeight: number,
  runtime: RenderRuntime,
): Promise<WorkerOutput> {
  const results: { index: number; buffer: Buffer }[] = [];
  const failures: FrameFailure[] = [];
  const session = createRenderSession();
  let consecutiveFailures = 0;
  let previousBuffer: Buffer | null = null;

  await primeVideoFramesForRange(composition, frames);
  await fetchRemoteFrames(composition, frames);

  for (const frame of frames) {
    try {
      const result = await renderFrame(composition, frame, seed, { runtime, session });
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
      console.error(
        JSON.stringify({
          level: "error",
          stage: "frame-render",
          frame,
          timecodeSeconds: failure.timecode,
          clip: failure.clip,
          message: failure.message,
        }),
      );

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

      results.push({
        index: frame,
        buffer: placeholderBuffer(frameWidth, frameHeight, failure.message),
      });
    }
  }

  return {
    frames: results,
    failures,
    ...(failures.length > 0 ? { diagnostics: formatDiagnostics(failures, frames.length) } : {}),
  };
}

function formatDiagnostics(failures: readonly FrameFailure[], total: number): string {
  const head = failures
    .slice(0, 8)
    .map(
      (failure) => `frame ${failure.frame} (${failure.timecode.toFixed(3)}s): ${failure.message}`,
    );
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
const fontResult = registerProjectFonts(startup.fonts, {
  projectRoot: startup.projectRoot ?? process.cwd(),
  mediaDir: startup.mediaDir ?? "media",
});
if (fontResult.errors.length > 0) throw new Error(fontResult.errors[0]!.message);
const runtime = createRenderRuntime(createBuiltinRegistry(), "worker");

process.once("exit", clearRendererCaches);

parentPort!.on("message", (msg: ChunkInput) => {
  if ((msg as { type?: string }).type === "cache-response") return;
  ensureMediaCache(cacheDir)
    .then(() => processFrames(composition, seed, msg.frames, policy, frameWidth, frameHeight, runtime))
    .then((output) => {
      const frames: TransportFrame[] = [];
      const transfer: ArrayBuffer[] = [];
      const moved = new Set<ArrayBuffer>();
      for (const frame of output.frames) {
        // repeat-previous reuses one buffer; a moved buffer cannot be sent twice
        const buffer = moved.has(frame.buffer.buffer as ArrayBuffer) ? Buffer.from(frame.buffer) : frame.buffer;
        const sent = frameTransfer(buffer);
        moved.add(sent.transfer);
        frames.push({ index: frame.index, pixels: sent.view });
        transfer.push(sent.transfer);
      }
      parentPort!.postMessage({ ...output, frames }, transfer);
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
