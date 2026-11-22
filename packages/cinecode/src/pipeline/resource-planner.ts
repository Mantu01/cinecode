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
  readonly queueDepth: number;
  readonly previewShare: number;
  readonly partitions: CachePartitionSizes;
  readonly source: "config" | "available-memory";
  readonly summary: string;
}

export interface ResourcePlanInput {
  readonly width: number;
  readonly height: number;
  readonly concurrency?: number | "auto";
  readonly chunkSize?: number;
  readonly memoryBudgetMb?: number;
  readonly availableMemoryBytes?: number;
  readonly cpuCount?: number;
}

const DEFAULT_MEMORY_BUDGET_CAP = 2 * 1024 * 1024 * 1024; // 2 GB cap
const MIN_MEMORY_BUDGET = 64 * 1024 * 1024; // 64 MB floor

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

  // Size workers by memory first, then by CPU
  const cpus =
    input.cpuCount ??
    (typeof os.availableParallelism === "function" ? os.availableParallelism() : (os.cpus()?.length || 4));
  const maxWorkersByMemory = Math.max(1, Math.floor((totalBudget * 0.5) / (frameBytes * 2)));

  let workerCount: number;
  if (typeof input.concurrency === "number" && input.concurrency > 0) {
    workerCount = Math.min(input.concurrency, maxWorkersByMemory);
  } else {
    workerCount = Math.min(cpus, maxWorkersByMemory);
  }
  workerCount = Math.max(1, workerCount);

  // Chunk size: workerCount * chunkSize * frameBytes should fit within ~25% of budget
  const maxChunkFrames = Math.max(1, Math.floor((totalBudget * 0.25) / (frameBytes * workerCount)));
  let chunkSize: number;
  if (typeof input.chunkSize === "number" && input.chunkSize > 0) {
    chunkSize = Math.max(1, Math.min(input.chunkSize, maxChunkFrames));
  } else {
    chunkSize = Math.max(1, Math.min(30, maxChunkFrames));
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

  const summary = `${formatBytes(totalBudget)} total (${formatBytes(frameBytes)}/frame, ${workerCount} workers, chunk ${chunkSize}, queue ${queueDepth}, ${source})`;

  return {
    totalBudget,
    rawFrameBytes,
    frameBytes,
    workerCount,
    chunkSize,
    queueDepth,
    previewShare,
    partitions,
    source,
    summary,
  };
}
