import type { FrameChunk } from "./workers.js";
import type { RenderCache } from "./cache.js";

export interface ChunkPartitionResult {
  readonly reusedByChunk: Map<number, readonly { index: number; buffer: Buffer }[]>;
  readonly cachedGapsByChunk: Map<number, ReadonlyMap<number, Buffer>>;
  readonly chunksToRender: { chunkIndex: number; chunk: FrameChunk }[];
}

export async function partitionChunksForRender(params: {
  readonly chunks: readonly FrameChunk[];
  readonly renderCache: RenderCache;
  readonly compositionHash: string;
  readonly noCache: boolean;
  readonly fresh: boolean;
  readonly canResume: boolean;
  readonly resumedFrames: ReadonlySet<number>;
}): Promise<ChunkPartitionResult> {
  const {
    chunks,
    renderCache,
    compositionHash,
    noCache,
    fresh,
    canResume,
    resumedFrames,
  } = params;

  const reusedByChunk = new Map<number, readonly { index: number; buffer: Buffer }[]>();
  const cachedGapsByChunk = new Map<number, ReadonlyMap<number, Buffer>>();
  const chunksToRender: { chunkIndex: number; chunk: FrameChunk }[] = [];

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex]!;
    if (!noCache && !fresh) {
      if (canResume) {
        const cachedByIndex = new Map<number, Buffer>();
        for (const frameIndex of chunk.frames) {
          const buffer = await renderCache.getFrame(compositionHash, frameIndex);
          if (buffer) cachedByIndex.set(frameIndex, buffer);
        }
        const missingFrames = chunk.frames.filter((frameIndex) =>
          !resumedFrames.has(frameIndex) || !cachedByIndex.has(frameIndex),
        );
        if (missingFrames.length === 0) {
          reusedByChunk.set(
            chunkIndex,
            chunk.frames.map((index) => ({ index, buffer: cachedByIndex.get(index)! })),
          );
          continue;
        }
        const reusableCache = new Map<number, Buffer>();
        for (const [frameIndex, buffer] of cachedByIndex) {
          if (resumedFrames.has(frameIndex)) reusableCache.set(frameIndex, buffer);
        }
        if (reusableCache.size > 0) cachedGapsByChunk.set(chunkIndex, reusableCache);
        chunksToRender.push({
          chunkIndex,
          chunk: { ...chunk, frames: missingFrames },
        });
        continue;
      }
      const cachedFrames = await renderCache.getChunk(compositionHash, chunkIndex);
      const exactChunk =
        cachedFrames !== null &&
        cachedFrames.length === chunk.frames.length &&
        cachedFrames.every((frame, at) => frame.index === chunk.frames[at]);
      if (cachedFrames && exactChunk) {
        reusedByChunk.set(chunkIndex, cachedFrames);
        continue;
      }
    }
    chunksToRender.push({ chunkIndex, chunk });
  }

  return { reusedByChunk, cachedGapsByChunk, chunksToRender };
}
