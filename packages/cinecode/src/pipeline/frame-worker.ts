import { parentPort } from "node:worker_threads";
import type { Composition, FontEntry } from "../core/types/index.js";
import {
  primeVideoFramesForRange,
  createRenderSession,
  clearRendererCaches,
} from "../renderer/engine.js";
import { registerProjectFonts } from "../renderer/text/fonts.js";
import { setExtensions } from "../extensions/index.js";
import { installExtensionDescriptor, type ExtensionDescriptor } from "../plugin/descriptor.js";
import { createRenderRuntime, type RenderRuntime } from "../renderer/runtime.js";
import { frameTransfer } from "./frame-format.js";
import { createError, ErrorCode } from "../errors/index.js";
import { setBinaryConfig } from "../binary/resolver.js";
import { setInvocationState } from "../observability/invocation-context.js";
import {
  disableWorkerLocalDecode,
  resetWorkerLocalDecode,
  fetchRemoteFrames,
} from "./worker-remote-frames.js";
import {
  type FrameErrorPolicy,
  type FrameFailure,
  DEFAULT_MAX_CONSECUTIVE_FAILURES,
} from "./frame-policy.js";
import { renderFrameBatch } from "./frame-batch.js";

export type { FrameErrorPolicy, FrameFailure };

interface WorkerStartup {
  compositionJson: string;
  seed: number;
  cacheDir: string;
  errorPolicy?: FrameErrorPolicy;
  maxConsecutiveFailures?: number;
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
  binaries?: {
    readonly ffmpegPath?: string;
    readonly ffprobePath?: string;
  };
  extensions?: ExtensionDescriptor;
  verbose?: boolean;
}

interface ChunkInput {
  frames: readonly number[];
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


async function processFrames(
  composition: Composition,
  seed: number,
  frames: readonly number[],
  policy: FrameErrorPolicy,
  maxConsecutiveFailures: number,
  frameWidth: number,
  frameHeight: number,
  runtime: RenderRuntime,
): Promise<WorkerOutput> {
  const session = workerSession ?? createRenderSession();
  await primeVideoFramesForRange(composition, frames);
  const cacheHits = await fetchRemoteFrames(parentPort, composition, frames);
  const output = await renderFrameBatch({
    composition,
    seed,
    frames,
    policy,
    maxConsecutiveFailures,
    frameWidth,
    frameHeight,
    runtime,
    session,
  });
  return { ...output, cacheHits };
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
  readonly maxConsecutiveFailures: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly runtime: RenderRuntime;
  readonly crashOnFrame?: number;
}

let state: WorkerState | null = null;
let workerSession: import("../renderer/engine.js").RenderSession | null = null;

async function initialize(startup: WorkerStartup): Promise<void> {
  const started = Date.now();
  if (startup.verbose !== undefined) setInvocationState({ verbose: startup.verbose });
  if (startup.binaries) {
    setBinaryConfig({
      ffmpegPath: startup.binaries.ffmpegPath,
      ffprobePath: startup.binaries.ffprobePath,
      root: startup.projectRoot,
    });
  }
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
  if (workerSession) {
    workerSession.dispose();
    workerSession = null;
  }
  workerSession = createRenderSession();
  clearRendererCaches();
  resetWorkerLocalDecode();

  const workerRegistry = await installExtensionDescriptor(
    startup.extensions ?? { version: "1", plugins: [], effects: [], transitions: [] },
    startup.projectRoot,
  );
  setExtensions(workerRegistry);

  state = {
    composition,
    seed: startup.seed,
    cacheDir: startup.cacheDir,
    policy: startup.errorPolicy ?? "placeholder",
    maxConsecutiveFailures: startup.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES,
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
    resetWorkerLocalDecode();
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
    resetWorkerLocalDecode();
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
        current.maxConsecutiveFailures,
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
        // Note: repeat-previous reuses one buffer; duplicate buffers must be cloned
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
