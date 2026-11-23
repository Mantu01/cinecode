import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FontEntry } from "../core/types/index.js";
import type { ByteBudget } from "./memory.js";
import { createError, ErrorCode } from "../errors/codes.js";
import { attachCacheChannel, type CacheProvider, type BatchCacheProvider } from "./cache-channel.js";
import type { FrameErrorPolicy } from "./frame-worker.js";
import type { ChunkIdentity, FrameChunk } from "./chunk-identity.js";
import type {
  ActiveWorker,
  QueuedChunk,
  WorkerManagerOptions,
  WorkerPoolStats,
  WorkerResult,
  WorkerStartupMeasurement,
  WorkerThroughputMeasurement,
} from "./worker-types.js";
import { bootstrapWorker, stripAudioForWorkers } from "./worker-lifecycle.js";
import { planChunks } from "./worker-chunks.js";
import { ChunkReservations } from "./worker-reservations.js";
import { bindWorkerEvents } from "./worker-events.js";
import { shutdownWorkerPool } from "./worker-shutdown.js";
import { executeWorkQueue } from "./worker-runner.js";

export * from "./chunk-identity.js";
export * from "./worker-types.js";

const WORKER_FILENAME = "frame-worker.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const getWorkerPath = (): string => {
  return join(__dirname, WORKER_FILENAME);
};

