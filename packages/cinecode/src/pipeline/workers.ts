import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Composition, FontEntry } from "../core/types/index.js";
import type { ByteBudget } from "./memory.js";
import { estimateChunkBytes, formatBytes } from "./memory.js";
import { frameFromTransfer } from "./frame-format.js";
import { createError, ErrorCode } from "../errors/codes.js";
import { attachCacheChannel, type CacheProvider, type BatchCacheProvider } from "./cache-channel.js";
import type { FrameErrorPolicy, FrameFailure } from "./frame-worker.js";

const WORKER_FILENAME = "frame-worker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const getWorkerPath = (): string => {
  return join(__dirname, WORKER_FILENAME);
};

/**
 * Worker startup cost, kept as data: each worker boots the canvas backend and
 * builds a runtime, measured from thread creation to the `ready` message.
 */
export interface WorkerStartupMeasurement {
  readonly workers: number;
  readonly startupMs: number;
  /** Time one worker took to answer `init`. */
  readonly perWorkerMs: number;
}

export interface WorkerThroughputMeasurement {
  readonly frames: number;
  readonly durationMs: number;
  readonly fps: number;
}

export interface PluginWorkerBootstrap {
  readonly name: string;
  readonly source?: string;
  readonly options?: Readonly<Record<string, unknown>>;
}

export interface WorkerManagerOptions {
  readonly concurrency: number;
  readonly composition: Composition;
  readonly seed: number;
  /** Render cache root — workers build their media cache under it. */
  readonly cacheDir: string;
  /** Shared render byte budget; each in-flight chunk reserves its estimate. */
  readonly budget?: ByteBudget;
  /** Largest single chunk the pool may dispatch. */
  readonly maxChunkBytes?: number;
  readonly onMemoryWarning?: (usageBytes: number, budgetBytes: number) => void;
  readonly errorPolicy?: FrameErrorPolicy;
  /** Main-thread cache provider for worker cache-miss requests. */
  readonly cacheProvider?: CacheProvider;
  readonly batchCacheProvider?: BatchCacheProvider;
  /** Configured fonts registered in each worker before rendering. */
  readonly fonts?: readonly FontEntry[];
  readonly projectRoot?: string;
  readonly mediaDir?: string;
  readonly crashOnFrame?: number;
  readonly plugins?: readonly PluginWorkerBootstrap[];
}

/**
 * Workers only ever draw visual clips (`renderFrame` skips audio tracks), but
 * the audio clip carries a multi-megabyte Float32Array that structured clone
 * would copy into every worker. Stripping audio tracks from the worker payload
 * keeps each clone small — important because the timeline is cloned once per
 * worker (11 on a 12-core machine), and re-sending it per chunk was enough to
 * exhaust memory ("Data cannot be cloned, out of memory").
 */
function stripAudioForWorkers(composition: Composition): Composition {
  const tracks = composition.rootTimeline.tracks;
  const visualTracks = tracks.filter((t) => t.kind !== "audio");
  if (visualTracks.length === tracks.length) return composition;
  return {
    ...composition,
    rootTimeline: { ...composition.rootTimeline, tracks: visualTracks },
  };
}

export interface FrameChunk {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly frames: readonly number[];
}

export interface WorkerResult {
  readonly chunkIndex: number;
  readonly frames: readonly { readonly index: number; readonly buffer: Buffer }[];
  readonly error?: string;
  readonly failures?: readonly FrameFailure[];
  readonly aborted?: boolean;
  readonly diagnostics?: string;
}

interface ActiveWorker {
  readonly worker: Worker;
  readonly promise: Promise<WorkerResult>;
  readonly resolve: (result: WorkerResult) => void;
  readonly reject: (error: Error) => void;
  readonly chunkIndex: number;
  readonly estimatedBytes: number;
}

interface TransportOutput extends Omit<WorkerResult, "frames"> {
  readonly frames: readonly (
    | { readonly index: number; readonly buffer: Buffer }
    | { readonly index: number; readonly pixels: ArrayBufferView }
  )[];
}

export interface WorkerPoolStats {
  readonly chunksInFlight: number;
  readonly reservedBytes: number;
  readonly peakReservedBytes: number;
  readonly budgetBytes: number;
  readonly transferredFrames: number;
}

let transferredFrames = 0;

