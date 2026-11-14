import { createCanvas, type Canvas } from "@napi-rs/canvas";
import type { EffectInput, EffectProcessor } from "./engine.js";
import { defineEffect } from "./engine.js";
import { registerEffect } from "../extensions/index.js";
import { noise2d } from "../core/random/index.js";
import { blendOverlayCanvas } from "./overlay.js";

export type LightLeakPreset = "anamorphic" | "vintage" | "prism" | "subtle" | "custom";

export interface LightLeakParams {
  readonly preset?: LightLeakPreset;
  readonly intensity?: number;
  readonly speed?: number;
  readonly seed?: number;
  readonly colors?: readonly string[];
}

const WARM_COLORS = ["255, 215, 0", "255, 140, 0", "255, 20, 147", "255, 107, 107"];

function anamorphic(ctx: ReturnType<Canvas["getContext"]>, width: number, height: number, time: number, seed: number, intensity: number): void {
  const drift = noise2d(seed, time * 0.4, 0) * height * 0.12;
  for (let band = 0; band < 3; band += 1) {
    const y = height * (0.25 + band * 0.22) + drift * (band + 1) * 0.4;
    const gradient = ctx.createLinearGradient(0, y, width, y + height * 0.06);
    const alpha = (0.45 - band * 0.09) * intensity;
    gradient.addColorStop(0, `rgba(70, 130, 255, 0)`);
    gradient.addColorStop(0.35, `rgba(90, 170, 255, ${alpha})`);
    gradient.addColorStop(0.6, `rgba(255, 170, 70, ${alpha})`);
    gradient.addColorStop(1, `rgba(255, 120, 40, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y - height * 0.04, width, height * 0.11);
  }
  const glow = ctx.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.6);
  glow.addColorStop(0, `rgba(255, 180, 90, ${0.12 * intensity})`);
  glow.addColorStop(1, "rgba(255, 180, 90, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
}

function vintage(ctx: ReturnType<Canvas["getContext"]>, width: number, height: number, time: number, seed: number, intensity: number): void {
  const corners = [
    { x: 0, y: 0, color: WARM_COLORS[1]! },
    { x: width, y: height * 0.2, color: WARM_COLORS[0]! },
    { x: width * 0.1, y: height, color: WARM_COLORS[3]! },
  ];
  for (let index = 0; index < corners.length; index += 1) {
    const corner = corners[index]!;
    const wobble = noise2d(seed + index * 11, time * 0.25, index) * width * 0.05;
    const gradient = ctx.createRadialGradient(corner.x + wobble, corner.y, 0, corner.x + wobble, corner.y, Math.max(width, height) * 0.7);
    gradient.addColorStop(0, `rgba(${corner.color}, ${0.55 * intensity})`);
    gradient.addColorStop(1, `rgba(${corner.color}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
}

function prism(ctx: ReturnType<Canvas["getContext"]>, width: number, height: number, time: number, seed: number, intensity: number): void {
  const originX = width * (0.1 + 0.1 * noise2d(seed, time * 0.2, 0));
  const originY = height * (0.1 + 0.1 * noise2d(seed, 0, time * 0.2));
  const rainbow = ["255, 80, 80", "255, 200, 80", "120, 255, 120", "80, 180, 255", "180, 100, 255"];
  for (let index = 0; index < rainbow.length; index += 1) {
    const angle = (index / rainbow.length) * Math.PI * 0.8 + 0.2;
    const endX = originX + Math.cos(angle) * width;
    const endY = originY + Math.sin(angle) * height;
    const gradient = ctx.createLinearGradient(originX, originY, endX, endY);
    gradient.addColorStop(0, `rgba(${rainbow[index]}, ${0.5 * intensity})`);
    gradient.addColorStop(1, `rgba(${rainbow[index]}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
}

function subtle(ctx: ReturnType<Canvas["getContext"]>, width: number, height: number, time: number, seed: number, intensity: number): void {
  const drift = noise2d(seed, time * 0.15, 0);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `rgba(255, 196, 120, ${0.18 * intensity * (0.7 + drift * 0.3)})`);
  gradient.addColorStop(0.6, `rgba(255, 160, 90, ${0.1 * intensity})`);
  gradient.addColorStop(1, `rgba(255, 220, 170, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function customLeak(ctx: ReturnType<Canvas["getContext"]>, width: number, height: number, time: number, seed: number, intensity: number, colors: readonly string[]): void {
  const count = Math.max(2, Math.min(5, colors.length));
  for (let index = 0; index < count; index += 1) {
    const x = width * (0.15 + 0.7 * noise2d(seed + index * 13, time * 0.3, index));
    const y = height * (0.15 + 0.7 * noise2d(seed + index * 29, index, time * 0.25));
    const radius = Math.max(width, height) * (0.3 + 0.5 * ((index % 3) + 1) / 3);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${colors[index % colors.length]}, ${0.5 * intensity})`);
    gradient.addColorStop(1, `rgba(${colors[index % colors.length]}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
}

export function generateLightLeak(
  width: number,
  height: number,
  params: LightLeakParams = {},
  time = 0,
): Canvas {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const preset = params.preset ?? "vintage";
  const intensity = Math.max(0, Math.min(1, params.intensity ?? 0.6));
  const speed = params.speed ?? 1;
  const seed = params.seed ?? 7;
  const animatedTime = time * speed;

  if (preset === "anamorphic") anamorphic(ctx, width, height, animatedTime, seed, intensity);
  else if (preset === "prism") prism(ctx, width, height, animatedTime, seed, intensity);
  else if (preset === "subtle") subtle(ctx, width, height, animatedTime, seed, intensity);
  else if (preset === "custom") customLeak(ctx, width, height, animatedTime, seed, intensity, params.colors ?? WARM_COLORS);
  else vintage(ctx, width, height, animatedTime, seed, intensity);

  return canvas;
}

export function lightLeak(input: EffectInput, params: LightLeakParams = {}): void {
  const leak = generateLightLeak(input.width, input.height, params, input.time);
  blendOverlayCanvas(input, leak, "screen", 1);
}

export const lightLeakEffect: EffectProcessor = defineEffect({
  name: "light-leak",
  params: {
    preset: { default: "vintage", type: "string" },
    intensity: { default: 0.6, type: "number" },
    speed: { default: 1, type: "number" },
    seed: { default: 7, type: "number" },
  },
  process: (input, params) => {
    lightLeak(input, {
      preset: params.preset as LightLeakPreset | undefined,
      intensity: params.intensity as number | undefined,
      speed: params.speed as number | undefined,
      seed: params.seed as number | undefined,
    });
  },
});

registerEffect(lightLeakEffect);
