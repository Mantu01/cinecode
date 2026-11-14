import type { EffectProcessor } from "./engine.js";
import { registerEffect } from "../extensions/index.js";
import { getData, putData, type EffectInput } from "./engine.js";

export interface RgbAdjustment {
  readonly r?: number;
  readonly g?: number;
  readonly b?: number;
}

export interface ColorGradingParams {
  lift?: RgbAdjustment;
  gamma?: RgbAdjustment;
  gain?: RgbAdjustment;
  masterSaturation?: number;
}

interface ToneMasks {
  readonly lift: Float32Array;
  readonly gamma: Float32Array;
  readonly gain: Float32Array;
}

function smoothStep(edge: number, width: number, luminance: number): number {
  const t = Math.min(1, Math.max(0, (luminance - (edge - width)) / (2 * width)));
  return t * t * (3 - 2 * t);
}

function splitTones(data: Uint8ClampedArray, width: number, height: number): ToneMasks {
  const lift = new Float32Array(width * height);
  const gamma = new Float32Array(width * height);
  const gain = new Float32Array(width * height);
  const softness = 0.08;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const index = pixel * 4;
    const luminance = (0.299 * data[index]! + 0.587 * data[index + 1]! + 0.114 * data[index + 2]!) / 255;
    const liftEdge = smoothStep(0.33, softness, luminance);
    const gainEdge = smoothStep(0.66, softness, luminance);
    lift[pixel] = 1 - liftEdge;
    gain[pixel] = gainEdge;
    gamma[pixel] = liftEdge * (1 - gainEdge);
  }
  return { lift, gamma, gain };
}

function channelValue(adjustment: RgbAdjustment | undefined, channel: "r" | "g" | "b"): number {
  return adjustment?.[channel] ?? 0;
}

function gammaChannelValue(adjustment: RgbAdjustment | undefined, channel: "r" | "g" | "b"): number {
  return adjustment?.[channel] ?? 1;
}

export function colorGrade(input: EffectInput, params: ColorGradingParams): void {
  const data = getData(input);
  const width = input.width;
  const height = input.height;
  const masks = splitTones(data, width, height);
  const saturation = params.masterSaturation ?? 1;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const index = pixel * 4;
    const liftWeight = masks.lift[pixel]!;
    const gammaWeight = masks.gamma[pixel]!;
    const gainWeight = masks.gain[pixel]!;
    const originalR = data[index]!;
    const originalG = data[index + 1]!;
    const originalB = data[index + 2]!;
    const originals = [originalR, originalG, originalB];
    const luminance = 0.299 * originalR + 0.587 * originalG + 0.114 * originalB;
    for (let c = 0; c < 3; c += 1) {
      const channel = (["r", "g", "b"] as const)[c]!;
      const original = originals[c]!;
      let value = original
        + channelValue(params.lift, channel) * liftWeight
        + original * (gammaChannelValue(params.gamma, channel) - 1) * gammaWeight
        + channelValue(params.gain, channel) * gainWeight;
      if (saturation !== 1) {
        value = luminance + (value - luminance) * saturation;
      }
      data[index + c] = Math.min(255, Math.max(0, value));
    }
  }
  putData(input, data);
}

function parseRgbParam(value: unknown): RgbAdjustment | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as RgbAdjustment;
    } catch {
      return undefined;
    }
  }
  if (typeof value === "object") return value as RgbAdjustment;
  return undefined;
}

export const colorGradingEffect: EffectProcessor = {
  name: "color-grading",
  apply: (input, params) => {
    colorGrade(input, {
      lift: parseRgbParam(params.lift),
      gamma: parseRgbParam(params.gamma),
      gain: parseRgbParam(params.gain),
      masterSaturation: params.masterSaturation as number | undefined,
    });
  },
};

registerEffect(colorGradingEffect);
