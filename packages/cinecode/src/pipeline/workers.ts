import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Composition } from "../core/types/index.js";
import type { MemoryBudget } from "./memory.js";
import { estimateChunkBytes, MemoryBudgetError, MemoryTracker } from "./memory.js";
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
  readonly memoryBudget?: MemoryBudget;
  readonly onMemoryWarning?: (usageBytes: number, budgetBytes: number) => void;
  readonly errorPolicy?: FrameErrorPolicy;
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

export class WorkerManager {
  private readonly workers: Worker[] = [];
  private readonly concurrency: number;
  /** Video-only timeline serialized once; cloned to workers as a flat string. */
  private readonly compositionJson: string;
  private readonly seed: number;
  private readonly cacheDir: string;
  private pendingChunks: FrameChunk[] = [];
  private activeWorkers: ActiveWorker[] = [];
  private nextChunkIndex = 0;
  private initialized = false;
  private readonly memoryBudget: MemoryBudget | undefined;
  private readonly memoryTracker = new MemoryTracker();
  private readonly onMemoryWarning: ((usageBytes: number, budgetBytes: number) => void) | undefined;
  private readonly frameWidth: number;
  private readonly frameHeight: number;
  private readonly errorPolicy: FrameErrorPolicy;

  constructor(options: WorkerManagerOptions) {
    this.concurrency = options.concurrency;
    this.compositionJson = JSON.stringify(stripAudioForWorkers(options.composition));
    this.seed = options.seed;
    this.cacheDir = options.cacheDir;
    this.memoryBudget = options.memoryBudget;
    this.onMemoryWarning = options.onMemoryWarning;
    this.frameWidth = options.composition.width;
    this.frameHeight = options.composition.height;
    this.errorPolicy = options.errorPolicy ?? "placeholder";
  }

  private checkMemory(chunk: FrameChunk): void {
    if (!this.memoryBudget) return;
    const bytes = estimateChunkBytes(chunk.frames.length, this.frameWidth, this.frameHeight);
    this.memoryTracker.trackAllocation(bytes);
    const status = this.memoryTracker.checkBudget(this.memoryBudget);
    if (status === "over-budget") {
      this.memoryTracker.releaseAllocation(bytes);
      throw new MemoryBudgetError(this.memoryTracker.getUsage(), this.memoryBudget.maxBytesPerChunk);
    }
    if (status === "warning" && !this.memoryTracker.hasWarned()) {
      this.onMemoryWarning?.(this.memoryTracker.getUsage(), this.memoryBudget.maxBytesPerChunk);
    }
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
      } as { compositionJson: string; seed: number; cacheDir: string; errorPolicy: FrameErrorPolicy; frameWidth: number; frameHeight: number },
    });
  }

  private initWorkers(): void {
    if (this.initialized) return;
    this.initialized = true;
    for (let i = 0; i < this.concurrency; i++) {
      const worker = this.createWorker();
      worker.on("message", (output: WorkerResult) => {
        const active = this.activeWorkers.find(a => a.worker === worker);
        if (active) active.resolve({ ...output, chunkIndex: active.chunkIndex });
      });
      worker.on("error", (error) => {
        const activeIndex = this.activeWorkers.findIndex(a => a.worker === worker);
        if (activeIndex >= 0) {
          const active = this.activeWorkers[activeIndex]!;
          this.activeWorkers.splice(activeIndex, 1);
          active.reject(error);
        }
      });
      worker.on("exit", (code) => {
        const activeIndex = this.activeWorkers.findIndex(a => a.worker === worker);
        if (activeIndex >= 0) {
          const active = this.activeWorkers[activeIndex]!;
          this.activeWorkers.splice(activeIndex, 1);
          if (code !== 0) active.reject(new Error(`Worker exited with code ${code}`));
        }
      });
      this.workers.push(worker);
    }
  }

  private dispatch(worker: Worker, chunk: FrameChunk): void {
    const frames = chunk.frames;
    const estimatedBytes = this.memoryBudget
      ? estimateChunkBytes(frames.length, this.frameWidth, this.frameHeight)
      : 0;
    const promise = new Promise<WorkerResult>((resolve, reject) => {
      this.activeWorkers.push({ worker, promise: null as unknown as Promise<WorkerResult>, resolve, reject, chunkIndex: chunk.startFrame, estimatedBytes });
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

    for (const worker of this.workers) {
      if (this.nextChunkIndex >= this.pendingChunks.length) break;
      const chunk = this.pendingChunks[this.nextChunkIndex++];
      if (!chunk) continue;
      this.checkMemory(chunk);
      this.dispatch(worker, chunk);
    }

    while (this.activeWorkers.length > 0) {
      const raced = this.activeWorkers.map((a) =>
        a.promise.then((value) => ({ promise: a.promise, value }))
      );
      const winner = await Promise.race(raced);
      results.push(winner.value);

      const completedIndex = this.activeWorkers.findIndex((a) => Object.is(a.promise, winner.promise));
      let completedWorker: Worker | undefined;
      if (completedIndex >= 0) {
        const completed = this.activeWorkers[completedIndex]!;
        completedWorker = completed.worker;
        if (completed.estimatedBytes > 0) this.memoryTracker.releaseAllocation(completed.estimatedBytes);
        this.activeWorkers.splice(completedIndex, 1);
      }

      if (completedWorker && this.nextChunkIndex < this.pendingChunks.length) {
        const chunk = this.pendingChunks[this.nextChunkIndex++];
        if (chunk) {
          this.checkMemory(chunk);
          this.dispatch(completedWorker, chunk);
        }
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
      const duration = typeof clip.duration === "number"
        ? clip.duration
        : parseFloat(clip.duration as string);
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
      const typedClip = clip as { effects?: unknown[]; transitionIn?: boolean; transitionOut?: boolean; matte?: unknown; mask?: unknown };
      complexity += (typedClip.effects?.length ?? 0);
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
