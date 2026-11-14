export type MemoryStatus = "ok" | "warning" | "over-budget";

export interface MemoryBudget {
  readonly maxBytesPerChunk: number;
  readonly softLimitRatio: number;
  readonly hardLimitRatio: number;
}

export interface MemoryBudgetOptions {
  readonly maxBytesPerChunk?: number;
  readonly softLimitRatio?: number;
  readonly hardLimitRatio?: number;
}

export const DEFAULT_MEMORY_BUDGET_BYTES = 256 * 1024 * 1024;

export function createMemoryBudget(options: MemoryBudgetOptions = {}): MemoryBudget {
  const maxBytesPerChunk = Math.max(16 * 1024 * 1024, options.maxBytesPerChunk ?? DEFAULT_MEMORY_BUDGET_BYTES);
  return {
    maxBytesPerChunk,
    softLimitRatio: clampRatio(options.softLimitRatio ?? 0.8),
    hardLimitRatio: clampRatio(options.hardLimitRatio ?? 0.95),
  };
}

export class MemoryBudgetError extends Error {
  readonly usageBytes: number;
  readonly budgetBytes: number;

  constructor(usageBytes: number, budgetBytes: number) {
    super(
      `Render chunk exceeded its memory budget (${formatBytes(usageBytes)} of ${formatBytes(budgetBytes)}). ` +
      "Reduce concurrency, lower the chunk size, or raise the memory budget.",
    );
    this.name = "MemoryBudgetError";
    this.usageBytes = usageBytes;
    this.budgetBytes = budgetBytes;
  }
}

export class MemoryTracker {
  private usedBytes = 0;
  private softWarned = false;

  trackAllocation(bytes: number): void {
    this.usedBytes += Math.max(0, bytes);
  }

  releaseAllocation(bytes: number): void {
    this.usedBytes = Math.max(0, this.usedBytes - Math.max(0, bytes));
  }

  getUsage(): number {
    return this.usedBytes;
  }

  reset(): void {
    this.usedBytes = 0;
    this.softWarned = false;
  }

  checkBudget(budget: MemoryBudget): MemoryStatus {
    const ratio = budget.maxBytesPerChunk <= 0 ? 0 : this.usedBytes / budget.maxBytesPerChunk;
    if (ratio >= budget.hardLimitRatio) return "over-budget";
    if (ratio >= budget.softLimitRatio) {
      this.softWarned = true;
      return "warning";
    }
    return "ok";
  }

  hasWarned(): boolean {
    return this.softWarned;
  }
}

export function estimateFrameBytes(width: number, height: number): number {
  return Math.max(1, width) * Math.max(1, height) * 4;
}

export function estimateChunkBytes(
  frameCount: number,
  width: number,
  height: number,
  compositionJsonBytes = 0,
): number {
  return frameCount * estimateFrameBytes(width, height) * 2 + compositionJsonBytes;
}

export function splitChunkFrames(
  frames: readonly number[],
  width: number,
  height: number,
  budget: MemoryBudget,
): number[][] {
  if (frames.length === 0) return [];
  const frameBytes = estimateChunkBytes(1, width, height);
  const maxFrames = Math.max(1, Math.floor(budget.maxBytesPerChunk / frameBytes));
  if (frames.length <= maxFrames) return [Array.from(frames)];
  const groups: number[][] = [];
  for (let index = 0; index < frames.length; index += maxFrames) {
    groups.push(Array.from(frames.slice(index, index + maxFrames)));
  }
  return groups;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function clampRatio(value: number): number {
  return Math.max(0.1, Math.min(1, value));
}
