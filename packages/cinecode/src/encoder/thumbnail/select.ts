import type { Composition } from "../../core/types/index.js";
import { computeClipSpan } from "../../core/validation/index.js";
import { createConversion, secondsToFrame } from "../../core/time/index.js";
import { scoreFrame, type FrameScore } from "./scorer.js";

export interface ThumbnailCandidate {
  readonly frame: number;
  readonly buffer: Buffer;
  readonly score: FrameScore;
}

export interface ThumbnailSelection extends ThumbnailCandidate {
  readonly candidates: readonly { readonly frame: number; readonly score: number }[];
}

export interface ThumbnailOptions {
  readonly sampleCount?: number;
  readonly excludeEdges?: boolean;
  readonly preferMidpoint?: boolean;
  readonly seed?: number;
  readonly frameIndices?: readonly number[];
  readonly renderFrame?: (composition: Composition, frame: number, seed: number) => Promise<Buffer>;
}

function totalFrames(composition: Composition): number {
  const conversion = createConversion(composition.fps);
  if (composition.duration !== undefined) {
    const seconds = typeof composition.duration === "number"
      ? composition.duration
      : Number.parseFloat(composition.duration);
    if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(secondsToFrame(seconds, conversion)));
  }
  let max = 1;
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind === "audio") continue;
    for (const clip of track.clips) {
      const span = computeClipSpan(clip, conversion);
      if (span.endFrames > max) max = span.endFrames;
    }
  }
  return max;
}

function selectFrames(total: number, options: ThumbnailOptions): number[] {
  if (options.frameIndices?.length) {
    return [...new Set(options.frameIndices)].filter((frame) => frame >= 0 && frame < total).sort((a, b) => a - b);
  }
  const count = Math.max(1, options.sampleCount ?? 10);
  const start = options.excludeEdges === false ? 0 : Math.floor(total * 0.05);
  const end = options.excludeEdges === false ? total - 1 : Math.ceil(total * 0.95) - 1;
  const span = Math.max(0, end - start);
  const frames: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const ratio = count === 1 ? 0.5 : index / (count - 1);
    const biased = options.preferMidpoint ? 0.5 + (ratio - 0.5) * 0.6 : ratio;
    frames.push(Math.round(start + biased * span));
  }
  return [...new Set(frames.map((frame) => Math.max(0, Math.min(total - 1, frame))))];
}

export async function selectThumbnailFrame(
  composition: Composition,
  options: ThumbnailOptions = {},
): Promise<ThumbnailSelection> {
  const total = totalFrames(composition);
  const frames = selectFrames(total, options);
  const seed = options.seed ?? 0;
  const render = options.renderFrame ?? (async (comp, frame, renderSeed) => {
    const { renderFrame } = await import("../../renderer/engine.js");
    const result = await renderFrame(comp, frame, renderSeed);
    return result.canvas.encode("png");
  });

  const candidates: ThumbnailCandidate[] = [];
  let previous: Buffer | undefined;
  for (const frame of frames) {
    const buffer = await render(composition, frame, seed);
    const score = await scoreFrame(buffer, previous);
    candidates.push({ frame, buffer, score });
    previous = buffer;
  }

  if (candidates.length === 0) {
    const buffer = await render(composition, 0, seed);
    return { frame: 0, buffer, score: await scoreFrame(buffer), candidates: [] };
  }

  const best = candidates.reduce((winner, candidate) =>
    candidate.score.score > winner.score.score ? candidate : winner,
  );
  return {
    ...best,
    candidates: candidates
      .map((candidate) => ({ frame: candidate.frame, score: candidate.score.score }))
      .sort((left, right) => right.score - left.score),
  };
}
