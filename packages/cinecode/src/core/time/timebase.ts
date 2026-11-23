import type { Composition } from "../types/composition.js";
import type { Clip } from "../types/clips.js";
import { createConversion, secondsToFrames, type FrameConversion } from "./convert.js";
import { createVfrConversion, timeToFrames, framesToTime } from "./tempoMap.js";
import { computeClipSpan } from "../validation/timeline.js";
import { parseDurationInput } from "../time-input.js";
import { recordDegradation } from "../../errors/degradations.js";

const EPSILON = 1e-6;

export type RoundingPolicy = "round" | "floor" | "ceil";

export interface FrameWindow {
  readonly from: number;
  readonly to: number;
  readonly totalFrames: number;
  readonly compositionTotalFrames: number;
  readonly clamped: boolean;
}

export function compositionConversion(composition: Composition): FrameConversion {
  return composition.tempo && composition.tempo.length > 0
    ? createVfrConversion(composition.tempo, composition.fps)
    : createConversion(composition.fps);
}

export function secondsToFrame(
  seconds: number,
  conversion: FrameConversion,
  policy: RoundingPolicy = "round",
): number {
  const tempo = conversion.tempo;
  const raw = tempo
    ? timeToFrames(tempo.regions, seconds, conversion.fpsFloat)
    : seconds * conversion.fpsFloat;

  if (policy === "floor") return Math.floor(raw);
  if (policy === "ceil") return Math.max(0, Math.ceil(raw - EPSILON));
  return Math.round(raw);
}

export function frameToSeconds(frame: number, conversion: FrameConversion): number {
  const tempo = conversion.tempo;
  if (!tempo) return frame / conversion.fpsFloat;
  return framesToTime(tempo.regions, frame, conversion.fpsFloat);
}

export const framesToSeconds = frameToSeconds;

export function durationToFrames(durationSeconds: number, conversion: FrameConversion): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return secondsToFrame(durationSeconds, conversion, "ceil");
}

export function parseCompositionDurationSeconds(
  duration: number | string | undefined,
  fps: number,
): number | undefined {
  if (duration === undefined) return undefined;
  if (typeof duration === "number") return duration > 0 ? duration : 0;
  const parsed = parseDurationInput(duration, fps);
  return parsed.ok ? parsed.seconds : undefined;
}

export function compositionTotalFrames(composition: Composition): number {
  const conversion = compositionConversion(composition);
  let clipMax = 0;
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind === "subtitle") continue;
    if (track.kind === "audio" && (composition.width > 0 || composition.height > 0)) continue;
    for (const clip of track.clips) {
      const span = computeClipSpan(clip as Clip, conversion);
      if (span.endFrames > clipMax) clipMax = span.endFrames;
    }
  }

  if (composition.duration !== undefined) {
    const durSeconds = parseCompositionDurationSeconds(composition.duration, conversion.fpsFloat);
    if (durSeconds !== undefined) {
      const durFrames = secondsToFrames(durSeconds, conversion);
      return composition.boundaryBehavior === "extend"
        ? Math.max(clipMax, durFrames)
        : durFrames;
    }
  }

  return clipMax;
}

export function resolveFrameWindow(
  composition: Composition,
  fromFrame?: number,
  toFrame?: number,
): FrameWindow {
  const compTotal = compositionTotalFrames(composition);
  const lastCompFrame = compTotal > 0 ? compTotal - 1 : 0;
  const reqFrom = fromFrame ?? 0;
  const reqTo = toFrame ?? lastCompFrame;

  const effectiveFrom = Math.max(0, Math.min(reqFrom, compTotal));
  const effectiveTo = Math.max(effectiveFrom, Math.min(reqTo, lastCompFrame));
  const clamped = effectiveFrom !== reqFrom || effectiveTo !== reqTo;

  if (clamped) {
    recordDegradation({
      code: "CC4001",
      what: "render window",
      reason: `requested frames ${reqFrom}..${reqTo} are outside the composition (${compTotal} frames)`,
      input: composition.name,
      instead: `rendered frames ${effectiveFrom}..${effectiveTo}`,
    });
  }

  const totalFrames = compTotal === 0 ? 0 : Math.max(0, effectiveTo - effectiveFrom + 1);
  return {
    from: effectiveFrom,
    to: effectiveTo,
    totalFrames,
    compositionTotalFrames: compTotal,
    clamped,
  };
}