export class WorkerManager {
  private readonly workers: Worker[] = [];
  private concurrency: number;
  private compositionJson: string;
  private seed: number;
  private cacheDir: string;
  private workQueue: QueuedChunk[] = [];
  private runnerPromise: Promise<void> | null = null;
  private budgetNotifier?: () => void;
  private activeWorkers: ActiveWorker[] = [];
  private readonly reservations: ChunkReservations;
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
  private plugins: readonly import("./worker-types.js").PluginWorkerBootstrap[] | undefined;
  private extensions: import("../plugin/descriptor.js").ExtensionDescriptor | undefined;
  private binaries: { readonly ffmpegPath?: string; readonly ffprobePath?: string } | undefined;
  private verbose: boolean;
  private readonly startup: number[] = [];
  private startupMs = 0;
  private renderedFrames = 0;
  private renderDurationMs = 0;
  private cacheHits = 0;
  private failures = 0;
  private transferredFrames = 0;
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
    this.cacheProvider = options.cacheProvider ?? (async () => undefined);
    this.batchCacheProvider = options.batchCacheProvider;
    this.fonts = options.fonts;
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.mediaDir = options.mediaDir ?? "media";
    this.crashOnFrame = options.crashOnFrame;
    this.plugins = options.plugins;
    this.extensions = options.extensions;
    this.binaries = options.binaries;
    this.verbose = options.verbose === true;
    this.reservations = new ChunkReservations(
      {
        budget: () => this.budget,
        maxChunkBytes: () => this.maxChunkBytes,
        onTight: () => this.warnIfTight(),
        notifyBudget: () => this.notifyBudget(),
      },
      this.frameWidth,
      this.frameHeight,
    );
  }

  isTerminated(): boolean {
    return this.terminated;
  }

  private warnIfTight(): void {
    if (!this.budget || this.warned) return;
    if (this.budget.usedBytes > this.budget.limitBytes * 0.8) {
      this.warned = true;
      this.onMemoryWarning?.(this.budget.usedBytes, this.budget.limitBytes);
    }
  }

  private notifyBudget(): void {
    if (!this.budgetNotifier) return;
    const notify = this.budgetNotifier;
    this.budgetNotifier = undefined;
    notify();
  }

  releaseChunk(target: ChunkIdentity | string | number): void {
    this.reservations.release(target);
  }

  getStats(): WorkerPoolStats {
    return {
      chunksInFlight: this.activeWorkers.length,
      reservedBytes: this.reservations.total(),
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

  private bindEvents(worker: Worker): void {
    bindWorkerEvents(worker, {
      activeFor: (target) => this.activeWorkers.find((a) => a.worker === target),
      removeActive: (target) => {
        const index = this.activeWorkers.findIndex((a) => a.worker === target);
        if (index < 0) return undefined;
        return this.activeWorkers.splice(index, 1)[0];
      },
      dropReservation: (identity, bytes) => this.reservations.drop(identity, bytes),
      countFailure: () => {
        this.failures += 1;
      },
      countTransfer: () => {
        this.transferredFrames += 1;
      },
      isTerminated: () => this.terminated,
    });
  }

  private async initWorkers(): Promise<void> {
    if (this.terminated) throw createError(ErrorCode.CC4003, { details: "worker pool already terminated" });
    if (this.initialized) return;
    this.initialized = true;
    const bootstraps: Promise<void>[] = [];
    for (let i = 0; i < this.concurrency; i++) {
      const worker = new Worker(getWorkerPath());
      const detach = attachCacheChannel(worker, { single: this.cacheProvider, batch: this.batchCacheProvider });
      this.cacheChannelCleanups.push(detach);
      this.bindEvents(worker);
      this.workers.push(worker);
      bootstraps.push(
        bootstrapWorker(
          worker,
          {
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
            extensions: this.extensions,
            binaries: this.binaries,
            verbose: this.verbose,
          },
          this.startup,
        ).then((ms) => {
          this.startupMs += ms;
        }),
      );
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

  private dispatch(
    worker: Worker,
    chunk: FrameChunk,
    estimatedBytes: number,
    resolve: (result: WorkerResult) => void,
    reject: (error: Error) => void,
    onChunk?: (result: WorkerResult) => Promise<void> | void,
  ): void {
    this.reservations.track(chunk.identity.id, estimatedBytes);
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
      identity: chunk.identity,
      chunkIndex: chunk.identity.chunkIndex,
      estimatedBytes,
      internalResolve,
      internalReject,
    });
    this.peakActiveWorkers = Math.max(this.peakActiveWorkers, this.activeWorkers.length);
    worker.postMessage({ frames: chunk.frames, chunkId: chunk.identity.id });
  }

  async processChunks(
    chunks: readonly FrameChunk[],
    onChunk?: (result: WorkerResult) => Promise<void> | void,
    onBeforeChunk?: (chunk: FrameChunk) => Promise<void> | void,
  ): Promise<WorkerResult[]> {
    if (this.terminated) throw createError(ErrorCode.CC4003, { details: "worker pool terminated" });
    await this.initWorkers();
    if (this.terminated) throw createError(ErrorCode.CC4003, { details: "worker pool terminated" });

    const planned = planChunks(chunks, this.frameWidth, this.frameHeight, this.maxChunkBytes, this.budget);
    for (const chunk of planned) this.reservations.assertFits(this.reservations.estimate(chunk));

    const promises: Promise<WorkerResult>[] = [];
    for (const chunk of planned) {
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
    if (this.runnerPromise) return;
    this.runnerPromise = this.runQueue().finally(() => {
      this.runnerPromise = null;
    });
  }

  private async beforeChunk(hook: QueuedChunk["onBeforeChunk"], chunk: FrameChunk): Promise<void> {
    if (!hook) return;
    try {
      await hook(chunk);
    } catch {
      return;
    }
  }

  private async runQueue(): Promise<void> {
    const duration = await executeWorkQueue({
      workers: this.workers,
      activeWorkers: this.activeWorkers,
      workQueue: this.workQueue,
      reservations: this.reservations,
      isTerminated: () => this.terminated,
      beforeChunk: (h, c) => this.beforeChunk(h, c),
      dispatch: (w, c, b, res, rej, oc) => this.dispatch(w, c, b, res, rej, oc),
      recordSuccess: (winner) => {
        this.renderedFrames += winner.frames.length;
        if (winner.failures) this.failures += winner.failures.length;
        if ((winner as { cacheHits?: number }).cacheHits) {
          this.cacheHits += (winner as { cacheHits?: number }).cacheHits!;
        }
      },
      recordFailure: () => {
        this.failures += 1;
      },
      setBudgetNotifier: (cb) => {
        this.budgetNotifier = cb;
      },
    });
    this.renderDurationMs += duration;
  }

  async terminate(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    await shutdownWorkerPool({
      cacheChannelCleanups: this.cacheChannelCleanups,
      takeActive: () => {
        const active = [...this.activeWorkers];
        this.activeWorkers = [];
        return active;
      },
      releaseReservations: () => this.reservations.releaseAll(),
      takeQueue: () => {
        const pending = [...this.workQueue];
        this.workQueue = [];
        return pending;
      },
      notifyBudget: () => this.notifyBudget(),
      takeWorkers: () => {
        const workers = [...this.workers];
        this.workers.length = 0;
        return workers;
      },
    });
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
