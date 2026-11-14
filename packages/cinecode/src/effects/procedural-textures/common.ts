import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { noise2d, random } from "../../core/random/index.js";

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function hexToRgb(value: string, fallback: Rgb = { r: 255, g: 255, b: 255 }): Rgb {
  const trimmed = value.trim().replace(/^#/, "");
  if (trimmed.length === 3) {
    return {
      r: Number.parseInt(trimmed[0]! + trimmed[0]!, 16),
      g: Number.parseInt(trimmed[1]! + trimmed[1]!, 16),
      b: Number.parseInt(trimmed[2]! + trimmed[2]!, 16),
    };
  }
  if (trimmed.length === 6) {
    const r = Number.parseInt(trimmed.slice(0, 2), 16);
    const g = Number.parseInt(trimmed.slice(2, 4), 16);
    const b = Number.parseInt(trimmed.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
  }
  return fallback;
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const amount = Math.max(0, Math.min(1, t));
  return {
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  };
}

export function fbm(seed: number, x: number, y: number, octaves = 4, persistence = 0.5, lacunarity = 2): number {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let normalisation = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += noise2d(seed + octave * 1013, x * frequency, y * frequency) * amplitude;
    normalisation += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return normalisation > 0 ? total / normalisation : 0;
}

export function turbulence(seed: number, x: number, y: number, octaves = 5): number {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let normalisation = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += Math.abs(noise2d(seed + octave * 733, x * frequency, y * frequency) - 0.5) * 2 * amplitude;
    normalisation += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return normalisation > 0 ? total / normalisation : 0;
}

export function createTextureCanvas(width: number, height: number, fill: (x: number, y: number) => Rgb): Canvas {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = fill(x, y);
      const index = (y * width + x) * 4;
      image.data[index] = Math.max(0, Math.min(255, Math.round(color.r)));
      image.data[index + 1] = Math.max(0, Math.min(255, Math.round(color.g)));
      image.data[index + 2] = Math.max(0, Math.min(255, Math.round(color.b)));
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function seededRandom(seed: number) {
  return random(seed >>> 0);
}

export function fractional(value: number): number {
  return value - Math.floor(value);
}