/** Rebuilds transferred pixel buffers as frames, without copying pixels. */
function normalizeResult(output: TransportOutput, chunkIndex: number): WorkerResult {
  return {
    ...output,
    chunkIndex,
    frames: output.frames.map((frame) => {
      if (!("pixels" in frame)) return { index: frame.index, buffer: frame.buffer };
      transferredFrames += 1;
      return { index: frame.index, buffer: frameFromTransfer(frame.pixels, true) };
    }),
  };
}

export class WorkerManager {
  private readonly workers: Worker[] = [];
  private concurrency: number;
  /** Video-only timeline serialized once; cloned to workers as a flat string. */
  private compositionJson: string;
  private seed: number;
  private cacheDir: string;
  private pendingChunks: FrameChunk[] = [];
  private activeWorkers: ActiveWorker[] = [];
  private readonly chunkReservations = new Map<number, number>();
  private nextChunkIndex = 0;
  private initialized = false;
  private terminated = false;
  private budget: ByteBudget | undefined;
  private maxChunkBytes: number | undefined;
  private onMemoryWarning: ((usageBytes: number, budgetBytes: number) => void) | undefined;
  private warned = false;
  private frameWidth: number;
  private frameHeight: number;
  private errorPolicy: FrameErrorPolicy;
  private cacheProvider: CacheProvider;
  private batchCacheProvider?: BatchCacheProvider;
  private fonts: readonly FontEntry[] | undefined;
  private projectRoot: string;
  private mediaDir: string;
  private crashOnFrame: number | undefined;
  private plugins: readonly PluginWorkerBootstrap[] | undefined;
  private readonly startup: number[] = [];
  private startupMs = 0;
  private renderedFrames = 0;
  private renderDurationMs = 0;

  constructor(options: WorkerManagerOptions) {
    this.concurrency = options.concurrency;
    this.compositionJson = JSON.stringify(stripAudioForWorkers(options.composition));
    this.seed = options.seed;
    this.cacheDir = options.cacheDir;
    this.budget = options.budget;
    this.maxChunkBytes = options.maxChunkBytes;
    this.onMemoryWarning = options.onMemoryWarning;
    this.frameWidth = options.composition.width;
    this.frameHeight = options.composition.height;
    this.errorPolicy = options.errorPolicy ?? "placeholder";
    this.cacheProvider = options.cacheProvider ?? (async () => undefined);
    this.batchCacheProvider = options.batchCacheProvider;
    this.fonts = options.fonts;
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.mediaDir = options.mediaDir ?? "media";
    this.crashOnFrame = options.crashOnFrame;
    this.plugins = options.plugins;
  }

  isTerminated(): boolean {
    return this.terminated;
  }

  /** Reconfigures existing warm workers for a new job without recreating threads. */
  async reinit(options: WorkerManagerOptions): Promise<void> {
    if (this.terminated) {
      throw createError(ErrorCode.CC4003, { details: "cannot reinit terminated worker pool" });
    }
    this.concurrency = options.concurrency;
    this.compositionJson = JSON.stringify(stripAudioForWorkers(options.composition));
    this.seed = options.seed;
    this.cacheDir = options.cacheDir;
    this.budget = options.budget;
    this.maxChunkBytes = options.maxChunkBytes;
    this.onMemoryWarning = options.onMemoryWarning;
    this.frameWidth = options.composition.width;
    this.frameHeight = options.composition.height;
    this.errorPolicy = options.errorPolicy ?? "placeholder";
    this.cacheProvider = options.cacheProvider ?? (async () => undefined);
    this.batchCacheProvider = options.batchCacheProvider;
    this.fonts = options.fonts;
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.mediaDir = options.mediaDir ?? "media";
    this.crashOnFrame = options.crashOnFrame;
    this.plugins = options.plugins;
    this.warned = false;
    this.pendingChunks = [];
    this.activeWorkers = [];
    this.chunkReservations.clear();
    this.nextChunkIndex = 0;
    this.renderedFrames = 0;
    this.renderDurationMs = 0;

    if (this.workers.length > 0) {
      const bootstraps = this.workers.map((worker) => this.bootstrap(worker));
      try {
        await Promise.all(bootstraps);
      } catch (error) {
        await Promise.allSettled(bootstraps);
        throw error;
      }
    }
  }

  /** Byte estimate reserved for one chunk while its frames are in flight. */
  private chunkEstimate(chunk: FrameChunk): number {
    return this.budget ? estimateChunkBytes(chunk.frames.length, this.frameWidth, this.frameHeight) : 0;
  }

