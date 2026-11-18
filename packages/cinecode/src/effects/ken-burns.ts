import type { EffectInput, EffectProcessor } from "./engine.js";
import { defineEffect, getData, putData } from "./engine.js";
import { cubicBezier } from "../core/easing/curve.js";

export type KenBurnsInterpolation = "bilinear" | "bicubic";

export interface KenBurnsState {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface KenBurnsParams {
  readonly start?: KenBurnsState;
  readonly end?: KenBurnsState;
  readonly easing?: readonly [number, number, number, number] | "linear" | "ease-in" | "ease-out" | "ease-in-out";
  readonly preset?: string;
  readonly interpolation?: KenBurnsInterpolation;
  readonly progress?: number;
  readonly durationSeconds?: number;
}

export interface ResolvedKenBurns {
  readonly start: KenBurnsState;
  readonly end: KenBurnsState;
  readonly easing: readonly [number, number, number, number];
}

export const KEN_BURNS_PRESETS: Readonly<Record<string, { readonly start: KenBurnsState; readonly end: KenBurnsState }>> = {
  "zoom-in-center": {
    start: { x: 0.5, y: 0.5, zoom: 1 },
    end: { x: 0.5, y: 0.5, zoom: 1.8 },
  },
  "zoom-out-center": {
    start: { x: 0.5, y: 0.5, zoom: 1.8 },
    end: { x: 0.5, y: 0.5, zoom: 1 },
  },
  "pan-left-to-right": {
    start: { x: 0.15, y: 0.5, zoom: 1.25 },
    end: { x: 0.85, y: 0.5, zoom: 1.25 },
  },
  "pan-right-to-left": {
    start: { x: 0.85, y: 0.5, zoom: 1.25 },
    end: { x: 0.15, y: 0.5, zoom: 1.25 },
  },
  "drift-up": {
    start: { x: 0.5, y: 0.7, zoom: 1.2 },
    end: { x: 0.5, y: 0.3, zoom: 1.45 },
  },
  "diagonal-zoom": {
    start: { x: 0.2, y: 0.2, zoom: 1 },
    end: { x: 0.8, y: 0.8, zoom: 2 },
  },
};

const EASING_PRESETS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  linear: [0, 0, 1, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

export function resolveKenBurns(params: KenBurnsParams = {}): ResolvedKenBurns {
  const preset = params.preset ? KEN_BURNS_PRESETS[params.preset] : undefined;
  const easing = params.easing === undefined
    ? EASING_PRESETS["ease-in-out"]!
    : typeof params.easing === "string"
      ? EASING_PRESETS[params.easing] ?? EASING_PRESETS["ease-in-out"]!
      : params.easing;
  return {
    start: params.start ?? preset?.start ?? { x: 0.5, y: 0.5, zoom: 1 },
    end: params.end ?? preset?.end ?? { x: 0.5, y: 0.5, zoom: 1.4 },
    easing,
  };
}

export function evaluateKenBurns(params: KenBurnsParams, progress: number): KenBurnsState & { readonly eased: number } {
  const resolved = resolveKenBurns(params);
  const curve = cubicBezier(resolved.easing[0], resolved.easing[1], resolved.easing[2], resolved.easing[3]);
  const eased = curve(Math.max(0, Math.min(1, progress)));
  return {
    eased,
    x: resolved.start.x + (resolved.end.x - resolved.start.x) * eased,
    y: resolved.start.y + (resolved.end.y - resolved.start.y) * eased,
    zoom: resolved.start.zoom + (resolved.end.zoom - resolved.start.zoom) * eased,
  };
}

export interface KenBurnsViewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
}

export function kenBurnsViewport(
  state: KenBurnsState,
  sourceWidth: number,
  sourceHeight: number,
  outputAspect = sourceWidth / sourceHeight,
): KenBurnsViewport {
  const zoom = Math.max(1, state.zoom);
  const baseWidth = sourceWidth;
  const baseHeight = sourceHeight;
  const aspect = Math.max(0.0001, outputAspect);
  let cropWidth = baseWidth / zoom;
  let cropHeight = cropWidth / aspect;
  if (cropHeight > baseHeight) {
    cropHeight = baseHeight / zoom;
    cropWidth = cropHeight * aspect;
  }
  const focusX = Math.max(0, Math.min(1, state.x));
  const focusY = Math.max(0, Math.min(1, state.y));
  const centeredX = (focusX - 0.5) * (baseWidth - cropWidth);
  const centeredY = (focusY - 0.5) * (baseHeight - cropHeight);
  return {
    left: Math.max(0, Math.min(baseWidth - cropWidth, baseWidth / 2 + centeredX - cropWidth / 2)),
    top: Math.max(0, Math.min(baseHeight - cropHeight, baseHeight / 2 + centeredY - cropHeight / 2)),
    width: cropWidth,
    height: cropHeight,
    zoom,
  };
}

function sampleBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
): number {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const top = (data[(y0 * width + x0) * 4 + channel] ?? 0) * (1 - fx) + (data[(y0 * width + x1) * 4 + channel] ?? 0) * fx;
  const bottom = (data[(y1 * width + x0) * 4 + channel] ?? 0) * (1 - fx) + (data[(y1 * width + x1) * 4 + channel] ?? 0) * fx;
  return top * (1 - fy) + bottom * fy;
}

