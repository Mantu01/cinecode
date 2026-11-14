import type { EffectInput, EffectProcessor } from "./engine.js";
import { defineEffect, getData, putData } from "./engine.js";
import { registerEffect } from "../extensions/index.js";
import { parseColor } from "../renderer/color/parse.js";

export type NeonGlowMode = "radial" | "directional";

export interface NeonGlowParams {
  threshold?: number;
  glowWidth?: number;
  glowColor?: string;
  glowIntensity?: number;
  edgeIntensity?: number;
  mode?: NeonGlowMode;
}

interface EdgeField {
  readonly magnitude: Float32Array;
  readonly directionX: Float32Array;
  readonly directionY: Float32Array;
}

function luminanceAt(data: Uint8ClampedArray, index: number): number {
  return data[index]! * 0.299 + data[index + 1]! * 0.587 + data[index + 2]! * 0.114;
}

export function detectEdges(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): Uint8ClampedArray {
  const field = computeEdgeField(data, width, height);
  const mask = new Uint8ClampedArray(width * height);
  for (let i = 0; i < mask.length; i++) {
    const magnitude = field.magnitude[i]!;
    mask[i] = magnitude > threshold ? clampByte(magnitude) : 0;
  }
  return mask;
}

function computeEdgeField(data: Uint8ClampedArray, width: number, height: number): EdgeField {
  const magnitude = new Float32Array(width * height);
  const directionX = new Float32Array(width * height);
  const directionY = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const xm1 = x > 0 ? x - 1 : 0;
      const xp1 = x < width - 1 ? x + 1 : width - 1;
      const ym1 = y > 0 ? y - 1 : 0;
      const yp1 = y < height - 1 ? y + 1 : height - 1;

      const tl = luminanceAt(data, (ym1 * width + xm1) * 4);
      const tc = luminanceAt(data, (ym1 * width + x) * 4);
      const tr = luminanceAt(data, (ym1 * width + xp1) * 4);
      const ml = luminanceAt(data, (y * width + xm1) * 4);
      const mr = luminanceAt(data, (y * width + xp1) * 4);
      const bl = luminanceAt(data, (yp1 * width + xm1) * 4);
      const bc = luminanceAt(data, (yp1 * width + x) * 4);
      const br = luminanceAt(data, (yp1 * width + xp1) * 4);

      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const index = y * width + x;
      magnitude[index] = Math.sqrt(gx * gx + gy * gy) / 4;
      directionX[index] = gx;
      directionY[index] = gy;
    }
  }

  return { magnitude, directionX, directionY };
}

export function traceGlow(
  edgeMask: Uint8ClampedArray,
  width: number,
  height: number,
  glowWidth: number,
  glowIntensity: number,
): Float32Array {
  const glow = new Float32Array(width * height);
  if (glowWidth <= 0 || glowIntensity <= 0) return glow;
  const radius = Math.max(1, Math.min(64, Math.round(glowWidth)));
  const kernel = buildKernel(radius);
  const horizontal = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = x + k;
        if (sx < 0 || sx >= width) continue;
        sum += edgeMask[y * width + sx]! * kernel[k + radius]!;
      }
      horizontal[y * width + x] = sum;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = y + k;
        if (sy < 0 || sy >= height) continue;
        sum += horizontal[sy * width + x]! * kernel[k + radius]!;
      }
      const index = y * width + x;
      glow[index] = Math.min(1, (sum / 255) * glowIntensity);
    }
  }

  return glow;
}

function buildKernel(radius: number): Float32Array {
  const kernel = new Float32Array(radius * 2 + 1);
  const sigma = Math.max(0.75, radius / 2);
  const denominator = 2 * sigma * sigma;
  let total = 0;
  for (let k = -radius; k <= radius; k++) {
    const weight = Math.exp(-(k * k) / denominator);
    kernel[k + radius] = weight;
    total += weight;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= total;
  return kernel;
}

function traceDirectionalGlow(
  field: EdgeField,
  threshold: number,
  width: number,
  height: number,
  glowWidth: number,
  glowIntensity: number,
): Float32Array {
  const glow = new Float32Array(width * height);
  const steps = Math.max(2, Math.min(48, Math.round(glowWidth)));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (field.magnitude[index]! <= threshold) continue;
      const gx = field.directionX[index]!;
      const gy = field.directionY[index]!;
      const length = Math.hypot(gx, gy);
      if (length === 0) continue;
      const tangentX = -gy / length;
      const tangentY = gx / length;
      const strength = (field.magnitude[index]! / 255) * glowIntensity;
      for (let step = -steps; step <= steps; step++) {
        const sx = Math.round(x + tangentX * step);
        const sy = Math.round(y + tangentY * step);
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
        const falloff = 1 - Math.abs(step) / (steps + 1);
        const target = sy * width + sx;
        glow[target] = Math.min(1, glow[target]! + strength * falloff * 0.35);
      }
    }
  }
  return glow;
}

export function neonGlow(input: EffectInput, params: NeonGlowParams): void {
  const threshold = clamp(params.threshold ?? 30, 1, 255);
  const glowWidth = clamp(params.glowWidth ?? 8, 0, 64);
  const glowIntensity = clamp(params.glowIntensity ?? 0.8, 0, 1);
  const edgeIntensity = clamp(params.edgeIntensity ?? 0.3, 0, 1);
  const mode = params.mode ?? "radial";
  const glowRgb = parseGlowColor(params.glowColor ?? "#00ffff");

  const data = getData(input);
  const { width, height } = input;
  const field = computeEdgeField(data, width, height);
  const mask = new Uint8ClampedArray(width * height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = field.magnitude[i]! > threshold ? clampByte(field.magnitude[i]!) : 0;
  }

  const glow = mode === "directional"
    ? traceDirectionalGlow(field, threshold, width, height, glowWidth, glowIntensity)
    : traceGlow(mask, width, height, glowWidth, glowIntensity);

  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel++) {
    const edge = mask[pixel]! / 255;
    const glowValue = glow[pixel]!;
    for (let channel = 0; channel < 3; channel++) {
      const source = data[i + channel]!;
      const edgeBoost = source * (1 - edgeIntensity) + edge * 255 * edgeIntensity;
      const target = glowRgb[channel]! * glowValue;
      data[i + channel] = 255 - ((255 - edgeBoost) * (255 - target)) / 255;
    }
  }

  putData(input, data);
}

function parseGlowColor(color: string): [number, number, number] {
  try {
    const parsed = parseColor(color);
    return [parsed.r, parsed.g, parsed.b];
  } catch {
    return [0, 255, 255];
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export const neonGlowEffect: EffectProcessor = defineEffect({
  name: "neon-glow",
  params: {
    threshold: { default: 30, type: "number" },
    glowWidth: { default: 8, type: "number" },
    glowColor: { default: "#00ffff", type: "string" },
    glowIntensity: { default: 0.8, type: "number" },
    edgeIntensity: { default: 0.3, type: "number" },
    mode: { default: "radial", type: "string" },
  },
  process: (input, params) => {
    neonGlow(input, {
      threshold: params.threshold as number,
      glowWidth: params.glowWidth as number,
      glowColor: params.glowColor as string,
      glowIntensity: params.glowIntensity as number,
      edgeIntensity: params.edgeIntensity as number,
      mode: params.mode as NeonGlowMode,
    });
  },
});

registerEffect(neonGlowEffect);
