import { createSimplex3, simplex3 } from "./simplex.js";
import { createPerlin3, perlin3 } from "./perlin.js";
import { createValue3, value3 } from "./value.js";
import { createCanvas, createContext } from "../renderer/composite/engine.js";
import type { Canvas } from "@napi-rs/canvas";
import type { NoiseClip } from "../core/types/clips.js";

export type NoiseKind = NoiseClip["params"]["kind"];
export type NoiseOutputType = NonNullable<NoiseClip["params"]["outputType"]>;

export interface NoiseTextureParams {
  readonly kind: NoiseKind;
  readonly dimensions: 2 | 3;
  readonly scale: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly animationSpeed?: number;
  readonly seed?: number;
  readonly outputType?: NoiseOutputType;
  readonly time?: number;
}

type NoiseFunction = (x: number, y: number, z: number) => number;

const noiseFunctionCache = new Map<string, NoiseFunction>();

export function noiseFunction(kind: NoiseKind, seed: number): NoiseFunction {
  const key = `${kind}:${seed}`;
  let fn = noiseFunctionCache.get(key);
  if (fn === undefined) {
    switch (kind) {
      case "simplex":
        fn = seed === 0 ? simplex3 : createSimplex3(seed);
        break;
      case "perlin":
        fn = seed === 0 ? perlin3 : createPerlin3(seed);
        break;
      case "value":
        fn = seed === 0 ? value3 : createValue3(seed);
        break;
      default:
        fn = simplex3;
    }
    noiseFunctionCache.set(key, fn);
  }
  return fn;
}

export function sampleNoiseAt(nx: number, ny: number, nz: number, kind: NoiseKind, seed: number): number {
  return noiseFunction(kind, seed)(nx, ny, nz);
}

export function generateNoiseTexture(width: number, height: number, params: NoiseTextureParams): Canvas {
  const canvas = createCanvas(width, height);
  const ctx = createContext(canvas);
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const scale = params.scale > 0 ? params.scale : 1;
  const offsetX = params.offsetX ?? 0;
  const offsetY = params.offsetY ?? 0;
  const z = (params.time ?? 0) * (params.animationSpeed ?? 0);
  const outputType = params.outputType ?? "luminance";
  const noise = noiseFunction(params.kind, params.seed ?? 0);
  const dimensions = params.dimensions;
  const sampleZ = dimensions === 2 ? 0 : z;

  for (let y = 0; y < height; y += 1) {
    const ny = y / scale + offsetY;
    for (let x = 0; x < width; x += 1) {
      const nx = x / scale + offsetX;
      const index = (y * width + x) * 4;
      if (outputType === "luminance") {
        const level = Math.round(clamp01((noise(nx, ny, sampleZ) + 1) / 2) * 255);
        data[index] = level;
        data[index + 1] = level;
        data[index + 2] = level;
        data[index + 3] = 255;
      } else {
        const r = clamp01((noise(nx, ny, sampleZ) + 1) / 2);
        const g = clamp01((noise(nx + 128.5, ny, sampleZ) + 1) / 2);
        const b = clamp01((noise(nx, ny + 128.5, sampleZ) + 1) / 2);
        data[index] = Math.round(r * 255);
        data[index + 1] = Math.round(g * 255);
        data[index + 2] = Math.round(b * 255);
        data[index + 3] = outputType === "rgba" ? Math.round(clamp01((noise(nx, ny, sampleZ + 256.5) + 1) / 2) * 255) : 255;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
