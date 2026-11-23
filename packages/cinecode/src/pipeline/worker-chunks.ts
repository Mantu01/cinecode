import type { ByteBudget } from "./memory.js";
import { estimateChunkBytes, estimateFrameBytes, formatBytes } from "./memory.js";
import type { FrameChunk } from "./chunk-identity.js";
import { splitChunk } from "./chunk-identity.js";

export function chunkBytes(chunk: FrameChunk, frameWidth: number, frameHeight: number): number {
  return estimateChunkBytes(chunk.frames.length, frameWidth, frameHeight);
}

export function chunkLimit(maxChunkBytes: number | undefined, budget: ByteBudget | undefined): number | undefined {
  if (maxChunkBytes === undefined) return budget?.limitBytes;
  return Math.min(maxChunkBytes, budget?.limitBytes ?? maxChunkBytes);
}

export function assertChunkFits(bytes: number, limit: number | undefined): void {
  if (limit !== undefined && bytes > limit) {
    throw new Error(
      `Render chunk needs ${formatBytes(bytes)} of frames, over the ${formatBytes(limit)} chunk budget. Reduce the chunk size or raise the render memory budget.`,
    );
  }
}

export function planChunks(
  chunks: readonly FrameChunk[],
  frameWidth: number,
  frameHeight: number,
  maxChunkBytes: number | undefined,
  budget: ByteBudget | undefined,
): FrameChunk[] {
  const limit = maxChunkBytes ?? budget?.limitBytes;
  const planned: FrameChunk[] = [];
  for (const chunk of chunks) {
    const bytes = chunkBytes(chunk, frameWidth, frameHeight);
    if (limit !== undefined && bytes > limit && chunk.frames.length > 1) {
      const frameBytes = Math.max(1, estimateFrameBytes(frameWidth, frameHeight));
      const maxFrames = Math.max(1, Math.floor(limit / frameBytes));
      planned.push(...splitChunk(chunk, maxFrames));
    } else {
      planned.push(chunk);
    }
  }
  return planned;
}
