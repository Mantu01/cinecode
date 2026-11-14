import { Canvas } from "@napi-rs/canvas";
import type { SKRSContext2D, ImageData } from "@napi-rs/canvas";
import { random } from "../core/random/index.js";
import { createHash } from "node:crypto";

/** Pool of temporary canvases for effect processing. Prevents repeated allocations. */
const tempCanvasPool = new Map<string, Canvas>();

export function getTempCanvas(width: number, height: number): Canvas {
  const key = `${width}x${height}`;
  let canvas = tempCanvasPool.get(key);
  if (!canvas) {
    canvas = new Canvas(width, height);
    tempCanvasPool.set(key, canvas);
  }
  return canvas;
}

/** Fast canvas fingerprint: samples 16 pixels (4x4 grid) for an 8-char hash. */
function fastCanvasHash(canvas: Canvas): string {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const stepX = Math.max(1, Math.floor(w / 4));
  const stepY = Math.max(1, Math.floor(h / 4));
  let hashInput = Buffer.alloc(0);
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const x = Math.min(sx * stepX, w - 1);
      const y = Math.min(sy * stepY, h - 1);
      const pixel = ctx.getImageData(x, y, 1, 1).data;
      hashInput = Buffer.concat([hashInput, Buffer.from([pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!])]);
    }
  }
  return createHash("md5").update(hashInput).digest("hex").slice(0, 8);
}

const effectCache = new Map<string, Canvas>();
const EFFECT_CACHE_MAX = 2048;

export function clearEffectCache(): void {
  effectCache.clear();
}

/**
 * Caches expensive effect results keyed by input canvas hash + effect name + params.
 * Avoids recomputation when the same frame is processed multiple times.
 */
export function applyCachedEffect(
  input: EffectInput,
  effectName: string,
  params: Record<string, unknown>,
  processor: (input: EffectInput, params: Record<string, unknown>) => void,
): void {
  const hash = fastCanvasHash(input.canvas);
  const key = `${hash}:${effectName}:${JSON.stringify(params)}`;
  const cached = effectCache.get(key);
  if (cached) {
    input.ctx.drawImage(cached, 0, 0);
    return;
  }

  processor(input, params);

  if (effectCache.size >= EFFECT_CACHE_MAX) {
    const oldest = effectCache.keys().next().value;
    if (oldest) effectCache.delete(oldest);
  }
  const copy = new (input.canvas.constructor as new(w: number, h: number) => Canvas)(input.width, input.height);
  copy.getContext("2d").drawImage(input.canvas, 0, 0);
  effectCache.set(key, copy);
}

export interface EffectInput {
  readonly canvas: Canvas;
  readonly ctx: SKRSContext2D;
  readonly width: number;
  readonly height: number;
  readonly time: number;
  readonly seed: number;
}

export interface EffectProcessor {
  readonly name: string;
  readonly apply: (input: EffectInput, params: Record<string, unknown>) => void;
}

export interface EffectDefinition {
  readonly name: string;
  readonly params: Record<string, { default: unknown; type: "number" | "color" | "boolean" | "string" }>;
  readonly process: (input: EffectInput, params: Record<string, unknown>) => void;
}

export function defineEffect(def: EffectDefinition): EffectProcessor {
  return { name: def.name, apply: def.process };
}

export function createEffectInput(
  canvas: Canvas,
  ctx: SKRSContext2D,
  time: number,
  seed: number,
): EffectInput {
  return {
    canvas,
    ctx,
    width: canvas.width,
    height: canvas.height,
    time,
    seed,
  };
}

export function getImageData(input: EffectInput): ImageData {
  return input.ctx.getImageData(0, 0, input.width, input.height);
}

export function putImageData(input: EffectInput, data: ImageData): void {
  input.ctx.putImageData(data, 0, 0);
}

export function getData(input: EffectInput): Uint8ClampedArray {
  const imageData = input.ctx.getImageData(0, 0, input.width, input.height);
  return imageData.data;
}

export function putData(input: EffectInput, data: Uint8ClampedArray): void {
  const imageData = input.ctx.getImageData(0, 0, input.width, input.height);
  imageData.data.set(data);
  input.ctx.putImageData(imageData, 0, 0);
}

function getR(data: Uint8ClampedArray, idx: number): number { return data[idx]!; }
function getG(data: Uint8ClampedArray, idx: number): number { return data[idx + 1]!; }
function getB(data: Uint8ClampedArray, idx: number): number { return data[idx + 2]!; }
function getA(data: Uint8ClampedArray, idx: number): number { return data[idx + 3]!; }

function setPixel(data: Uint8ClampedArray, idx: number, r: number, g: number, b: number, a: number): void {
  if (idx + 3 < data.length) {
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = a;
  }
}

