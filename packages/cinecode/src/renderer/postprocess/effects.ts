import type { EffectInput, EffectProcessor } from "../../effects/engine.js";
import { defineEffect, getData, putData } from "../../effects/engine.js";
import { registerEffect } from "../../extensions/index.js";
import { vignetteEffect } from "../../effects/vignette.js";
import { colorGradingEffect } from "../../effects/color-grading.js";
import { filmGrainEffect } from "../../effects/film-grain.js";

export interface BulgeParams {
  readonly strength?: number;
  readonly radius?: number;
  readonly centerX?: number;
  readonly centerY?: number;
}

export function bulge(input: EffectInput, params: BulgeParams = {}): void {
  const { width, height } = input;
  const strength = params.strength ?? 0.35;
  const radius = params.radius ?? 0.6;
  const centerX = (params.centerX ?? 0.5) * width;
  const centerY = (params.centerY ?? 0.5) * height;
  const maxDistance = Math.hypot(width, height) * radius;
  const source = getData(input);
  const target = new Uint8ClampedArray(source);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.hypot(dx, dy);
      if (distance > maxDistance || distance === 0) continue;
      const normalized = distance / maxDistance;
      const falloff = Math.pow(1 - normalized, 2);
      const scale = 1 - strength * falloff;
      const sourceX = Math.min(width - 1, Math.max(0, Math.round(centerX + dx * scale)));
      const sourceY = Math.min(height - 1, Math.max(0, Math.round(centerY + dy * scale)));
      const sourceIndex = (sourceY * width + sourceX) * 4;
      const targetIndex = (y * width + x) * 4;
      target[targetIndex] = source[sourceIndex]!;
      target[targetIndex + 1] = source[sourceIndex + 1]!;
      target[targetIndex + 2] = source[sourceIndex + 2]!;
      target[targetIndex + 3] = source[sourceIndex + 3]!;
    }
  }
  putData(input, target);
}

export const bulgeEffect: EffectProcessor = defineEffect({
  name: "bulge",
  params: {
    strength: { default: 0.35, type: "number" },
    radius: { default: 0.6, type: "number" },
    centerX: { default: 0.5, type: "number" },
    centerY: { default: 0.5, type: "number" },
  },
  process: (input, params) => {
    bulge(input, {
      strength: params.strength as number,
      radius: params.radius as number,
      centerX: params.centerX as number,
      centerY: params.centerY as number,
    });
  },
});

registerEffect(bulgeEffect);

export const GLOBAL_POST_PROCESS_EFFECTS: readonly EffectProcessor[] = [
  vignetteEffect,
  colorGradingEffect,
  filmGrainEffect,
  bulgeEffect,
];
