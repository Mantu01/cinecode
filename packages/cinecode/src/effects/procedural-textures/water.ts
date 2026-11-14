import type { Canvas } from "@napi-rs/canvas";
import { createTextureCanvas, fbm, hexToRgb } from "./common.js";

export interface WaterTextureParams {
  readonly scale?: number;
  readonly speed?: number;
  readonly brightness?: number;
  readonly colorTint?: string;
  readonly depth?: number;
  readonly seed?: number;
  readonly time?: number;
}

function causticField(seed: number, x: number, y: number, octaves: number): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let normalisation = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const cellX = Math.round(x * frequency);
    const cellY = Math.round(y * frequency);
    let nearest = Number.POSITIVE_INFINITY;
    let secondNearest = Number.POSITIVE_INFINITY;
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const pointX = cellX + offsetX;
        const pointY = cellY + offsetY;
        const jitterX = fbm(seed + octave * 97, pointX * 0.35, pointY * 0.35, 2);
        const jitterY = fbm(seed + octave * 97 + 41, pointX * 0.35, pointY * 0.35, 2);
        const distance = Math.hypot(x * frequency - pointX - jitterX, y * frequency - pointY - jitterY);
        if (distance < nearest) {
          secondNearest = nearest;
          nearest = distance;
        } else if (distance < secondNearest) {
          secondNearest = distance;
        }
      }
    }
    value += (secondNearest - nearest) * amplitude;
    normalisation += amplitude;
    amplitude *= 0.55;
    frequency *= 2.1;
  }
  return normalisation > 0 ? value / normalisation : 0;
}

export function generateWaterTexture(width: number, height: number, params: WaterTextureParams = {}): Canvas {
  const tint = hexToRgb(params.colorTint ?? "#5fa8c9", { r: 95, g: 168, b: 201 });
  const scale = params.scale ?? 0.018;
  const speed = params.speed ?? 0.5;
  const brightness = params.brightness ?? 1;
  const depth = Math.max(0, Math.min(1, params.depth ?? 0.4));
  const seed = params.seed ?? 23;
  const time = (params.time ?? 0) * speed;
  const octaves = Math.max(1, Math.round(2 + depth * 2));

  return createTextureCanvas(width, height, (x, y) => {
    const driftingX = x * scale + time * 0.3;
    const driftingY = y * scale + time * 0.22;
    const firstLayer = causticField(seed, driftingX, driftingY, octaves);
    const secondLayer = causticField(seed + 53, driftingX * 1.7 + 11, driftingY * 1.7 - 7, octaves);
    const blend = Math.min(firstLayer, secondLayer);
    const caustic = Math.pow(Math.max(0, 1 - blend * 2.6), 2.2) * brightness;
    const diffusion = 1 - depth * 0.45;
    const baseLevel = 0.55 * diffusion;
    const value = baseLevel + caustic * 0.75;
    return {
      r: Math.min(255, tint.r * value + caustic * 70),
      g: Math.min(255, tint.g * value + caustic * 80),
      b: Math.min(255, tint.b * value + caustic * 95),
    };
  });
}
