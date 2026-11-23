import os from "node:os";
import { createError, ErrorCode } from "../errors/index.js";
import { formatBytes } from "./memory.js";

export interface CachePartitionSizes {
  readonly frames: number;
  readonly images: number;
  readonly text: number;
  readonly media: number;
}

export interface ResourcePlan {
  readonly totalBudget: number;
  readonly rawFrameBytes: number;
  readonly frameBytes: number;
  readonly workerCount: number;
  readonly chunkSize: number;
  readonly inProcess: boolean;
  readonly queueDepth: number;
  readonly previewShare: number;
  readonly partitions: CachePartitionSizes;
  readonly source: "config" | "available-memory";
  readonly summary: string;
}

export interface ResourcePlanInput {
  readonly width: number;
  readonly height: number;
  readonly frameCount?: number;
  readonly concurrency?: number | "auto";
  readonly chunkSize?: number;
  readonly memoryBudgetMb?: number;
  readonly availableMemoryBytes?: number;
  readonly cpuCount?: number;
}

const DEFAULT_MEMORY_BUDGET_CAP = 2 * 1024 * 1024 * 1024;
const MIN_MEMORY_BUDGET = 64 * 1024 * 1024;
export const MIN_FRAMES_PER_CHUNK = 8;
export const IN_PROCESS_FRAME_LIMIT = 8;
export const MIN_CHUNK_SIZE = 1;
export const MAX_CHUNK_SIZE = 100;

export function availableCores(fallback = 4): number {
  if (typeof os.availableParallelism === "function") {
    return Math.max(1, os.availableParallelism());
  }
  return Math.max(1, os.cpus()?.length || fallback);
}

function getAvailableMemory(): number {
  const pMem = (process as { availableMemory?: () => number }).availableMemory;
  if (typeof pMem === "function") {
    try {
      return pMem();
    } catch {
      // Note: Fall through to OS freemem
    }
  }
  return os.freemem();
}

/** Computes single resource plan driving workers, chunk size, queue and cache partitions. */
export function createResourcePlan(input: ResourcePlanInput): ResourcePlan {
  const width = Math.max(1, Math.floor(input.width));
  const height = Math.max(1, Math.floor(input.height));
  const rawFrameBytes = width * height * 4;
  // 25% encoder overhead over raw RGBA
  const frameBytes = Math.ceil(rawFrameBytes * 1.25);

  let totalBudget: number;
  let source: "config" | "available-memory";

  if (input.memoryBudgetMb !== undefined && input.memoryBudgetMb > 0) {
    totalBudget = Math.floor(input.memoryBudgetMb * 1024 * 1024);
    source = "config";
  } else {
    const avail = input.availableMemoryBytes ?? getAvailableMemory();
    const fraction = Math.floor(avail * 0.25);
    totalBudget = Math.min(DEFAULT_MEMORY_BUDGET_CAP, Math.max(MIN_MEMORY_BUDGET, fraction));
    source = "available-memory";
  }

  // Refuse if single frame cannot fit total budget
  if (frameBytes > totalBudget) {
    const neededMb = Math.ceil((frameBytes * 2) / (1024 * 1024));
    throw createError(
      ErrorCode.CC7005,
      {
        reason: `Single frame ${width}x${height} requires ${formatBytes(frameBytes)} (including 25% encoder overhead) which exceeds total memory budget of ${formatBytes(totalBudget)}`,
      },
      {
        fixHint: `Increase memory budget with --memory-budget ${neededMb}MB or reduce resolution.`,
      },
    );
  }

  const frameCount = input.frameCount !== undefined ? Math.max(0, Math.floor(input.frameCount)) : undefined;
  const cpus = Math.max(1, input.cpuCount ?? availableCores());
  const explicitConcurrency = typeof input.concurrency === "number" ? input.concurrency : null;
  if (explicitConcurrency !== null && (explicitConcurrency < 1 || explicitConcurrency > cpus * 2)) {
    throw createError(ErrorCode.CC1012, {
      reason: `concurrency ${explicitConcurrency} is outside the supported range 1..${cpus * 2} (cores * 2)`,
    });
  }

  const inProcess = frameCount !== undefined && frameCount > 0 && frameCount <= IN_PROCESS_FRAME_LIMIT;
  const maxWorkersByMemory = Math.max(1, Math.floor((totalBudget * 0.5) / (frameBytes * 2)));
  const requestedWorkers = explicitConcurrency ?? cpus;
  const workersByFrames =
    frameCount !== undefined && frameCount > 0
      ? Math.ceil(frameCount / MIN_FRAMES_PER_CHUNK)
      : cpus;

  const workerCount = inProcess
    ? 0
    : Math.max(1, Math.min(requestedWorkers, cpus, workersByFrames, maxWorkersByMemory));

  // Chunk size: workerCount * chunkSize * frameBytes should fit within ~25% of budget
  const maxChunkFrames = Math.max(1, Math.floor((totalBudget * 0.25) / (frameBytes * Math.max(1, workerCount))));
  const configuredChunkSize = typeof input.chunkSize === "number" && input.chunkSize > 0 ? input.chunkSize : MAX_CHUNK_SIZE;
  let chunkSize: number;
  if (inProcess) {
    chunkSize = Math.max(1, Math.min(configuredChunkSize, frameCount ?? 1));
  } else if (frameCount !== undefined && frameCount > 0) {
    const perWorker = Math.ceil(frameCount / workerCount);
    const upper = Math.max(1, Math.min(MAX_CHUNK_SIZE, frameCount, maxChunkFrames));
    chunkSize = Math.min(upper, Math.max(MIN_CHUNK_SIZE, Math.min(configuredChunkSize, perWorker)));
  } else {
    chunkSize = Math.max(1, Math.min(configuredChunkSize, maxChunkFrames));
  }

  // Encoder queue depth
  const queueDepth = Math.max(2, Math.floor((totalBudget * 0.2) / frameBytes));

  // Preview share (15% of total budget)
  const previewShare = Math.floor(totalBudget * 0.15);

  // Cache partitions share remaining memory
  const usedForPipeline = workerCount * chunkSize * frameBytes + queueDepth * frameBytes + previewShare;
  const cacheBudget = Math.max(1024 * 1024, totalBudget - usedForPipeline);

  const partitions: CachePartitionSizes = {
    frames: Math.floor(cacheBudget * 0.5),
    images: Math.floor(cacheBudget * 0.25),
    media: Math.floor(cacheBudget * 0.15),
    text: Math.floor(cacheBudget * 0.1),
  };

  const pool = inProcess ? "in-process" : `${workerCount} workers`;
  const summary = `${formatBytes(totalBudget)} total (${formatBytes(frameBytes)}/frame, ${pool}, chunk ${chunkSize}, queue ${queueDepth}, ${source})`;

  return {
    totalBudget,
    rawFrameBytes,
    frameBytes,
    workerCount,
    chunkSize,
    inProcess,
    queueDepth,
    previewShare,
    partitions,
    source,
    summary,
  };
}
