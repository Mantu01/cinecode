import type { Composition } from "../core/types/index.js";
import { compositionTotalFrames } from "../core/time/index.js";

export interface ChunkIdentity {
  readonly id: string;
  readonly chunkIndex: number;
  readonly partIndex: number;
  readonly startFrame: number;
  readonly endFrame: number;
}

export function formatChunkId(
  chunkIndex: number,
  partIndex: number,
  startFrame: number,
  endFrame: number,
): string {
  return `chunk-${chunkIndex}.part-${partIndex}[${startFrame}..${endFrame}]`;
}

export function createChunkIdentity(
  chunkIndex: number,
  partIndex: number,
  startFrame: number,
  endFrame: number,
): ChunkIdentity {
  return {
    id: formatChunkId(chunkIndex, partIndex, startFrame, endFrame),
    chunkIndex,
    partIndex,
    startFrame,
    endFrame,
  };
}

export interface FrameChunk {
  readonly identity: ChunkIdentity;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly frames: readonly number[];
}

export function createChunks(totalFrames: number, chunkSize: number): FrameChunk[] {
  const chunks: FrameChunk[] = [];
  let chunkIndex = 0;
  for (let start = 0; start < totalFrames; start += chunkSize) {
    const end = Math.min(start + chunkSize, totalFrames);
    const frames: number[] = [];
    for (let f = start; f < end; f++) frames.push(f);
    chunks.push({
      identity: createChunkIdentity(chunkIndex, 0, start, end),
      startFrame: start,
      endFrame: end,
      frames,
    });
    chunkIndex++;
  }
  return chunks;
}

export function splitChunk(
  chunk: FrameChunk,
  maxFramesPerPart: number,
): FrameChunk[] {
  if (chunk.frames.length <= maxFramesPerPart || maxFramesPerPart <= 0) {
    return [chunk];
  }
  const parts: FrameChunk[] = [];
  let partIndex = 0;
  for (let i = 0; i < chunk.frames.length; i += maxFramesPerPart) {
    const slice = chunk.frames.slice(i, i + maxFramesPerPart);
    const startFrame = slice[0]!;
    const endFrame = slice[slice.length - 1]! + 1;
    parts.push({
      identity: createChunkIdentity(chunk.identity.chunkIndex, partIndex, startFrame, endFrame),
      startFrame,
      endFrame,
      frames: slice,
    });
    partIndex++;
  }
  return parts;
}

export function resolveChunkSize(composition: Composition, defaultChunkSize = 32): number {
  const totalFrames = compositionTotalFrames(composition);
  if (totalFrames < 300) return 128;
  if (totalFrames > 10000) return 16;
  if (estimateComplexity(composition) > 5) return 8;
  return defaultChunkSize;
}

export function estimateComplexity(composition: Composition): number {
  let complexity = 0;
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind === "audio") continue;
    for (const clip of track.clips) {
      const typedClip = clip as {
        effects?: unknown[];
        transitionIn?: boolean;
        transitionOut?: boolean;
        matte?: unknown;
        mask?: unknown;
      };
      complexity += typedClip.effects?.length ?? 0;
      if (typedClip.transitionIn || typedClip.transitionOut) complexity += 0.5;
      if (typedClip.matte) complexity += 0.3;
      if (typedClip.mask) complexity += 0.2;
    }
  }
  return complexity;
}