  private assertChunkFits(bytes: number): void {
    if (this.maxChunkBytes !== undefined && bytes > this.maxChunkBytes) {
      throw new Error(
        `Render chunk needs ${formatBytes(bytes)} of frames, over the ${formatBytes(this.maxChunkBytes)} chunk budget. Reduce the chunk size or raise the render memory budget.`,
      );
    }
  }

  private warnIfTight(): void {
    if (!this.budget || this.warned) return;
    if (this.budget.usedBytes > this.budget.limitBytes * 0.8) {
      this.warned = true;
      this.onMemoryWarning?.(this.budget.usedBytes, this.budget.limitBytes);
    }
  }

  /** Reserves in-flight chunk bytes when they fit, so dispatch never stalls. */
  private tryReserveChunk(chunk: FrameChunk): number | null {
    const bytes = this.chunkEstimate(chunk);
    if (!this.budget) return 0;
    this.assertChunkFits(bytes);
    if (!this.budget.tryReserve(bytes)) return null;
    this.warnIfTight();
    return bytes;
  }

  /** Waits for budget; only used when no chunk is in flight. */
  private async reserve(chunk: FrameChunk): Promise<number> {
    const bytes = this.chunkEstimate(chunk);
    if (!this.budget) return 0;
    this.assertChunkFits(bytes);
    await this.budget.reserve(bytes);
    this.warnIfTight();
    return bytes;
  }

  /** Frames of a finished chunk were encoded: give the budget back. */
  releaseChunk(result: WorkerResult): void {
    const active = this.chunkReservations.get(result.chunkIndex);
    if (!active) return;
    this.chunkReservations.delete(result.chunkIndex);
    this.budget?.release(active);
  }

  getStats(): WorkerPoolStats {
    let reserved = 0;
    for (const bytes of this.chunkReservations.values()) reserved += bytes;
    return {
      chunksInFlight: this.activeWorkers.length,
      reservedBytes: reserved,
      peakReservedBytes: this.budget?.peakBytes ?? 0,
      budgetBytes: this.budget?.limitBytes ?? 0,
      transferredFrames,
    };
  }

  private createWorker(): Worker {
    return new Worker(getWorkerPath());
  }

  private async initWorkers(): Promise<void> {
    if (this.terminated) {
      throw createError(ErrorCode.CC4003, { details: "worker pool already terminated" });
    }
    if (this.initialized) return;
    this.initialized = true;
    const bootstraps: Promise<void>[] = [];
    for (let i = 0; i < this.concurrency; i++) {
      const worker = this.createWorker();
      attachCacheChannel(worker, { single: this.cacheProvider, batch: this.batchCacheProvider });
      worker.on("message", (output: TransportOutput) => {
        const msgType = (output as { type?: string }).type;
        if (msgType === "cache-request" || msgType === "cache-batch-request") return;
        const active = this.activeWorkers.find((a) => a.worker === worker);
        if (active) active.resolve(normalizeResult(output, active.chunkIndex));
      });
      worker.on("error", (error) => {
        const activeIndex = this.activeWorkers.findIndex((a) => a.worker === worker);
        if (activeIndex >= 0) {
          const active = this.activeWorkers[activeIndex]!;
          this.activeWorkers.splice(activeIndex, 1);
          this.chunkReservations.delete(active.chunkIndex);
          this.budget?.release(active.estimatedBytes);
          active.reject(
            createError(
              ErrorCode.CC4001,
              { frame: active.chunkIndex, source: "worker", reason: error.message },
              { cause: error },
            ),
          );
        }
      });
      worker.on("exit", (code) => {
        const activeIndex = this.activeWorkers.findIndex((a) => a.worker === worker);
        if (activeIndex >= 0) {
          const active = this.activeWorkers[activeIndex]!;
          this.activeWorkers.splice(activeIndex, 1);
          this.chunkReservations.delete(active.chunkIndex);
          this.budget?.release(active.estimatedBytes);
          if (code !== 0 && !this.terminated) {
            active.reject(
              createError(ErrorCode.CC4001, {
                frame: active.chunkIndex,
                source: "worker",
                reason: `Worker exited unexpectedly with code ${code}`,
              }),
            );
          } else {
            active.reject(createError(ErrorCode.CC4003, { details: "worker pool terminated" }));
          }
        }
      });
      this.workers.push(worker);
      bootstraps.push(this.bootstrap(worker));
    }
    try {
      await Promise.all(bootstraps);
    } catch (error) {
      await Promise.allSettled(bootstraps);
      throw error;
    }
  }

