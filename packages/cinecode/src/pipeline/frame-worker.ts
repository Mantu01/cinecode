import { parentPort } from "node:worker_threads";
import { Canvas } from "@napi-rs/canvas";
import type { Composition, FontEntry } from "../core/types/index.js";
import {
  renderFrame,
  primeVideoFramesForRange,
  setDisableLocalVideoDecode,
  videoFrameRefsFor,
  hasVideoFrameCached,
  storeRemoteVideoFrame,
  createRenderSession,
  clearRendererCaches,
} from "../renderer/engine.js";
import { createCacheClient } from "./cache-channel.js";
import { registerProjectFonts } from "../renderer/text/fonts.js";
import { createBuiltinRegistry } from "../extensions/bootstrap.js";
import { setExtensions } from "../extensions/index.js";
import { PluginRegistry } from "../plugin/registry.js";
import { loadPlugin } from "../plugin/loader.js";
import { createRenderRuntime, type RenderRuntime } from "../renderer/runtime.js";
import { frameFromPixels, frameTransfer } from "./frame-format.js";
import { createError, ErrorCode } from "../errors/index.js";

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
  crashOnFrame?: number;
  plugins?: readonly {
    readonly name: string;
    readonly source?: string;
    readonly options?: Readonly<Record<string, unknown>>;
  }[];
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
  cacheHits?: number;
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
function disableWorkerLocalDecode(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      setDisableLocalVideoDecode(true);
    })();
  }
  return ready;
}

