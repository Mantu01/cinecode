import { createRenderSession, primeVideoFramesForRange } from "../renderer/engine.js";
import { getDefaultRenderRuntime } from "../renderer/runtime.js";
import { createError, ErrorCode } from "../errors/index.js";
import { estimateFrameBytes } from "./memory.js";
import { renderFrameBatch } from "./frame-batch.js";
import { DEFAULT_MAX_CONSECUTIVE_FAILURES } from "./frame-policy.js";
import type { FrameChunk } from "./chunk-identity.js";
import type {
  FrameManager,
  WorkerManagerOptions,
  WorkerPoolStats,
  WorkerResult,
  WorkerStartupMeasurement,
  WorkerThroughputMeasurement,
} from "./worker-types.js";

export class InProcessFrameManager implements FrameManager {
  private readonly session = createRenderSession();
  private readonly runtime = getDefaultRenderRuntime();
  private readonly reservations = new Map<string, number>();
  private terminated = false;
  private renderedFrames = 0;
  private failures = 0;
  private renderDurationMs = 0;

  constructor(private readonly options: WorkerManagerOptions) {}

  isTerminated(): boolean {
    return this.terminated;
  }

  getStartupMeasurement(): WorkerStartupMeasurement {
    return { workers: 0, startupMs: 0, perWorkerMs: 0 };
  }

  getThroughput(): WorkerThroughputMeasurement {
    const seconds = this.renderDurationMs / 1000;
    return {
      frames: this.renderedFrames,
      durationMs: this.renderDurationMs,
      fps: seconds > 0 ? Math.round((this.renderedFrames / seconds) * 10) / 10 : 0,
    };
  }

  releaseChunk(target: { readonly id: string } | string | number): void {
    const id = typeof target === "object" ? target.id : String(target);
    const bytes = this.reservations.get(id);
    if (bytes === undefined) return;
    this.reservations.delete(id);
    this.options.budget?.release(bytes);
  }

  async processChunks(
    chunks: readonly FrameChunk[],
    onChunk?: (result: WorkerResult) => Promise<void> | void,
    onBeforeChunk?: (chunk: FrameChunk) => Promise<void> | void,
  ): Promise<WorkerResult[]> {
    if (this.terminated) throw createError(ErrorCode.CC4003, { details: "in-process render terminated" });
    const started = Date.now();
    const results: WorkerResult[] = [];
    const frameBytes = Math.max(1, estimateFrameBytes(this.options.composition.width, this.options.composition.height));

    for (const chunk of chunks) {
      if (this.terminated) break;
      await onBeforeChunk?.(chunk);
      if (this.terminated) break;

      const bytes = chunk.frames.length * frameBytes;
      const reservation = await this.options.budget?.reserve(bytes);
      if (reservation && !reservation.ok) {
        throw createError(ErrorCode.CC7005, {
          reason: `in-process chunk needs ${bytes} bytes, over the ${reservation.limitBytes} byte render budget`,
        });
      }
      this.reservations.set(chunk.identity.id, bytes);

      try {
        await primeVideoFramesForRange(this.options.composition, chunk.frames);
        const output = await renderFrameBatch({
          composition: this.options.composition,
          seed: this.options.seed,
          frames: chunk.frames,
          policy: this.options.errorPolicy ?? "placeholder",
          maxConsecutiveFailures: DEFAULT_MAX_CONSECUTIVE_FAILURES,
          frameWidth: this.options.composition.width,
          frameHeight: this.options.composition.height,
          runtime: this.runtime,
          session: this.session,
          isCancelled: () => this.terminated,
        });
        const result: WorkerResult = { identity: chunk.identity, chunkIndex: chunk.identity.chunkIndex, ...output };
        this.renderedFrames += output.frames.length;
        this.failures += output.failures?.length ?? 0;
        if (onChunk) await onChunk(result);
        results.push(result);
      } finally {
        this.releaseChunk(chunk.identity);
      }
    }

    this.renderDurationMs += Date.now() - started;
    return results;
  }

  getStats(): WorkerPoolStats {
    let reserved = 0;
    for (const bytes of this.reservations.values()) reserved += bytes;
    return {
      chunksInFlight: 0,
      reservedBytes: reserved,
      peakReservedBytes: this.options.budget?.peakBytes ?? 0,
      budgetBytes: this.options.budget?.limitBytes ?? 0,
      transferredFrames: 0,
      renderedFrames: this.renderedFrames,
      startupMs: 0,
      renderDurationMs: this.renderDurationMs,
      cacheHits: 0,
      failures: this.failures,
      activeWorkerCount: 0,
      peakActiveWorkers: 0,
    };
  }

  async terminate(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    for (const bytes of this.reservations.values()) this.options.budget?.release(bytes);
    this.reservations.clear();
    this.session.dispose();
  }
}

export function createInProcessFrameManager(options: WorkerManagerOptions): InProcessFrameManager {
  return new InProcessFrameManager(options);
}