  getStartupMeasurement(): WorkerStartupMeasurement {
    return {
      workers: this.workers.length,
      startupMs: this.startupMs,
      perWorkerMs: this.startup.length === 0 ? 0 : Math.round(this.startup.reduce((sum, ms) => sum + ms, 0) / this.startup.length),
    };
  }

  getThroughput(): WorkerThroughputMeasurement {
    const seconds = this.renderDurationMs / 1000;
    const fps = seconds > 0 ? this.renderedFrames / seconds : 0;
    return {
      frames: this.renderedFrames,
      durationMs: this.renderDurationMs,
      fps: Math.round(fps * 10) / 10,
    };
  }

  /** Sends the job runtime to a worker and resolves when it answers `ready`. */
  private async bootstrap(worker: Worker): Promise<void> {
    const started = Date.now();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        if (settled) return;
        settled = true;
        worker.off("message", onMessage);
        worker.off("exit", onExit);
        worker.off("error", onError);
      };
      const onMessage = (message: { type?: string; error?: string; startupMs?: number }): void => {
        if (message.type !== "ready" && message.type !== "init-error") return;
        cleanup();
        if (message.type === "init-error") {
          reject(new Error(`[CC4008] worker bootstrap failed: ${message.error ?? "unknown"}`));
          return;
        }
        if (message.startupMs !== undefined) this.startup.push(message.startupMs);
        resolve();
      };
      const onExit = (code: number): void => {
        cleanup();
        reject(
          createError(ErrorCode.CC4003, {
            details: `Worker terminated during bootstrap (exit code ${code})`,
          }),
        );
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      worker.on("message", onMessage);
      worker.once("exit", onExit);
      worker.once("error", onError);
      worker.postMessage({
        type: "init",
        payload: {
          compositionJson: this.compositionJson,
          seed: this.seed,
          cacheDir: this.cacheDir,
          errorPolicy: this.errorPolicy,
          frameWidth: this.frameWidth,
          frameHeight: this.frameHeight,
          fonts: this.fonts,
          projectRoot: this.projectRoot,
          mediaDir: this.mediaDir,
          crashOnFrame: this.crashOnFrame,
          plugins: this.plugins,
        },
      });
    }).catch((error) => {
      this.startupMs += Date.now() - started;
      throw error;
    });
    this.startupMs += Date.now() - started;
  }

  private dispatch(worker: Worker, chunk: FrameChunk, estimatedBytes: number): void {
    const frames = chunk.frames;
    if (estimatedBytes > 0) this.chunkReservations.set(chunk.startFrame, estimatedBytes);
    const promise = new Promise<WorkerResult>((resolve, reject) => {
      this.activeWorkers.push({
        worker,
        promise: null as unknown as Promise<WorkerResult>,
        resolve,
        reject,
        chunkIndex: chunk.startFrame,
        estimatedBytes,
      });
      worker.postMessage({ frames });
    });
    const active = this.activeWorkers[this.activeWorkers.length - 1];
    (active as ActiveWorker & { promise: Promise<WorkerResult> }).promise = promise;
  }

  /**
   * Process the given chunks across the persistent worker pool. Workers are
   * created once and reused across calls; each finished chunk is immediately
   * replaced by the next pending chunk on the same worker, so all `concurrency`
   * workers stay busy. Chunks may be supplied one call at a time or all at once.
   */
  async processChunks(chunks: readonly FrameChunk[]): Promise<WorkerResult[]> {
    if (this.terminated) {
      throw createError(ErrorCode.CC4003, { details: "worker pool terminated" });
    }
    const started = Date.now();
    this.pendingChunks = [...chunks];
    this.nextChunkIndex = 0;
    this.activeWorkers = [];
    await this.initWorkers();
    if (this.terminated) {
      throw createError(ErrorCode.CC4003, { details: "worker pool terminated" });
    }

    const results: WorkerResult[] = [];
    const freeWorkers = [...this.workers];

    /** Dispatches the next chunk to `worker` when it fits the byte budget. */
    const dispatchNext = (worker: Worker): boolean => {
      if (this.terminated) return false;
      const chunk = this.pendingChunks[this.nextChunkIndex];
      if (!chunk) return false;
      const bytes = this.tryReserveChunk(chunk);
      if (bytes === null) return false;
      this.nextChunkIndex += 1;
      this.dispatch(worker, chunk, bytes);
      return true;
    };

    while (!this.terminated && freeWorkers.length > 0 && dispatchNext(freeWorkers[0]!)) {
      freeWorkers.shift();
    }

    while (!this.terminated && (this.activeWorkers.length > 0 || freeWorkers.length > 0)) {
      // Nothing in flight: wait for budget and dispatch one chunk so the queue
      // always makes progress even when a single chunk spans the whole budget.
      if (this.activeWorkers.length === 0) {
        if (this.nextChunkIndex >= this.pendingChunks.length) break;
        const worker = freeWorkers[0];
        const chunk = this.pendingChunks[this.nextChunkIndex];
        if (!worker || !chunk) break;
        this.nextChunkIndex += 1;
        freeWorkers.shift();
        this.dispatch(worker, chunk, await this.reserve(chunk));
        continue;
      }

      const raced = this.activeWorkers.map((a) =>
        a.promise.then(
          (value) => ({ promise: a.promise, value }),
          (error) => ({ promise: a.promise, error }),
        ),
      );
      const winner = await Promise.race(raced);
      if ("error" in winner) throw winner.error;
      results.push(winner.value);
      this.renderedFrames += winner.value.frames.length;

      const completedIndex = this.activeWorkers.findIndex((a) =>
        Object.is(a.promise, winner.promise),
      );
      if (completedIndex >= 0) {
        const completed = this.activeWorkers[completedIndex]!;
        this.activeWorkers.splice(completedIndex, 1);
        freeWorkers.push(completed.worker);
      }

      while (!this.terminated && freeWorkers.length > 0 && dispatchNext(freeWorkers[0]!)) {
        freeWorkers.shift();
      }
    }

    this.renderDurationMs += Date.now() - started;
    if (this.terminated) {
      throw createError(ErrorCode.CC4003, { details: "worker pool terminated" });
    }

    return results;
  }

  /** Stops every worker and settles in-flight chunks as cancelled. */
  async terminate(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    const active = [...this.activeWorkers];
    this.activeWorkers = [];
    for (const entry of active) {
      this.chunkReservations.delete(entry.chunkIndex);
      this.budget?.release(entry.estimatedBytes);
      entry.reject(createError(ErrorCode.CC4003, { details: "worker pool terminated" }));
    }
    const workersToTerminate = [...this.workers];
    this.workers.length = 0;
    await Promise.all(workersToTerminate.map((w) => w.terminate()));
  }
}

