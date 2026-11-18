import type { EffectInput, EffectProcessor } from "./engine.js";
import { defineEffect, getData, putData } from "./engine.js";
import { deriveSeed } from "../core/random/index.js";

export type FilmGrainType = "monochrome" | "color" | "highlight-weighted";

export interface FilmGrainParams {
  amount?: number;
  intensity?: number;
  size?: number;
  type?: FilmGrainType;
  seed?: number;
  speed?: number;
  fps?: number;
  octaves?: number;
  temporalCoherence?: number;
}

const GRAIN_FRAME_PRIME = 2654435761;

function mix32(value: number): number {
  let state = value >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x21f0aaad) >>> 0;
  state = Math.imul(state ^ (state >>> 15), 0x735a2d97) >>> 0;
  return (state ^ (state >>> 15)) >>> 0;
}

function nextRandom(state: { value: number }): number {
  state.value = (state.value + 0x9e3779b9) >>> 0;
  let t = state.value;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
  return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
}

function highlightWeight(luminance: number): number {
  const centered = luminance - 0.5;
  return Math.max(0.05, 1 - 4 * centered * centered);
}

export function filmGrain(input: EffectInput, params: FilmGrainParams): void {
  const data = getData(input);
  const { width, height } = input;
  const intensity = Math.max(0, Math.min(1, params.intensity ?? params.amount ?? 0.3));
  const size = Math.max(1, Math.min(4, Math.round(params.size ?? 1)));
  const type = params.type ?? "monochrome";
  const speed = params.speed ?? 1;
  const fps = Math.max(1, params.fps ?? 30);
  const baseSeed = deriveSeed(input.seed, ["effect", "film-grain", params.seed ?? 0]);
  const frameNumber = Math.floor(input.time * fps * speed);
  const frameSeed = (baseSeed ^ Math.imul(frameNumber, GRAIN_FRAME_PRIME)) >>> 0;
  const amplitude = intensity * 255;
  const columns = Math.ceil(width / size);
  const rows = Math.ceil(height / size);
  const noiseState = { value: mix32(frameSeed) };

  for (let blockY = 0; blockY < rows; blockY += 1) {
    for (let blockX = 0; blockX < columns; blockX += 1) {
      const monochromeNoise = (nextRandom(noiseState) - 0.5) * 2;
      const redNoise = type === "color" ? (nextRandom(noiseState) - 0.5) * 2 : monochromeNoise;
      const greenNoise = type === "color" ? (nextRandom(noiseState) - 0.5) * 2 : monochromeNoise;
      const blueNoise = type === "color" ? (nextRandom(noiseState) - 0.5) * 2 : monochromeNoise;
      const startX = blockX * size;
      const startY = blockY * size;
      for (let y = startY; y < Math.min(height, startY + size); y += 1) {
        for (let x = startX; x < Math.min(width, startX + size); x += 1) {
          const index = (y * width + x) * 4;
          const r = data[index] ?? 0;
          const g = data[index + 1] ?? 0;
          const b = data[index + 2] ?? 0;
          const weight = type === "highlight-weighted"
            ? highlightWeight((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255)
            : 1;
          data[index] = clampByte(r + redNoise * amplitude * weight);
          data[index + 1] = clampByte(g + greenNoise * amplitude * weight);
          data[index + 2] = clampByte(b + blueNoise * amplitude * weight);
        }
      }
    }
  }
  putData(input, data);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export const filmGrainEffect: EffectProcessor = defineEffect({
  name: "film-grain",
  params: {
    amount: { default: 0.3, type: "number" },
    intensity: { default: 0.3, type: "number" },
    size: { default: 1, type: "number" },
    type: { default: "monochrome", type: "string" },
    seed: { default: 0, type: "number" },
    speed: { default: 1, type: "number" },
    fps: { default: 30, type: "number" },
  },
  process: (input, params) => {
    filmGrain(input, {
      amount: params.amount as number | undefined,
      intensity: params.intensity as number | undefined,
      size: params.size as number | undefined,
      type: params.type as FilmGrainType | undefined,
      seed: params.seed as number | undefined,
      speed: params.speed as number | undefined,
      fps: params.fps as number | undefined,
    });
  },
});

