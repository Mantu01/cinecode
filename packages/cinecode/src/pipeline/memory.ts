import { freemem } from "node:os";

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
export const DEFAULT_RENDER_BUDGET_BYTES = 512 * 1024 * 1024;
const MIN_RENDER_BUDGET_BYTES = 32 * 1024 * 1024;
const AVAILABLE_MEMORY_SHARE = 0.25;

export function createMemoryBudget(options: MemoryBudgetOptions = {}): MemoryBudget {
  const maxBytesPerChunk = Math.max(16 * 1024 * 1024, options.maxBytesPerChunk ?? DEFAULT_MEMORY_BUDGET_BYTES);
  return {
    maxBytesPerChunk,
    softLimitRatio: clampRatio(options.softLimitRatio ?? 0.8),
    hardLimitRatio: clampRatio(options.hardLimitRatio ?? 0.95),
  };
}

export type ReservationOutcome =
  | { readonly ok: true; readonly bytes: number }
  | {
      readonly ok: false;
      readonly reason: "over-limit" | "exhausted";
      readonly requestedBytes: number;
      readonly limitBytes: number;
      readonly availableBytes: number;
    };

/**
 * Single byte budget shared by the encoder frame queue and in-flight worker
 * chunks. Reservations are exact (no clamping); requests exceeding the limit
 * receive a typed refusal. Releases are defensive against underflow.
 */
export class ByteBudget {
  private readonly limit: number;
  private used = 0;
  private peak = 0;
  private waitCountValue = 0;
  private waitDurationMsValue = 0;
  private underflowReported = false;
  private readonly waiters: {
    bytes: number;
    waitStart: number;
    resolve: (outcome: ReservationOutcome) => void;
  }[] = [];

  constructor(limitBytes: number) {
    this.limit = Math.max(1, Math.floor(limitBytes));
  }

  get limitBytes(): number {
    return this.limit;
  }

  get usedBytes(): number {
    return this.used;
  }

  get peakBytes(): number {
    return this.peak;
  }

  get waitCount(): number {
    return this.waitCountValue;
  }

  get waitDurationMs(): number {
    return this.waitDurationMsValue;
  }

  /** Reserves exact bytes if they fit now; returns typed refusal if over limit or exhausted. */
  tryReserve(bytes: number): ReservationOutcome {
    const size = Math.floor(bytes);
    if (size <= 0) return { ok: true, bytes: 0 };
    if (size > this.limit) {
      return {
        ok: false,
        reason: "over-limit",
        requestedBytes: size,
        limitBytes: this.limit,
        availableBytes: Math.max(0, this.limit - this.used),
      };
    }
    if (this.waiters.length > 0 || this.used + size > this.limit) {
      return {
        ok: false,
        reason: "exhausted",
        requestedBytes: size,
        limitBytes: this.limit,
        availableBytes: Math.max(0, this.limit - this.used),
      };
    }
    this.used += size;
    this.peak = Math.max(this.peak, this.used);
    return { ok: true, bytes: size };
  }

  /** Reserves exact bytes, waiting for earlier reservations to drain if needed. */
  async reserve(bytes: number): Promise<ReservationOutcome> {
    const immediate = this.tryReserve(bytes);
    if (immediate.ok || immediate.reason === "over-limit") {
      return immediate;
    }
    const size = Math.floor(bytes);
    const waitStart = Date.now();
    this.waitCountValue += 1;
    return new Promise<ReservationOutcome>((resolve) => {
      this.waiters.push({
        bytes: size,
        waitStart,
        resolve,
      });
    });
  }

  release(bytes: number): void {
    const size = Math.floor(bytes);
    if (size <= 0) return;
    if (size > this.used) {
      if (!this.underflowReported) {
        this.underflowReported = true;
        process.stderr.write(
          `[CC7005] ByteBudget programming error: attempted to release ${size} bytes but only ${this.used} bytes currently reserved\n`,
        );
      }
      this.used = 0;
    } else {
      this.used -= size;
    }
    this.drainWaiters();
  }

  private drainWaiters(): void {
    while (this.waiters.length > 0) {
      const next = this.waiters[0]!;
      if (this.used + next.bytes > this.limit) break;
      this.waiters.shift();
      this.used += next.bytes;
      this.peak = Math.max(this.peak, this.used);
      this.waitDurationMsValue += Date.now() - next.waitStart;
      next.resolve({ ok: true, bytes: next.bytes });
    }
  }

  reset(): void {
    this.used = 0;
    this.peak = 0;
    this.waitCountValue = 0;
    this.waitDurationMsValue = 0;
    this.underflowReported = false;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ ok: true, bytes: waiter.bytes });
    }
  }
}

export interface TransportBudget {
  /** Total byte budget for one render. */
  readonly totalBytes: number;
  /** Bytes of one canonical frame at the render resolution. */
  readonly frameBytes: number;
  /** Largest chunk the worker pool may render at once. */
  readonly chunkBytes: number;
  readonly maxQueuedFrames: number;
  /** Where the limit came from: explicit configuration or available memory. */
  readonly source: "config" | "available-memory";
  /** Human-readable summary printed at render start. */
  readonly description: string;
}

export interface TransportBudgetInput {
  readonly width: number;
  readonly height: number;
  readonly concurrency: number;
  readonly chunkSize: number;
  readonly maxBytes?: number;
  readonly availableBytes?: number;
}

/**
 * Derives the render byte budget from an explicit limit or from available
 * memory, then splits it between encoder-queued frames and in-flight chunks.
 */
export function resolveTransportBudget(input: TransportBudgetInput): TransportBudget {
  const frameBytes = estimateFrameBytes(input.width, input.height);
  const concurrency = Math.max(1, input.concurrency);
  const available = input.availableBytes ?? availableMemoryBytes();
  const derived = Math.floor(available * AVAILABLE_MEMORY_SHARE);
  const source: TransportBudget["source"] = input.maxBytes === undefined ? "available-memory" : "config";
  const requested = input.maxBytes ?? Math.min(DEFAULT_RENDER_BUDGET_BYTES, derived);
  // Always leave room for one frame per worker plus the encoder in flight.
  const floor = frameBytes * (concurrency + 2);
  const totalBytes = Math.max(MIN_RENDER_BUDGET_BYTES, floor, Math.floor(requested));
  // Every worker may hold one chunk while the encoder drains the queue, so a
  // chunk is capped by the share of the budget reserved for chunks in flight.
  const chunkShare = Math.floor((totalBytes * 0.4) / concurrency);
  const queueBytes = Math.max(frameBytes * 2, totalBytes - chunkShare * concurrency);
  const chunkBytes = Math.min(
    Math.max(estimateChunkBytes(1, input.width, input.height), chunkShare),
    estimateChunkBytes(Math.max(1, input.chunkSize), input.width, input.height),
  );
  const maxQueuedFrames = Math.max(1, Math.floor(queueBytes / frameBytes));
  return {
    totalBytes,
    frameBytes,
    chunkBytes,
    maxQueuedFrames,
    source,
    description: `${formatBytes(totalBytes)} total (${formatBytes(queueBytes)} frames, ${formatBytes(chunkBytes)} chunks, ${maxQueuedFrames} frames max queued, ${source})`,
  };
}

function availableMemoryBytes(): number {
  const processMemory = (process as { availableMemory?: () => number }).availableMemory;
  if (typeof processMemory === "function") {
    try {
      return processMemory();
    } catch {
      // fall through to the OS view
    }
  }
  return freemem();
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
  return frameCount * estimateFrameBytes(width, height) + compositionJsonBytes;
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
