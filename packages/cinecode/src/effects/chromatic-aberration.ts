import type { EffectInput, EffectProcessor } from "./engine.js";
import { defineEffect, getData, putData } from "./engine.js";
import { registerEffect } from "../extensions/index.js";

export interface ChromaticAberrationCenter {
  readonly x: number;
  readonly y: number;
}

export interface ChromaticAberrationParams {
  intensity?: number;
  centerX?: number;
  centerY?: number;
  center?: ChromaticAberrationCenter;
  radial?: boolean;
  power?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sampleBilinear(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
): number {
  const clampedX = clamp(x, 0, width - 1);
  const clampedY = clamp(y, 0, height - 1);
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = clampedX - x0;
  const fy = clampedY - y0;
  const top = source[(y0 * width + x0) * 4 + channel]! * (1 - fx) + source[(y0 * width + x1) * 4 + channel]! * fx;
  const bottom = source[(y1 * width + x0) * 4 + channel]! * (1 - fx) + source[(y1 * width + x1) * 4 + channel]! * fx;
  return top * (1 - fy) + bottom * fy;
}

export function chromaticAberration(input: EffectInput, params: ChromaticAberrationParams = {}): void {
  const { width, height } = input;
  const radial = params.radial !== false;
  const power = Math.max(0.1, params.power ?? 2);
  const intensity = params.intensity ?? 0.003;
  const maxDisplacement = intensity * Math.max(width, height);
  const cx = clamp((params.center?.x ?? params.centerX ?? 0.5) * width, 0, width);
  const cy = clamp((params.center?.y ?? params.centerY ?? 0.5) * height, 0, height);
  const maxDist = Math.max(1, Math.max(
    Math.hypot(cx, cy),
    Math.hypot(width - cx, cy),
    Math.hypot(cx, height - cy),
    Math.hypot(width - cx, height - cy),
  ));

  const data = getData(input);
  const source = new Uint8ClampedArray(data);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (!radial) {
        const shift = maxDisplacement * (x / width);
        data[index] = sampleBilinear(source, width, height, x + shift, y, 0);
        data[index + 2] = sampleBilinear(source, width, height, x - shift, y, 2);
        data[index + 1] = source[index + 1]!;
        data[index + 3] = source[index + 3]!;
        continue;
      }

      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.0001) {
        data[index] = source[index]!;
        data[index + 1] = source[index + 1]!;
        data[index + 2] = source[index + 2]!;
        data[index + 3] = source[index + 3]!;
        continue;
      }
      const normalized = distance / maxDist;
      const displacement = maxDisplacement * Math.pow(normalized, power);
      const directionX = dx / distance;
      const directionY = dy / distance;
      data[index] = sampleBilinear(source, width, height, x + directionX * displacement, y + directionY * displacement, 0);
      data[index + 1] = source[index + 1]!;
      data[index + 2] = sampleBilinear(source, width, height, x - directionX * displacement, y - directionY * displacement, 2);
      data[index + 3] = source[index + 3]!;
    }
  }
  putData(input, data);
}

export const chromaticAberrationEffect: EffectProcessor = defineEffect({
  name: "chromatic-aberration",
  params: {
    intensity: { default: 0.003, type: "number" },
    radial: { default: true, type: "boolean" },
    power: { default: 2, type: "number" },
  },
  process: (input, params) => {
    chromaticAberration(input, {
      intensity: params.intensity as number,
      radial: params.radial as boolean | undefined,
      power: params.power as number | undefined,
      center: params.center as ChromaticAberrationCenter | undefined,
      centerX: params.centerX as number | undefined,
      centerY: params.centerY as number | undefined,
    });
  },
});

registerEffect(chromaticAberrationEffect);
