import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Composition, FontEntry } from "../core/types/index.js";
import type { ByteBudget } from "./memory.js";
import { estimateChunkBytes, estimateFrameBytes, formatBytes } from "./memory.js";
import { frameFromTransfer } from "./frame-format.js";
import { createError, ErrorCode } from "../errors/codes.js";
import { attachCacheChannel, type CacheProvider, type BatchCacheProvider } from "./cache-channel.js";
import type { FrameErrorPolicy, FrameFailure } from "./frame-worker.js";
import { compositionTotalFrames } from "../core/time/index.js";

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
  readonly onChunk?: (result: WorkerResult) => void;
  readonly chunkIndex: number;
  readonly estimatedBytes: number;
  readonly internalResolve: (result: WorkerResult) => void;
  readonly internalReject: (error: Error) => void;
}

interface QueuedChunk {
  readonly chunk: FrameChunk;
  readonly resolve: (result: WorkerResult) => void;
  readonly reject: (error: Error) => void;
  readonly onChunk?: (result: WorkerResult) => void;
  readonly onBeforeChunk?: (chunk: FrameChunk) => Promise<void> | void;
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
  readonly renderedFrames: number;
  readonly startupMs: number;
  readonly renderDurationMs: number;
  readonly cacheHits: number;
  readonly failures: number;
  readonly activeWorkerCount: number;
  readonly peakActiveWorkers: number;
}