async function fetchRemoteFrames(
  composition: Composition,
  frames: readonly number[],
): Promise<number> {
  const cacheClient = parentPort ? createCacheClient(parentPort) : null;
  if (!cacheClient) return 0;
  const refs = await videoFrameRefsFor(composition, frames);
  const misses = refs.filter((ref) => !hasVideoFrameCached(ref.src, ref.sourceFrame));
  const hits = refs.length - misses.length;
  if (misses.length === 0) return hits;

  const keys = misses.map((ref) => `video:${ref.src}@${ref.sourceFrame}`);
  const responses = await cacheClient.requestBatch(keys);
  for (let i = 0; i < misses.length; i++) {
    const ref = misses[i]!;
    const response = responses[i];
    if (!response || !response.hit || !response.data) {
      if (response?.error) {
        throw new Error(`[CC4001] Remote decode error: ${response.error}`);
      }
      continue;
    }
    if (response.width !== undefined && response.height !== undefined) {
      storeRemoteVideoFrame(
        ref.src,
        {
          buffer: response.data,
          width: response.width,
          height: response.height,
          format: (response.format as "rgba" | "rgb24") ?? "rgba",
        },
        ref.sourceFrame,
      );
    } else {
      try {
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
      } catch {}
    }
  }
  return hits;
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
  const session = workerSession ?? createRenderSession();
  let consecutiveFailures = 0;
  let previousBuffer: Buffer | null = null;

  await primeVideoFramesForRange(composition, frames);
  const cacheHits = await fetchRemoteFrames(composition, frames);

  for (const frame of frames) {
    try {
      const result = await renderFrame(composition, frame, seed, { runtime, session });
      const buffer = frameToBuffer(result.canvas);
      results.push({ index: frame, buffer });
      previousBuffer = buffer;
      consecutiveFailures = 0;
    } catch (error) {
      session.lastFrameSurface = null;
      const failure: FrameFailure = {
        frame,
        timecode: frame / Math.max(1, composition.fps),
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        clip: error instanceof Error ? extractClipReference(error.message) : undefined,
      };
      failures.push(failure);
      consecutiveFailures += 1;
      if (process.env.CINECODE_VERBOSE === "1") {
        process.stderr.write(
          JSON.stringify({
            level: "error",
            stage: "frame-render",
            frame,
            timecodeSeconds: failure.timecode,
            clip: failure.clip,
            message: failure.message,
          }) + "\n",
        );
      }

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
    cacheHits,
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
  throw createError(
    ErrorCode.CC7004,
    { reason: "frame worker must be run inside a worker thread" },
    { fixHint: "Run renders through the pipeline or CLI; frame-worker.ts is not a standalone entry." },
  );
}

interface InitMessage {
  readonly type: "init";
  readonly payload: WorkerStartup;
}

interface ResetMessage {
  readonly type: "reset";
}

interface ShutdownMessage {
  readonly type: "shutdown";
}

type WorkerMessage = ChunkInput | InitMessage | ResetMessage | ShutdownMessage | { type: "cache-response" };

interface WorkerState {
  readonly composition: Composition;
  readonly seed: number;
  readonly cacheDir: string;
  readonly policy: FrameErrorPolicy;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly runtime: RenderRuntime;
  readonly crashOnFrame?: number;
}

let state: WorkerState | null = null;
let workerSession: import("../renderer/engine.js").RenderSession | null = null;

async function initialize(startup: WorkerStartup): Promise<void> {
  const started = Date.now();
  if (!startup.compositionJson) {
    throw createError(ErrorCode.CC9001, { reason: "frame worker init payload has no composition" }, {
      fixHint: "Retry the render; if it persists the pipeline sent an invalid worker payload.",
    });
  }
  let composition: Composition;
  try {
    composition = JSON.parse(startup.compositionJson) as Composition;
  } catch (error) {
    throw createError(ErrorCode.CC9001, {
      reason: `frame worker could not parse the composition payload: ${error instanceof Error ? error.message : String(error)}`,
    }, { fixHint: "Retry the render; the composition payload was not valid JSON." });
  }
  const fontResult = registerProjectFonts(startup.fonts, {
    projectRoot: startup.projectRoot ?? process.cwd(),
    mediaDir: startup.mediaDir ?? "media",
  });
  if (fontResult.errors.length > 0) {
    const font = fontResult.errors[0]!;
    throw createError(
      ErrorCode.CC3006,
      { family: font.family, missing: font.message },
      { location: { file: font.path }, fixHint: "Fix the font entry path or register a family available on this machine." },
    );
  }
  // Per-job state never leaks across jobs when a worker is reused.
  if (workerSession) {
    workerSession.dispose();
    workerSession = null;
  }
  workerSession = createRenderSession();
  clearRendererCaches();
  ready = null;

  const workerRegistry = createBuiltinRegistry();
  setExtensions(workerRegistry);
  if (startup.plugins && startup.plugins.length > 0) {
    const workerPluginRegistry = new PluginRegistry();
    for (const p of startup.plugins) {
      if (p.source) {
        try {
          const plugin = await loadPlugin(p.source, {
            options: p.options as Record<string, unknown>,
            registry: workerPluginRegistry,
            rootDir: startup.projectRoot,
          });
          if (plugin.effects) {
            for (const effect of plugin.effects) {
              workerRegistry.slot("effect").register(effect.name, effect);
              workerRegistry.slot("effect").register(`${plugin.manifest.name}/${effect.name}`, effect);
              workerRegistry.slot("effect").register(`${plugin.manifest.name}:${effect.name}`, effect);
            }
          }
          if (plugin.transitions) {
            for (const transition of plugin.transitions) {
              workerRegistry.slot("transition").register(transition.name, transition);
              workerRegistry.slot("transition").register(`${plugin.manifest.name}/${transition.name}`, transition);
              workerRegistry.slot("transition").register(`${plugin.manifest.name}:${transition.name}`, transition);
            }
          }
        } catch (err) {
          if (process.env.CINECODE_VERBOSE === "1") {
            process.stderr.write(`[frame-worker] failed to load plugin ${p.name}: ${String(err)}\n`);
          }
        }
      }
    }
    await workerPluginRegistry.init(workerRegistry);
  }

  state = {
    composition,
    seed: startup.seed,
    cacheDir: startup.cacheDir,
    policy: startup.errorPolicy ?? "placeholder",
    frameWidth: startup.frameWidth ?? composition.width,
    frameHeight: startup.frameHeight ?? composition.height,
    runtime: createRenderRuntime(workerRegistry, "worker"),
    crashOnFrame: startup.crashOnFrame,
  };
  parentPort!.postMessage({ type: "ready", startupMs: Date.now() - started });
}

process.once("exit", () => {
  if (workerSession) {
    workerSession.dispose();
    workerSession = null;
  }
  clearRendererCaches();
});

parentPort.on("message", (msg: WorkerMessage) => {
  const type = (msg as { type?: string }).type;
  if (type === "cache-response") return;
  if (type === "init") {
    initialize((msg as InitMessage).payload).catch((error: unknown) => {
      parentPort!.postMessage({
        type: "init-error",
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return;
  }
  if (type === "reset") {
    if (workerSession) {
      workerSession.dispose();
      workerSession = null;
    }
    clearRendererCaches();
    ready = null;
    state = null;
    parentPort!.postMessage({ type: "reset-complete" });
    return;
  }
  if (type === "shutdown") {
    if (workerSession) {
      workerSession.dispose();
      workerSession = null;
    }
    clearRendererCaches();
    ready = null;
    state = null;
    process.exit(0);
  }
  const current = state;
  if (!current) {
    parentPort!.postMessage({
      frames: [],
      error: "[CC4008] worker received a chunk before its bootstrap message",
      aborted: true,
    });
    return;
  }
  const chunkFrames = (msg as ChunkInput).frames ?? (msg as { frames?: readonly number[] }).frames;
  if (current.crashOnFrame !== undefined && chunkFrames?.includes(current.crashOnFrame)) {
    process.exit(1);
  }
  disableWorkerLocalDecode()
    .then(() =>
      processFrames(
        current.composition,
        current.seed,
        chunkFrames,
        current.policy,
        current.frameWidth,
        current.frameHeight,
        current.runtime,
      ),
    )
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
