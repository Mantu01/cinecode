import type { ByteBudget } from "./memory.js";
import { formatBytes } from "./memory.js";
import { createError, ErrorCode } from "../errors/codes.js";
import type { FrameSink } from "./strategy-sinks.js";
import type { EncoderResult } from "../encoder/index.js";

/**
 * Byte-budgeted queue between rendered frames and the encoder. Capacity is a
 * byte allowance, so a 4K render buffers a handful of frames while a 720p one
 * buffers many. Frames enter and leave in order; when the allowance is spent
 * the producer waits instead of dropping or reordering frames.
 */
export class FrameQueue {
  private readonly encoder: FrameSink;
  private readonly budget: ByteBudget;
  private readonly frameBytes: number;
  private readonly delayMs: number;
  private pendingWrites = 0;
  private pendingBytes = 0;
  private drained = false;
  private resolveDrain!: () => void;
  private drainPromise = new Promise<void>((r) => {
    this.resolveDrain = r;
  });
  private readonly writeErrors: Error[] = [];

  constructor(encoder: FrameSink, budget: ByteBudget, frameBytes: number, delayMs = 0) {
    this.encoder = encoder;
    this.budget = budget;
    this.frameBytes = frameBytes;
    this.delayMs = delayMs;
  }

  get empty(): boolean {
    return this.pendingWrites === 0;
  }
  get size(): number {
    return this.pendingWrites;
  }
  get queuedBytes(): number {
    return this.pendingBytes;
  }

  /** Resolves once the frame has been written to the encoder. */
  async enqueue(frame: { index: number; buffer: Buffer }): Promise<void> {
    if (frame.buffer.byteLength !== this.frameBytes) {
      throw createError(ErrorCode.CC2205, {
        actual: String(frame.buffer.byteLength),
        expected: String(this.frameBytes),
      });
    }
    const bytes = frame.buffer.byteLength;
    const reservation = await this.budget.reserve(bytes);
    if (!reservation.ok) {
      throw createError(ErrorCode.CC2206, {
        required: formatBytes(bytes),
        budget: formatBytes(this.budget.limitBytes),
      });
    }
    this.pendingWrites += 1;
    this.pendingBytes += bytes;
    try {
      if (this.delayMs > 0) {
        await new Promise((r) => setTimeout(r, this.delayMs));
      }
      await this.encoder.addFrame(frame.buffer, frame.index);
    } catch (err) {
      this.pendingWrites -= 1;
      this.pendingBytes -= bytes;
      this.budget.release(bytes);
      this.writeErrors.push(err instanceof Error ? err : new Error(String(err)));
      if (this.pendingWrites === 0 && this.drained) this.resolveDrain();
      throw err;
    }
    this.pendingWrites -= 1;
    this.pendingBytes -= bytes;
    this.budget.release(bytes);
    if (this.pendingWrites === 0 && this.drained) this.resolveDrain();
  }

  /**
   * Signal end-of-stream. Returns a promise that resolves once all queued
   * frames have been written and the encoder's stdin has been closed.
   */
  async close(): Promise<EncoderResult> {
    this.drained = true;
    if (this.pendingWrites > 0) {
      await this.drainPromise;
    }
    const result = await this.encoder.finish();
    for (const err of this.writeErrors) {
      throw err;
    }
    if (!result.success) {
      throw createError(ErrorCode.CC4002, { details: result.error ?? "Encoding failed" });
    }
    return result;
  }
}