export class WorkerManager {
  private readonly workers: Worker[] = [];
  private concurrency: number;
  /** Video-only timeline serialized once; cloned to workers as a flat string. */
  private compositionJson: string;
  private seed: number;
  private cacheDir: string;
  private workQueue: QueuedChunk[] = [];
  private runnerPromise: Promise<void> | null = null;
  private budgetNotifier?: () => void;
  private activeWorkers: ActiveWorker[] = [];
  private readonly chunkReservations = new Map<number, number>();
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
  private transferredFrames = 0;
  private cacheHits = 0;
  private failures = 0;
  private peakActiveWorkers = 0;
  private readonly cacheChannelCleanups: (() => void)[] = [];

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
    const originalCacheProvider = options.cacheProvider ?? (async () => undefined);
    this.cacheProvider = async (req) => {
      const res = await originalCacheProvider(req);
      if (res) this.cacheHits += 1;
      return res;
    };
    if (options.batchCacheProvider) {
      const originalBatch = options.batchCacheProvider;
      this.batchCacheProvider = async (keys) => {
        const res = await originalBatch(keys);
        this.cacheHits += res.size;
        return res;
      };
    }
    this.fonts = options.fonts;
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.mediaDir = options.mediaDir ?? "media";
    this.crashOnFrame = options.crashOnFrame;
    this.plugins = options.plugins;
  }

  isTerminated(): boolean {
    return this.terminated;
  }

  private normalizeResult(output: TransportOutput, chunkIndex: number): WorkerResult {
    return {
      ...output,
      chunkIndex,
      frames: output.frames.map((frame) => {
        if (!("pixels" in frame)) return { index: frame.index, buffer: frame.buffer };
        this.transferredFrames += 1;
        return { index: frame.index, buffer: frameFromTransfer(frame.pixels, true) };
      }),
    };
  }

  /** Byte estimate reserved for one chunk while its frames are in flight. */
  private chunkEstimate(chunk: FrameChunk): number {
    return estimateChunkBytes(chunk.frames.length, this.frameWidth, this.frameHeight);
  }

  private assertChunkFits(bytes: number): void {
    const limit = this.maxChunkBytes !== undefined
      ? Math.min(this.maxChunkBytes, this.budget?.limitBytes ?? this.maxChunkBytes)
      : this.budget?.limitBytes;
    if (limit !== undefined && bytes > limit) {
      throw new Error(
        `Render chunk needs ${formatBytes(bytes)} of frames, over the ${formatBytes(limit)} chunk budget. Reduce the chunk size or raise the render memory budget.`,
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
    this.assertChunkFits(bytes);
    if (!this.budget) return 0;
    const reservation = this.budget.tryReserve(bytes);
    if (!reservation.ok) {
      if (reservation.reason === "over-limit") {
        throw new Error(
          `Render chunk needs ${formatBytes(bytes)} of frames, over the ${formatBytes(this.budget.limitBytes)} chunk budget. Reduce the chunk size or raise the render memory budget.`,
        );
      }
      return null;
    }
    this.warnIfTight();
    return bytes;
  }

  /** Waits for budget; only used when no chunk is in flight. */
  private async reserve(chunk: FrameChunk): Promise<number> {
    const bytes = this.chunkEstimate(chunk);
    if (!this.budget) return 0;
    this.assertChunkFits(bytes);
    const reservation = await this.budget.reserve(bytes);
    if (!reservation.ok) {
      throw new Error(
        `Render chunk needs ${formatBytes(bytes)} of frames, over the ${formatBytes(this.budget.limitBytes)} chunk budget. Reduce the chunk size or raise the render memory budget.`,
      );
    }
    this.warnIfTight();
    return bytes;
  }

  /** Frames of a finished chunk were encoded: give the budget back. */
  releaseChunk(result: WorkerResult): void {
    const active = this.chunkReservations.get(result.chunkIndex);
    if (!active) return;
    this.chunkReservations.delete(result.chunkIndex);
    this.budget?.release(active);
    if (this.budgetNotifier) {
      const notify = this.budgetNotifier;
      this.budgetNotifier = undefined;
      notify();
    }
  }

  getStats(): WorkerPoolStats {
    let reserved = 0;
    for (const bytes of this.chunkReservations.values()) reserved += bytes;
    return {
      chunksInFlight: this.activeWorkers.length,
      reservedBytes: reserved,
      peakReservedBytes: this.budget?.peakBytes ?? 0,
      budgetBytes: this.budget?.limitBytes ?? 0,
      transferredFrames: this.transferredFrames,
      renderedFrames: this.renderedFrames,
      startupMs: this.startupMs,
      renderDurationMs: this.renderDurationMs,
      cacheHits: this.cacheHits,
      failures: this.failures,
      activeWorkerCount: this.activeWorkers.length,
      peakActiveWorkers: this.peakActiveWorkers,
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
      const detach = attachCacheChannel(worker, { single: this.cacheProvider, batch: this.batchCacheProvider });
      this.cacheChannelCleanups.push(detach);
      worker.on("message", (output: TransportOutput) => {
        const msgType = (output as { type?: string }).type;
        if (msgType === "cache-request" || msgType === "cache-batch-request") return;
        const active = this.activeWorkers.find((a) => a.worker === worker);
        if (active) active.internalResolve(this.normalizeResult(output, active.chunkIndex));
      });
      worker.on("error", (error) => {
        this.failures += 1;
        const activeIndex = this.activeWorkers.findIndex((a) => a.worker === worker);
        if (activeIndex >= 0) {
          const active = this.activeWorkers[activeIndex]!;
          this.activeWorkers.splice(activeIndex, 1);
          this.chunkReservations.delete(active.chunkIndex);
          if (active.estimatedBytes > 0) this.budget?.release(active.estimatedBytes);
          active.internalReject(
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
          if (active.estimatedBytes > 0) this.budget?.release(active.estimatedBytes);
          if (code !== 0 && !this.terminated) {
            active.internalReject(
              createError(ErrorCode.CC4001, {
                frame: active.chunkIndex,
                source: "worker",
                reason: `Worker exited unexpectedly with code ${code}`,
              }),
            );
          } else {
            active.internalReject(createError(ErrorCode.CC4003, { details: "worker pool terminated" }));
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

  private dispatch(
    worker: Worker,
    chunk: FrameChunk,
    estimatedBytes: number,
    resolve: (result: WorkerResult) => void,
    reject: (error: Error) => void,
    onChunk?: (result: WorkerResult) => void,
  ): void {
    const frames = chunk.frames;
    if (estimatedBytes > 0) this.chunkReservations.set(chunk.startFrame, estimatedBytes);
    let internalResolve!: (result: WorkerResult) => void;
    let internalReject!: (error: Error) => void;
    const promise = new Promise<WorkerResult>((res, rej) => {
      internalResolve = res;
      internalReject = rej;
    });
    promise.catch(() => undefined);
    this.activeWorkers.push({
      worker,
      promise,
      resolve,
      reject,
      onChunk,
      chunkIndex: chunk.startFrame,
      estimatedBytes,
      internalResolve,
      internalReject,
    });
    this.peakActiveWorkers = Math.max(this.peakActiveWorkers, this.activeWorkers.length);
    worker.postMessage({ frames });
  }

  /**
   * Process the given chunks across the persistent worker pool. Workers are
   * created once and reused across calls; each finished chunk is immediately
   * replaced by the next pending chunk on the same worker, so all `concurrency`
   * workers stay busy. Chunks may be supplied one call at a time or all at once.
   */
  async processChunks(
    chunks: readonly FrameChunk[],
    onChunk?: (result: WorkerResult) => void,
    onBeforeChunk?: (chunk: FrameChunk) => Promise<void> | void,
  ): Promise<WorkerResult[]> {
    if (this.terminated) {
      throw createError(ErrorCode.CC4003, { details: "worker pool terminated" });
    }
    await this.initWorkers();
    if (this.terminated) {
      throw createError(ErrorCode.CC4003, { details: "worker pool terminated" });
    }

    const effectiveLimit = this.maxChunkBytes ?? this.budget?.limitBytes;
    const splitChunks: FrameChunk[] = [];
    for (const chunk of chunks) {
      const bytes = this.chunkEstimate(chunk);
      if (effectiveLimit !== undefined && bytes > effectiveLimit && chunk.frames.length > 1) {
        const frameBytes = Math.max(1, estimateFrameBytes(this.frameWidth, this.frameHeight));
        const maxFrames = Math.max(1, Math.floor(effectiveLimit / frameBytes));
        for (let i = 0; i < chunk.frames.length; i += maxFrames) {
          const slice = chunk.frames.slice(i, i + maxFrames);
          splitChunks.push({
            startFrame: slice[0]!,
            endFrame: slice[slice.length - 1]! + 1,
            frames: slice,
          });
        }
      } else {
        splitChunks.push(chunk);
      }
    }

    for (const chunk of splitChunks) this.assertChunkFits(this.chunkEstimate(chunk));

    const promises: Promise<WorkerResult>[] = [];
    for (const chunk of splitChunks) {
      promises.push(
        new Promise<WorkerResult>((resolve, reject) => {
          this.workQueue.push({ chunk, resolve, reject, onChunk, onBeforeChunk });
        }),
      );
    }

    this.ensureRunner();
    return Promise.all(promises);
  }

  private ensureRunner(): void {
    if (!this.runnerPromise) {
      this.runnerPromise = this.runQueue().finally(() => {
        this.runnerPromise = null;
      });
    }
  }

  private async runQueue(): Promise<void> {
    const started = Date.now();
    const freeWorkers = [...this.workers.filter((w) => !this.activeWorkers.some((a) => a.worker === w))];

    const dispatchNext = async (worker: Worker): Promise<boolean> => {
      if (this.terminated || this.workQueue.length === 0) return false;
      const item = this.workQueue[0]!;
      const bytes = this.tryReserveChunk(item.chunk);
      if (bytes === null) return false;
      this.workQueue.shift();
      if (item.onBeforeChunk) await item.onBeforeChunk(item.chunk);
      this.dispatch(worker, item.chunk, bytes, item.resolve, item.reject, item.onChunk);
      return true;
    };

    while (!this.terminated && freeWorkers.length > 0 && (await dispatchNext(freeWorkers[0]!))) {
      freeWorkers.shift();
    }

    while (!this.terminated && (this.activeWorkers.length > 0 || this.workQueue.length > 0)) {
      if (this.activeWorkers.length === 0) {
        if (this.workQueue.length === 0) break;
        const worker = freeWorkers[0];
        const item = this.workQueue[0];
        if (!worker || !item) break;
        this.workQueue.shift();
        freeWorkers.shift();
        const bytes = await this.reserve(item.chunk);
        if (item.onBeforeChunk) await item.onBeforeChunk(item.chunk);
        this.dispatch(worker, item.chunk, bytes, item.resolve, item.reject, item.onChunk);
        continue;
      }

      type RaceResult =
        | { kind: "worker"; value: WorkerResult; active: ActiveWorker }
        | { kind: "worker_error"; error: Error; active: ActiveWorker }
        | { kind: "budget" };

      const raced: Promise<RaceResult>[] = this.activeWorkers.map((a) =>
        a.promise.then(
          (value): RaceResult => ({ kind: "worker", value, active: a }),
          (error): RaceResult => ({ kind: "worker_error", error, active: a }),
        ),
      );

      if (freeWorkers.length > 0 && this.workQueue.length > 0) {
        raced.push(
          new Promise<RaceResult>((resolve) => {
            this.budgetNotifier = () => resolve({ kind: "budget" });
          }),
        );
      }

      const winner = await Promise.race(raced);
      if (winner.kind === "budget") {
        while (!this.terminated && freeWorkers.length > 0 && (await dispatchNext(freeWorkers[0]!))) {
          freeWorkers.shift();
        }
        continue;
      }

      const completed = winner.active;
      const completedIndex = this.activeWorkers.indexOf(completed);
      if (completedIndex >= 0) {
        this.activeWorkers.splice(completedIndex, 1);
        freeWorkers.push(completed.worker);
      }

      if (winner.kind === "worker_error") {
        completed.reject(winner.error);
      } else {
        this.renderedFrames += winner.value.frames.length;
        if (winner.value.failures) this.failures += winner.value.failures.length;
        if ((winner.value as { cacheHits?: number }).cacheHits) {
          this.cacheHits += (winner.value as { cacheHits?: number }).cacheHits!;
        }
        try {
          completed.onChunk?.(winner.value);
        } catch {}
        completed.resolve(winner.value);
      }

      while (!this.terminated && freeWorkers.length > 0 && (await dispatchNext(freeWorkers[0]!))) {
        freeWorkers.shift();
      }
    }

    this.renderDurationMs += Date.now() - started;
  }

  /** Stops every worker and settles in-flight chunks as cancelled. */
  async terminate(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    for (const detach of this.cacheChannelCleanups) {
      try {
        detach();
      } catch {}
    }
    this.cacheChannelCleanups.length = 0;
    const active = [...this.activeWorkers];
    this.activeWorkers = [];
    for (const entry of active) {
      this.chunkReservations.delete(entry.chunkIndex);
      if (entry.estimatedBytes > 0) {
        this.budget?.release(entry.estimatedBytes);
      }
      entry.reject(createError(ErrorCode.CC4003, { details: "worker pool terminated" }));
      entry.internalReject(createError(ErrorCode.CC4003, { details: "worker pool terminated" }));
    }
    const pending = [...this.workQueue];
    this.workQueue = [];
    for (const item of pending) {
      item.reject(createError(ErrorCode.CC4003, { details: "worker pool terminated" }));
    }
    if (this.budgetNotifier) {
      const notify = this.budgetNotifier;
      this.budgetNotifier = undefined;
      notify();
    }
    const workersToTerminate = [...this.workers];
    this.workers.length = 0;
    for (const w of workersToTerminate) {
      try {
        w.postMessage({ type: "shutdown" });
      } catch {}
    }
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
  const totalFrames = compositionTotalFrames(composition);
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
