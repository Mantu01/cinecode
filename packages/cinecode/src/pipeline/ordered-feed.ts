import type { ChunkIdentity } from "./chunk-identity.js";
import { createError, ErrorCode } from "../errors/codes.js";

export interface FeedFrameItem {
  readonly index: number;
  readonly buffer: Buffer;
  readonly reusable: boolean;
}

export interface OrderedFeedOptions {
  readonly totalFrames: number;
  readonly startFrame?: number;
  readonly onFeedFrame: (frame: FeedFrameItem) => Promise<void>;
  readonly onPartCompleted?: (identity: ChunkIdentity) => void;
}

export class OrderedFrameFeed {
  private readonly totalFrames: number;
  private readonly startFrame: number;
  private readonly endFrame: number;
  private readonly onFeedFrame: (frame: FeedFrameItem) => Promise<void>;
  private readonly onPartCompleted?: (identity: ChunkIdentity) => void;

  private nextFrame: number;
  private completedCount = 0;
  private readonly seenFrames = new Set<number>();
  private readonly bufferedFrames = new Map<number, { buffer: Buffer; reusable: boolean; identity?: ChunkIdentity }>();
  private readonly inFlightParts = new Map<string, { identity: ChunkIdentity; remainingFrames: number }>();

  constructor(options: OrderedFeedOptions) {
    this.totalFrames = options.totalFrames;
    this.startFrame = options.startFrame ?? 0;
    this.endFrame = this.startFrame + this.totalFrames - 1;
    this.nextFrame = this.startFrame;
    this.onFeedFrame = options.onFeedFrame;
    this.onPartCompleted = options.onPartCompleted;
  }

  get completed(): number {
    return this.completedCount;
  }

  get nextExpectedFrame(): number {
    return this.nextFrame;
  }

  get bufferedCount(): number {
    return this.bufferedFrames.size;
  }

  registerPart(identity: ChunkIdentity, frameCount: number): void {
    if (frameCount <= 0) return;
    const existing = this.inFlightParts.get(identity.id);
    if (existing) {
      existing.remainingFrames += frameCount;
    } else {
      this.inFlightParts.set(identity.id, { identity, remainingFrames: frameCount });
    }
  }

  async pushFrame(
    index: number,
    buffer: Buffer,
    reusable = false,
    identity?: ChunkIdentity,
  ): Promise<void> {
    if (this.seenFrames.has(index)) {
      throw createError(ErrorCode.CC4010, {
        frame: index,
        reason: `Duplicate frame ${index} detected in encoder stream`,
      });
    }
    this.seenFrames.add(index);
    this.bufferedFrames.set(index, { buffer, reusable, identity });
    await this.flushContiguous();
  }

  async pushBatch(
    frames: readonly { readonly index: number; readonly buffer: Buffer }[],
    reusable = false,
    identity?: ChunkIdentity,
  ): Promise<void> {
    for (const frame of frames) {
      if (this.seenFrames.has(frame.index)) {
        throw createError(ErrorCode.CC4010, {
          frame: frame.index,
          reason: `Duplicate frame ${frame.index} detected in encoder stream`,
        });
      }
      this.seenFrames.add(frame.index);
      this.bufferedFrames.set(frame.index, { buffer: frame.buffer, reusable, identity });
    }
    await this.flushContiguous();
  }

  private async flushContiguous(): Promise<void> {
    while (this.bufferedFrames.has(this.nextFrame)) {
      const item = this.bufferedFrames.get(this.nextFrame)!;
      this.bufferedFrames.delete(this.nextFrame);
      const frameIndex = this.nextFrame;
      await this.onFeedFrame({ index: frameIndex, buffer: item.buffer, reusable: item.reusable });
      this.completedCount++;

      if (item.identity) {
        const part = this.inFlightParts.get(item.identity.id);
        if (part) {
          part.remainingFrames--;
          if (part.remainingFrames <= 0) {
            this.inFlightParts.delete(item.identity.id);
            this.onPartCompleted?.(part.identity);
          }
        }
      }
      this.nextFrame++;
    }
  }

  finish(): void {
    if (this.completedCount < this.totalFrames) {
      throw createError(ErrorCode.CC4010, {
        frame: this.nextFrame,
        reason: `Missing frame ${this.nextFrame} in encoder stream (completed ${this.completedCount} of ${this.totalFrames})`,
      });
    }
  }
}