export function createWorkerManager(options: WorkerManagerOptions): WorkerManager {
  return new WorkerManager(options);
}

export function resolveConcurrency(concurrency: number | "auto"): number {
  if (concurrency === "auto") {
    return Math.max(1, cpus().length - 1);
  }
  return Math.max(1, concurrency);
}

/**
 * Computes an optimal chunk size for the given composition.
 * - Short compositions (< 300 frames): larger chunks to minimize worker overhead
 * - Long compositions (> 10,000 frames): smaller chunks for fine-grained resume
 * - High-complexity (many effects/transitions): smaller chunks to bound memory
 * - Default sweet spot: 32 frames per chunk
 */
export function resolveChunkSize(composition: Composition, defaultChunkSize = 32): number {
  let totalFrames = 0;
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind === "audio") continue;
    for (const clip of track.clips) {
      const duration =
        typeof clip.duration === "number" ? clip.duration : parseFloat(clip.duration as string);
      if (duration > 0) totalFrames += Math.ceil(duration * composition.fps);
    }
  }
  if (totalFrames < 300) return 128;
  if (totalFrames > 10000) return 16;
  if (estimateComplexity(composition) > 5) return 8;
  return defaultChunkSize;
}

function estimateComplexity(composition: Composition): number {
  let complexity = 0;
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind === "audio") continue;
    for (const clip of track.clips) {
      const typedClip = clip as {
        effects?: unknown[];
        transitionIn?: boolean;
        transitionOut?: boolean;
        matte?: unknown;
        mask?: unknown;
      };
      complexity += typedClip.effects?.length ?? 0;
      if (typedClip.transitionIn || typedClip.transitionOut) complexity += 0.5;
      if (typedClip.matte) complexity += 0.3;
      if (typedClip.mask) complexity += 0.2;
    }
  }
  return complexity;
}

export function createChunks(totalFrames: number, chunkSize: number): FrameChunk[] {
  const chunks: FrameChunk[] = [];
  for (let start = 0; start < totalFrames; start += chunkSize) {
    const end = Math.min(start + chunkSize, totalFrames);
    const frames: number[] = [];
    for (let f = start; f < end; f++) frames.push(f);
    chunks.push({ startFrame: start, endFrame: end, frames });
  }
  return chunks;
}
