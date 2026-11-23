import type { Worker } from "node:worker_threads";
import type { Composition, FontEntry } from "../core/types/index.js";
import type { ByteBudget } from "./memory.js";
import type { CacheProvider, BatchCacheProvider } from "./cache-channel.js";
import type { FrameErrorPolicy, FrameFailure } from "./frame-worker.js";
import type { ChunkIdentity, FrameChunk } from "./chunk-identity.js";
import type { ExtensionDescriptor } from "../plugin/descriptor.js";

export interface WorkerStartupMeasurement {
  readonly workers: number;
  readonly startupMs: number;
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
  readonly cacheDir: string;
  readonly budget?: ByteBudget;
  readonly maxChunkBytes?: number;
  readonly onMemoryWarning?: (usageBytes: number, budgetBytes: number) => void;
  readonly errorPolicy?: FrameErrorPolicy;
  readonly cacheProvider?: CacheProvider;
  readonly batchCacheProvider?: BatchCacheProvider;
  readonly fonts?: readonly FontEntry[];
  readonly projectRoot?: string;
  readonly mediaDir?: string;
  readonly crashOnFrame?: number;
  readonly plugins?: readonly PluginWorkerBootstrap[];
  readonly extensions?: ExtensionDescriptor;
  readonly binaries?: { readonly ffmpegPath?: string; readonly ffprobePath?: string };
  readonly verbose?: boolean;
}

export interface WorkerResult {
  readonly identity: ChunkIdentity;
  readonly chunkIndex: number;
  readonly frames: readonly { readonly index: number; readonly buffer: Buffer }[];
  readonly error?: string;
  readonly failures?: readonly FrameFailure[];
  readonly aborted?: boolean;
  readonly diagnostics?: string;
}

export interface ActiveWorker {
  readonly worker: Worker;
  readonly promise: Promise<WorkerResult>;
  readonly resolve: (result: WorkerResult) => void;
  readonly reject: (error: Error) => void;
  readonly onChunk?: (result: WorkerResult) => Promise<void> | void;
  readonly identity: ChunkIdentity;
  readonly chunkIndex: number;
  readonly estimatedBytes: number;
  readonly internalResolve: (result: WorkerResult) => void;
  readonly internalReject: (error: Error) => void;
}

export interface QueuedChunk {
  readonly chunk: FrameChunk;
  readonly resolve: (result: WorkerResult) => void;
  readonly reject: (error: Error) => void;
  readonly onChunk?: (result: WorkerResult) => Promise<void> | void;
  readonly onBeforeChunk?: (chunk: FrameChunk) => Promise<void> | void;
}

export interface TransportOutput extends Omit<WorkerResult, "frames" | "identity"> {
  readonly chunkId?: string;
  readonly frames: readonly (
    | { readonly index: number; readonly buffer: Buffer }
    | { readonly index: number; readonly pixels: ArrayBufferView }
  )[];
}

export interface FrameManager {
  processChunks(
    chunks: readonly FrameChunk[],
    onChunk?: (result: WorkerResult) => Promise<void> | void,
    onBeforeChunk?: (chunk: FrameChunk) => Promise<void> | void,
  ): Promise<WorkerResult[]>;
  releaseChunk(target: ChunkIdentity | string | number): void;
  isTerminated(): boolean;
  getStartupMeasurement(): WorkerStartupMeasurement;
  getThroughput(): WorkerThroughputMeasurement;
  getStats(): WorkerPoolStats;
  terminate(): Promise<void>;
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
