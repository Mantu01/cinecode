import type { FramesMarker } from "./values.js";
import { isFrames, parseTimecode } from "./values.js";
import { type Rational, resolveFps, rationalDiv } from "./rational.js";

export type Fps = number | Rational;

export function framesPerSecond(fps: Fps): number {
  const r = resolveFps(fps);
  return r.num / r.den;
}

export function halfUp(value: number): number {
  return Math.round(value);
}

export interface FrameConversion {
  readonly fpsRational: Rational;
  readonly fpsFloat: number;
  readonly tempo?: import("./tempoMap.js").TempoMap;
  readonly getTempo?: (time: number) => number;
}

export function createConversion(fps: Fps): FrameConversion {
  const fpsRational = resolveFps(fps);
  return { fpsRational, fpsFloat: fpsRational.num / fpsRational.den };
}

export function secondsToFrames(secondsValue: number, conversion: FrameConversion): number {
  return halfUp(secondsValue * conversion.fpsFloat);
}

export function timecodeToFrames(value: string, conversion: FrameConversion): number {
  const { hours, minutes, secondsField, framesField } = parseTimecode(value);
  return (
    (hours * 3600 + minutes * 60 + secondsField) * conversion.fpsFloat +
    framesField
  );
}

export function framesMarkerToFrames(value: FramesMarker, _conversion: FrameConversion): number {
  return value.__cinecode_frames;
}

export function timeInputToFrames(value: number | string | FramesMarker, conversion: FrameConversion): number {
  if (isFrames(value)) {
    return value.__cinecode_frames;
  }
  if (typeof value === "string") {
    return timecodeToFrames(value, conversion);
  }
  return secondsToFrames(value, conversion);
}

function rawFramesToSeconds(frameCount: number, conversion: FrameConversion): number {
  return frameCount / conversion.fpsFloat;
}

export interface SampleConversion {
  readonly sampleRate: number;
}

export function createSampleConversion(sampleRate: number): SampleConversion {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`sampleRate must be a positive whole number, got ${sampleRate}`);
  }
  return { sampleRate };
}

export function secondsToSamples(secondsValue: number, conversion: SampleConversion): number {
  return Math.floor(secondsValue * conversion.sampleRate);
}

export function framesToSamples(frameCount: number, conversion: FrameConversion, samples: SampleConversion): number {
  const secondsValue = rawFramesToSeconds(frameCount, conversion);
  return secondsToSamples(secondsValue, samples);
}

export function samplesToSeconds(sampleCount: number, samples: SampleConversion): number {
  return sampleCount / samples.sampleRate;
}

export function syncDriftFrames(totalFrames: number, conversion: FrameConversion, samples: SampleConversion): number {
  const drift = samplesToSeconds(framesToSamples(totalFrames, conversion, samples), samples) - rawFramesToSeconds(totalFrames, conversion);
  return Math.abs(drift) / conversion.fpsFloat;
}

export function framesPerSample(fps: Fps, samples: SampleConversion): Rational {
  return rationalDiv(resolveFps(fps), { num: samples.sampleRate, den: 1 });
}
