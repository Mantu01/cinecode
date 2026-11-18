import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Composition, FontEntry } from "../core/types/index.js";
import type { ByteBudget } from "./memory.js";
import { estimateChunkBytes, formatBytes } from "./memory.js";
import { frameFromTransfer } from "./frame-format.js";
import { attachCacheChannel, type CacheProvider } from "./cache-channel.js";
import type { FrameErrorPolicy, FrameFailure } from "./frame-worker.js";

const WORKER_FILENAME = "frame-worker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const getWorkerPath = (): string => {
  return join(__dirname, WORKER_FILENAME);
};

/**
 * Pre-warmed workers created once and reused across render calls.
 * Eliminates the ~50-100ms per-worker creation overhead on first render.
 */
const warmPool: Worker[] = [];
let warmPoolSize = 0;

function ensureWarmPool(count: number): void {
  while (warmPool.length < count) {
    const worker = createWarmWorker();
    warmPool.push(worker);
  }
  warmPoolSize = count;
}

function createWarmWorker(): Worker {
  return new Worker(getWorkerPath(), {
    workerData: { compositionJson: "", seed: 0, cacheDir: "" },
  });
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
  /** Configured fonts registered in each worker before rendering. */
  readonly fonts?: readonly FontEntry[];
  readonly projectRoot?: string;
  readonly mediaDir?: string;
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
  private readonly concurrency: number;
  /** Video-only timeline serialized once; cloned to workers as a flat string. */
  private readonly compositionJson: string;
  private readonly seed: number;
  private readonly cacheDir: string;
  private pendingChunks: FrameChunk[] = [];
  private activeWorkers: ActiveWorker[] = [];
  private readonly chunkReservations = new Map<number, number>();
  private nextChunkIndex = 0;
  private initialized = false;
  private readonly budget: ByteBudget | undefined;
  private readonly maxChunkBytes: number | undefined;
  private readonly onMemoryWarning: ((usageBytes: number, budgetBytes: number) => void) | undefined;
  private warned = false;
  private readonly frameWidth: number;
  private readonly frameHeight: number;
  private readonly errorPolicy: FrameErrorPolicy;
  private readonly cacheProvider: CacheProvider;
  private readonly fonts: readonly FontEntry[] | undefined;
  private readonly projectRoot: string;
  private readonly mediaDir: string;

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
    this.fonts = options.fonts;
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.mediaDir = options.mediaDir ?? "media";
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
    return new Worker(getWorkerPath(), {
      workerData: {
        compositionJson: this.compositionJson,
        seed: this.seed,
        cacheDir: this.cacheDir,
        errorPolicy: this.errorPolicy,
        frameWidth: this.frameWidth,
        frameHeight: this.frameHeight,
        fonts: this.fonts,
        projectRoot: this.projectRoot,
        mediaDir: this.mediaDir,
      } as {
        compositionJson: string;
        seed: number;
        cacheDir: string;
        errorPolicy: FrameErrorPolicy;
        frameWidth: number;
        frameHeight: number;
        fonts?: readonly FontEntry[];
        projectRoot: string;
        mediaDir: string;
      },
    });
  }

  private initWorkers(): void {
    if (this.initialized) return;
    this.initialized = true;
    for (let i = 0; i < this.concurrency; i++) {
      const worker = this.createWorker();
      attachCacheChannel(worker, this.cacheProvider);
      worker.on("message", (output: TransportOutput) => {
        if ((output as { type?: string }).type === "cache-request") return;
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
          active.reject(error);
        }
      });
      worker.on("exit", (code) => {
        const activeIndex = this.activeWorkers.findIndex((a) => a.worker === worker);
        if (activeIndex >= 0) {
          const active = this.activeWorkers[activeIndex]!;
          this.activeWorkers.splice(activeIndex, 1);
          this.chunkReservations.delete(active.chunkIndex);
          this.budget?.release(active.estimatedBytes);
          if (code !== 0) active.reject(new Error(`Worker exited with code ${code}`));
        }
      });
      this.workers.push(worker);
    }
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
    this.pendingChunks = [...chunks];
    this.nextChunkIndex = 0;
    this.activeWorkers = [];
    this.initWorkers();

    const results: WorkerResult[] = [];
    const freeWorkers = [...this.workers];

    /** Dispatches the next chunk to `worker` when it fits the byte budget. */
    const dispatchNext = (worker: Worker): boolean => {
      const chunk = this.pendingChunks[this.nextChunkIndex];
      if (!chunk) return false;
      const bytes = this.tryReserveChunk(chunk);
      if (bytes === null) return false;
      this.nextChunkIndex += 1;
      this.dispatch(worker, chunk, bytes);
      return true;
    };

    while (freeWorkers.length > 0 && dispatchNext(freeWorkers[0]!)) {
      freeWorkers.shift();
    }

    while (this.activeWorkers.length > 0 || freeWorkers.length > 0) {
      // Nothing in flight: wait for budget and dispatch one chunk so the queue
      // always makes progress even when a single chunk spans the whole budget.
      if (this.activeWorkers.length === 0) {
        const worker = freeWorkers[0];
        const chunk = this.pendingChunks[this.nextChunkIndex];
        if (!worker || !chunk) break;
        this.nextChunkIndex += 1;
        freeWorkers.shift();
        this.dispatch(worker, chunk, await this.reserve(chunk));
        continue;
      }

      const raced = this.activeWorkers.map((a) =>
        a.promise.then((value) => ({ promise: a.promise, value })),
      );
      const winner = await Promise.race(raced);
      results.push(winner.value);

      const completedIndex = this.activeWorkers.findIndex((a) =>
        Object.is(a.promise, winner.promise),
      );
      if (completedIndex >= 0) {
        const completed = this.activeWorkers[completedIndex]!;
        this.activeWorkers.splice(completedIndex, 1);
        freeWorkers.push(completed.worker);
      }

      while (freeWorkers.length > 0 && dispatchNext(freeWorkers[0]!)) {
        freeWorkers.shift();
      }
    }

    return results;
  }

  async terminate(): Promise<void> {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers.length = 0;
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