export function gaussianBlur(input: EffectInput, radius: number): void {
  const { width, height } = input;
  if (radius <= 60 && width > 0 && height > 0) {
    const tmp = getTempCanvas(width, height);
    const tmpCtx = tmp.getContext("2d");
    tmpCtx.filter = `blur(${radius}px)`;
    tmpCtx.drawImage(input.canvas, 0, 0);
    input.ctx.drawImage(tmp, 0, 0);
    return;
  }

  const data = getData(input);
  const temp = new Uint8ClampedArray(data.length);
  const sigma = radius / 3;
  const kernelSize = Math.ceil(radius * 2) | 1;
  const half = Math.floor(kernelSize / 2);
  const weights = new Float32Array(kernelSize);
  let sum = 0;
  for (let i = 0; i < kernelSize; i++) {
    const x = i - half;
    weights[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += weights[i]!;
  }
  for (let i = 0; i < kernelSize; i++) weights[i]! /= sum;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < kernelSize; k++) {
        const xi = Math.max(0, Math.min(width - 1, x + k - half));
        const idx = (y * width + xi) * 4;
        r += getR(data, idx) * weights[k]!;
        g += getG(data, idx) * weights[k]!;
        b += getB(data, idx) * weights[k]!;
        a += getA(data, idx) * weights[k]!;
      }
      const idx = (y * width + x) * 4;
      setPixel(temp, idx, r, g, b, a);
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < kernelSize; k++) {
        const yi = Math.max(0, Math.min(height - 1, y + k - half));
        const idx = (yi * width + x) * 4;
        r += getR(temp, idx) * weights[k]!;
        g += getG(temp, idx) * weights[k]!;
        b += getB(temp, idx) * weights[k]!;
        a += getA(temp, idx) * weights[k]!;
      }
      const idx = (y * width + x) * 4;
      setPixel(data, idx, r, g, b, a);
    }
  }
  putData(input, data);
}

export function brightness(input: EffectInput, amount: number): void {
  const data = getData(input);
  for (let i = 0; i < data.length; i += 4) {
    const r = getR(data, i);
    const g = getG(data, i);
    const b = getB(data, i);
    const a = getA(data, i);
    setPixel(data, i, Math.min(255, r * (1 + amount)), Math.min(255, g * (1 + amount)), Math.min(255, b * (1 + amount)), a);
  }
  putData(input, data);
}

export function contrast(input: EffectInput, amount: number): void {
  const data = getData(input);
  const factor = (259 * (amount * 255 + 255)) / (255 * (259 - amount * 255));
  for (let i = 0; i < data.length; i += 4) {
    const r = getR(data, i);
    const g = getG(data, i);
    const b = getB(data, i);
    const a = getA(data, i);
    setPixel(data, i, Math.max(0, Math.min(255, factor * (r - 128) + 128)), Math.max(0, Math.min(255, factor * (g - 128) + 128)), Math.max(0, Math.min(255, factor * (b - 128) + 128)), a);
  }
  putData(input, data);
}

export function saturation(input: EffectInput, amount: number): void {
  const data = getData(input);
  for (let i = 0; i < data.length; i += 4) {
    const r = getR(data, i);
    const g = getG(data, i);
    const b = getB(data, i);
    const a = getA(data, i);
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    setPixel(data, i, gray + amount * (r - gray), gray + amount * (g - gray), gray + amount * (b - gray), a);
  }
  putData(input, data);
}

export function hueRotate(input: EffectInput, degrees: number): void {
  const data = getData(input);
  const cos = Math.cos((degrees * Math.PI) / 180);
  const sin = Math.sin((degrees * Math.PI) / 180);
  const lumR = 0.213 + cos * 0.787 - sin * 0.213;
  const lumG = 0.715 - cos * 0.715 - sin * 0.715;
  const lumB = 0.072 - cos * 0.072 + sin * 0.928;
  for (let i = 0; i < data.length; i += 4) {
    const r = getR(data, i);
    const g = getG(data, i);
    const b = getB(data, i);
    const a = getA(data, i);
    setPixel(data, i,
      Math.max(0, Math.min(255, r * lumR + g * lumG + b * lumB)),
      Math.max(0, Math.min(255, r * (0.213 - cos * 0.213 + sin * 0.143) + g * (0.715 + cos * 0.285 + sin * 0.14) + b * (0.072 - cos * 0.072 - sin * 0.283))),
      Math.max(0, Math.min(255, r * (0.213 - cos * 0.213 - sin * 0.787) + g * (0.715 - cos * 0.715 + sin * 0.715) + b * (0.072 + cos * 0.928 + sin * 0.072))),
      a
    );
  }
  putData(input, data);
}

export function noise(input: EffectInput, amount: number): void {
  const data = getData(input);
  const rng = random(input.seed);
  for (let i = 0; i < data.length; i += 4) {
    const n = rng.next() * 2 - 1;
    const r = getR(data, i);
    const g = getG(data, i);
    const b = getB(data, i);
    const a = getA(data, i);
    setPixel(data, i, Math.max(0, Math.min(255, r + n * amount * 255)), Math.max(0, Math.min(255, g + n * amount * 255)), Math.max(0, Math.min(255, b + n * amount * 255)), a);
  }
  putData(input, data);
}

export const BUILTIN_EFFECTS: EffectProcessor[] = [
  defineEffect({
    name: "blur",
    params: { radius: { default: 5, type: "number" } },
    process: (input, params) => gaussianBlur(input, params.radius as number),
  }),
  defineEffect({
    name: "brightness",
    params: { amount: { default: 0, type: "number" } },
    process: (input, params) => brightness(input, params.amount as number),
  }),
  defineEffect({
    name: "contrast",
    params: { amount: { default: 0, type: "number" } },
    process: (input, params) => contrast(input, params.amount as number),
  }),
  defineEffect({
    name: "saturation",
    params: { amount: { default: 1, type: "number" } },
    process: (input, params) => saturation(input, params.amount as number),
  }),
  defineEffect({
    name: "hue-rotate",
    params: { degrees: { default: 0, type: "number" } },
    process: (input, params) => hueRotate(input, params.degrees as number),
  }),
  defineEffect({
    name: "noise",
    params: { amount: { default: 0.1, type: "number" } },
    process: (input, params) => noise(input, params.amount as number),
  }),
];
