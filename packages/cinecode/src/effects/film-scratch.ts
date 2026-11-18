import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { noise2d } from "../core/random/index.js";
import type { EffectInput, EffectProcessor } from "./engine.js";
import { defineEffect } from "./engine.js";
import { blendOverlayCanvas } from "./overlay.js";

export type FilmAgingLevel = "light" | "moderate" | "heavy";

export interface FilmScratchParams {
  readonly scratchDensity?: number;
  readonly dustDensity?: number;
  readonly scratchColor?: string;
  readonly aging?: FilmAgingLevel;
  readonly seed?: number;
  readonly fps?: number;
}

const AGING_MULTIPLIERS: Readonly<Record<FilmAgingLevel, number>> = {
  light: 0.4,
  moderate: 1,
  heavy: 2.1,
};

function hashUnit(seed: number, index: number, salt: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d) >>> 0;
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39) >>> 0;
  return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
}

function parseScratchColor(color: string): string {
  return color.trim().length > 0 ? color : "#ffffff";
}

export function generateFilmScratch(
  width: number,
  height: number,
  params: FilmScratchParams = {},
  time = 0,
): { readonly scratches: Canvas; readonly dust: Canvas } {
  const fps = Math.max(1, params.fps ?? 30);
  const frame = Math.floor(time * fps);
  const seed = params.seed ?? 11;
  const aging = AGING_MULTIPLIERS[params.aging ?? "moderate"];
  const scratchDensity = Math.max(0, Math.min(1, (params.scratchDensity ?? 0.3) * aging));
  const dustDensity = Math.max(0, Math.min(1, (params.dustDensity ?? 0.3) * aging));
  const scratchColor = parseScratchColor(params.scratchColor ?? "#ffffff");

  const scratchCanvas = createCanvas(width, height);
  const scratchCtx = scratchCanvas.getContext("2d");
  scratchCtx.strokeStyle = scratchColor;
  const scratchCount = Math.round(scratchDensity * 8);
  for (let index = 0; index < scratchCount; index += 1) {
    const period = 12 + Math.floor(hashUnit(seed, index, 1) * 40);
    const birth = Math.floor(hashUnit(seed, index, 2) * period);
    const lifetime = 1 + Math.floor(hashUnit(seed, index, 3) * 5);
    const age = ((frame - birth) % period + period) % period;
    if (age >= lifetime) continue;
    const x = hashUnit(seed, index, 4) * width;
    const thickness = 1 + hashUnit(seed, index, 5) * 2;
    const top = hashUnit(seed, index, 6) * height * 0.4;
    const length = height * (0.2 + hashUnit(seed, index, 7) * 0.8);
    const opacity = 0.25 + hashUnit(seed, index, 8) * 0.55;
    scratchCtx.globalAlpha = opacity;
    scratchCtx.lineWidth = thickness;
    scratchCtx.beginPath();
    const steps = 24;
    for (let step = 0; step <= steps; step += 1) {
      const y = top + (length * step) / steps;
      const wobble = noise2d(seed + index, y * 0.02, time * 0.5) * 2.5;
      if (step === 0) scratchCtx.moveTo(x + wobble, y);
      else scratchCtx.lineTo(x + wobble, y);
    }
    scratchCtx.stroke();
  }
  scratchCtx.globalAlpha = 1;

  const dustCanvas = createCanvas(width, height);
  const dustCtx = dustCanvas.getContext("2d");
  const dustCount = Math.round(dustDensity * 40);
  for (let index = 0; index < dustCount; index += 1) {
    const flicker = hashUnit(seed, index, 9);
    const flickerFrame = Math.floor(hashUnit(seed, index, 10) * 3);
    if ((frame + flickerFrame) % 3 !== 0) continue;
    const x = hashUnit(seed, index, 11) * width;
    const y = hashUnit(seed, index, 12) * height;
    const radius = 1 + hashUnit(seed, index, 13) * 3.5;
    dustCtx.fillStyle = `rgba(0, 0, 0, ${0.35 + flicker * 0.45})`;
    dustCtx.beginPath();
    dustCtx.arc(x, y, radius, 0, Math.PI * 2);
    dustCtx.fill();
  }

  return { scratches: scratchCanvas, dust: dustCanvas };
}

export function filmScratch(input: EffectInput, params: FilmScratchParams = {}): void {
  const generated = generateFilmScratch(input.width, input.height, { ...params, seed: params.seed ?? input.seed }, input.time);
  blendOverlayCanvas(input, generated.scratches, "screen", 0.9);
  blendOverlayCanvas(input, generated.dust, "multiply", 0.8);
}

export const filmScratchEffect: EffectProcessor = defineEffect({
  name: "film-scratch",
  params: {
    scratchDensity: { default: 0.3, type: "number" },
    dustDensity: { default: 0.3, type: "number" },
    scratchColor: { default: "#ffffff", type: "string" },
    aging: { default: "moderate", type: "string" },
    seed: { default: 11, type: "number" },
    fps: { default: 30, type: "number" },
  },
  process: (input, params) => {
    filmScratch(input, {
      scratchDensity: params.scratchDensity as number | undefined,
      dustDensity: params.dustDensity as number | undefined,
      scratchColor: params.scratchColor as string | undefined,
      aging: params.aging as FilmAgingLevel | undefined,
      seed: params.seed as number | undefined,
      fps: params.fps as number | undefined,
    });
  },
});

