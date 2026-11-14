import type { EffectProcessor } from "./engine.js";
import { registerEffect } from "../extensions/index.js";
import { getData, putData, type EffectInput } from "./engine.js";

export interface DenoiseParams {
  strength?: number;
  spatialRadius?: number;
  colorSigma?: number;
  mode?: "bilateral" | "median";
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function bilateralDenoise(data: Uint8ClampedArray, width: number, height: number, radius: number, colorSigma: number): Uint8ClampedArray {
  const output = new Uint8ClampedArray(data.length);
  const spatialSigma = radius * 0.6;
  const spatialDenominator = 2 * spatialSigma * spatialSigma;
  const colorDenominator = 2 * colorSigma * colorSigma;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const center = (y * width + x) * 4;
      let weightSum = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = Math.max(0, Math.min(height - 1, y + dy));
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = Math.max(0, Math.min(width - 1, x + dx));
          const neighbor = (ny * width + nx) * 4;
          const spatialWeight = Math.exp(-(dx * dx + dy * dy) / spatialDenominator);
          const dr = data[neighbor]! - data[center]!;
          const dg = data[neighbor + 1]! - data[center + 1]!;
          const db = data[neighbor + 2]! - data[center + 2]!;
          const colorDistance = dr * dr + dg * dg + db * db;
          const colorWeight = Math.exp(-colorDistance / colorDenominator);
          const weight = spatialWeight * colorWeight;
          r += data[neighbor]! * weight;
          g += data[neighbor + 1]! * weight;
          b += data[neighbor + 2]! * weight;
          a += data[neighbor + 3]! * weight;
          weightSum += weight;
        }
      }
      if (weightSum > 0) {
        output[center] = r / weightSum;
        output[center + 1] = g / weightSum;
        output[center + 2] = b / weightSum;
        output[center + 3] = a / weightSum;
      } else {
        for (let c = 0; c < 4; c += 1) output[center + c] = data[center + c]!;
      }
    }
  }
  return output;
}

function medianDenoise(data: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  const output = new Uint8ClampedArray(data.length);
  const samples: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const center = (y * width + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        samples.length = 0;
        for (let dy = -radius; dy <= radius; dy += 1) {
          const ny = Math.max(0, Math.min(height - 1, y + dy));
          for (let dx = -radius; dx <= radius; dx += 1) {
            const nx = Math.max(0, Math.min(width - 1, x + dx));
            samples.push(data[(ny * width + nx) * 4 + c]!);
          }
        }
        samples.sort((a, b) => a - b);
        output[center + c] = samples[Math.floor(samples.length / 2)]!;
      }
    }
  }
  return output;
}

export function denoise(input: EffectInput, params: DenoiseParams): void {
  const strength = clamp01(params.strength ?? 0.5);
  if (strength === 0) return;
  const radius = Math.max(1, Math.min(5, Math.round(params.spatialRadius ?? 3)));
  const colorSigma = Math.max(1, params.colorSigma ?? 30);
  const filtered = params.mode === "median"
    ? medianDenoise(getData(input), input.width, input.height, radius)
    : bilateralDenoise(getData(input), input.width, input.height, radius, colorSigma);
  const original = getData(input);
  for (let i = 0; i < original.length; i += 1) {
    original[i] = original[i]! * (1 - strength) + filtered[i]! * strength;
  }
  putData(input, original);
}

export const denoiseEffect: EffectProcessor = {
  name: "denoise",
  apply: (input, params) => {
    denoise(input, {
      strength: params.strength as number | undefined,
      spatialRadius: params.spatialRadius as number | undefined,
      colorSigma: params.colorSigma as number | undefined,
      mode: params.mode as "bilateral" | "median" | undefined,
    });
  },
};

registerEffect(denoiseEffect);
