import type { EffectProcessor } from "./engine.js";
import { registerEffect } from "../extensions/index.js";
import { getData, putData, type EffectInput } from "./engine.js";
import { parseColor } from "../renderer/color/parse.js";

export type VignetteMode = "radial" | "directional" | "asymmetric";
export type VignetteDirection = "top" | "bottom" | "left" | "right" | "top-bottom" | "all";
export type VignetteFalloff = "smooth" | "linear" | "sharp";

export interface VignetteParams {
  amount?: number;
  intensity?: number;
  softness?: number;
  offset?: number;
  color?: string;
  mode?: VignetteMode;
  direction?: VignetteDirection;
  spread?: number;
  ellipseWidth?: number;
  ellipseHeight?: number;
  centerX?: number;
  centerY?: number;
  falloff?: VignetteFalloff;
}

const vignetteMaskCache = new Map<string, Float32Array>();
const MASK_CACHE_MAX = 32;

interface MaskConfig {
  readonly width: number;
  readonly height: number;
  readonly amount: number;
  readonly softness: number;
  readonly offset: number;
  readonly color: readonly [number, number, number];
  readonly mode: VignetteMode;
  readonly direction: VignetteDirection;
  readonly spread: number;
  readonly ellipseWidth: number;
  readonly ellipseHeight: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly falloff: VignetteFalloff;
}

function falloffCurve(falloff: VignetteFalloff, t: number): number {
  const clamped = clamp01(t);
  switch (falloff) {
    case "linear":
      return clamped;
    case "sharp":
      return clamped * clamped * clamped;
    case "smooth":
    default:
      return clamped * clamped * (3 - 2 * clamped);
  }
}

function buildVignetteMask(config: MaskConfig): Float32Array {
  const { width, height, amount, softness, offset, color, mode, direction, spread, falloff } = config;
  const mask = new Float32Array(width * height * 4);
  const minSide = Math.min(width, height);
  const softnessFactor = Math.max(0.02, softness);
  const centerX = width / 2 + config.centerX * width;
  const centerY = height / 2 + config.centerY * height;
  const ellipseWidth = Math.max(0.05, config.ellipseWidth) * width * 0.5;
  const ellipseHeight = Math.max(0.05, config.ellipseHeight) * height * 0.5;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      let strength = 0;
      if (mode === "directional" && direction !== "all") {
        const horizontal = direction === "left" || direction === "right";
        const fromStart = direction === "left" || direction === "top";
        const coordinate = horizontal ? x / Math.max(1, width - 1) : y / Math.max(1, height - 1);
        const distanceFromEdge = fromStart ? coordinate : 1 - coordinate;
        const reach = Math.max(0.0001, spread);
        strength = falloffCurve(falloff, 1 - distanceFromEdge / reach);
        if (direction === "top-bottom") {
          const topDistance = y / Math.max(1, height - 1);
          const bottomDistance = 1 - topDistance;
          strength = falloffCurve(falloff, 1 - Math.min(topDistance, bottomDistance) / reach);
        }
      } else if (mode === "asymmetric") {
        const dx = (x - centerX) / Math.max(1, ellipseWidth);
        const dy = (y - centerY) / Math.max(1, ellipseHeight);
        const distance = Math.hypot(dx, dy);
        const inner = offset * 0.5;
        const outer = Math.max(inner + 1e-4, 0.5 + softnessFactor * 0.5);
        strength = falloffCurve(falloff, (distance - inner) / (outer - inner));
      } else {
        const distance = Math.hypot(x - centerX, y - centerY);
        const innerRadius = (offset * minSide) / 2;
        const outerRadius = Math.max(innerRadius + 1, (minSide / 2) * (1 + softnessFactor * 0.5));
        strength = falloffCurve(falloff, (distance - innerRadius) / (outerRadius - innerRadius));
      }
      const alpha = clamp01(strength) * amount;
      mask[index] = color[0];
      mask[index + 1] = color[1];
      mask[index + 2] = color[2];
      mask[index + 3] = alpha;
    }
  }
  return mask;
}

function getVignetteMask(config: MaskConfig): Float32Array {
  const key = [
    config.width, config.height, config.amount, config.softness, config.offset,
    config.color.join(","), config.mode, config.direction, config.spread,
    config.ellipseWidth, config.ellipseHeight, config.centerX, config.centerY, config.falloff,
  ].join(":");
  const cached = vignetteMaskCache.get(key);
  if (cached) return cached;
  const mask = buildVignetteMask(config);
  if (vignetteMaskCache.size >= MASK_CACHE_MAX) {
    const oldest = vignetteMaskCache.keys().next().value;
    if (oldest !== undefined) vignetteMaskCache.delete(oldest);
  }
  vignetteMaskCache.set(key, mask);
  return mask;
}

export function vignette(input: EffectInput, params: VignetteParams = {}): void {
  const amount = clamp01(params.intensity ?? params.amount ?? 0.4);
  const softness = clamp01(params.softness ?? 0.5);
  const offset = clamp01(params.offset ?? 0.5);
  const mode = params.mode ?? "radial";
  const direction = params.direction ?? "all";
  const spread = clamp01(params.spread ?? 0.5);
  const falloff = params.falloff ?? "smooth";
  let colorRgb: [number, number, number];
  try {
    const parsed = parseColor(params.color ?? "#000000");
    colorRgb = [parsed.r, parsed.g, parsed.b];
  } catch {
    colorRgb = [0, 0, 0];
  }
  const data = getData(input);
  const mask = getVignetteMask({
    width: input.width,
    height: input.height,
    amount,
    softness,
    offset,
    color: colorRgb,
    mode,
    direction,
    spread,
    ellipseWidth: params.ellipseWidth ?? 1,
    ellipseHeight: params.ellipseHeight ?? 1,
    centerX: params.centerX ?? 0,
    centerY: params.centerY ?? 0,
    falloff,
  });
  for (let i = 0; i < data.length; i += 4) {
    const alpha = mask[i + 3]!;
    if (alpha <= 0) continue;
    const inverse = 1 - alpha;
    data[i] = data[i]! * inverse + mask[i]! * alpha;
    data[i + 1] = data[i + 1]! * inverse + mask[i + 1]! * alpha;
    data[i + 2] = data[i + 2]! * inverse + mask[i + 2]! * alpha;
  }
  putData(input, data);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export const vignetteEffect: EffectProcessor = {
  name: "vignette",
  apply: (input, params) => {
    vignette(input, {
      amount: params.amount as number | undefined,
      intensity: params.intensity as number | undefined,
      softness: params.softness as number | undefined,
      offset: params.offset as number | undefined,
      color: params.color as string | undefined,
      mode: params.mode as VignetteMode | undefined,
      direction: params.direction as VignetteDirection | undefined,
      spread: params.spread as number | undefined,
      ellipseWidth: params.ellipseWidth as number | undefined,
      ellipseHeight: params.ellipseHeight as number | undefined,
      centerX: params.centerX as number | undefined,
      centerY: params.centerY as number | undefined,
      falloff: params.falloff as VignetteFalloff | undefined,
    });
  },
};

registerEffect(vignetteEffect);