function cubicWeight(distance: number): number {
  const absolute = Math.abs(distance);
  if (absolute <= 1) return 1.5 * absolute ** 3 - 2.5 * absolute ** 2 + 1;
  if (absolute < 2) return -0.5 * absolute ** 3 + 2.5 * absolute ** 2 - 4 * absolute + 2;
  return 0;
}

function sampleBicubic(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
): number {
  const baseX = Math.floor(x);
  const baseY = Math.floor(y);
  let value = 0;
  let totalWeight = 0;
  for (let offsetY = -1; offsetY <= 2; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 2; offsetX += 1) {
      const sampleX = Math.max(0, Math.min(width - 1, baseX + offsetX));
      const sampleY = Math.max(0, Math.min(height - 1, baseY + offsetY));
      const weight = cubicWeight(x - (baseX + offsetX)) * cubicWeight(y - (baseY + offsetY));
      value += (data[(sampleY * width + sampleX) * 4 + channel] ?? 0) * weight;
      totalWeight += weight;
    }
  }
  return totalWeight > 0 ? value / totalWeight : 0;
}

export function applyKenBurns(input: EffectInput, params: KenBurnsParams = {}): void {
  const source = getData(input);
  const sourceCopy = new Uint8ClampedArray(source);
  const progress = params.progress ?? (params.durationSeconds && params.durationSeconds > 0 ? input.time / params.durationSeconds : input.time);
  const state = evaluateKenBurns(params, Math.max(0, Math.min(1, progress)));
  const viewport = kenBurnsViewport(state, input.width, input.height);
  const interpolation = params.interpolation ?? "bicubic";
  const output = source;

  for (let y = 0; y < input.height; y += 1) {
    const sourceY = viewport.top + ((y + 0.5) / input.height) * viewport.height;
    for (let x = 0; x < input.width; x += 1) {
      const sourceX = viewport.left + ((x + 0.5) / input.width) * viewport.width;
      const index = (y * input.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output[index + channel] = Math.max(0, Math.min(255, Math.round(
          interpolation === "bicubic"
            ? sampleBicubic(sourceCopy, input.width, input.height, sourceX, sourceY, channel)
            : sampleBilinear(sourceCopy, input.width, input.height, sourceX, sourceY, channel),
        )));
      }
    }
  }
  putData(input, output);
}

export const kenBurnsEffect: EffectProcessor = defineEffect({
  name: "ken-burns",
  params: {
    preset: { default: "zoom-in-center", type: "string" },
    interpolation: { default: "bicubic", type: "string" },
  },
  process: (input, params) => {
    applyKenBurns(input, {
      preset: params.preset as string | undefined,
      start: params.start as KenBurnsState | undefined,
      end: params.end as KenBurnsState | undefined,
      interpolation: params.interpolation as KenBurnsInterpolation | undefined,
      easing: params.easing as KenBurnsParams["easing"],
    });
  },
});

