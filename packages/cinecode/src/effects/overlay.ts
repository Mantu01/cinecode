import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import { readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { EffectInput, EffectProcessor } from "./engine.js";
import { defineEffect, getData, putData } from "./engine.js";
import { registerEffect } from "../extensions/index.js";
import { noise2d } from "../core/random/index.js";

export type OverlayBlendMode = "screen" | "add" | "multiply" | "overlay" | "soft-light" | "color-dodge";

export interface OverlayParams {
  readonly source?: string;
  readonly blendMode?: OverlayBlendMode;
  readonly opacity?: number;
  readonly position?: { readonly x: number; readonly y: number };
  readonly scale?: number;
  readonly rotation?: number;
  readonly animate?: boolean;
  readonly fps?: number;
  readonly frameOffset?: number;
  readonly seed?: number;
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".bmp"]);

const overlayCache = new Map<string, Canvas[]>();
const warnedSources = new Set<string>();

export function clearOverlayCache(): void {
  overlayCache.clear();
  warnedSources.clear();
}

export async function preloadOverlay(source: string): Promise<readonly Canvas[]> {
  const cached = overlayCache.get(source);
  if (cached) return cached;
  const absolute = resolve(source);
  const info = await stat(absolute);
  const files = info.isDirectory()
    ? (await readdir(absolute))
        .filter((file) => IMAGE_EXTENSIONS.has(extname(file).toLowerCase()))
        .sort()
        .map((file) => join(absolute, file))
    : [absolute];
  const canvases: Canvas[] = [];
  for (const file of files) {
    const image = await loadImage(file);
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext("2d").drawImage(image, 0, 0);
    canvases.push(canvas);
  }
  overlayCache.set(source, canvases);
  return canvases;
}

export function registerOverlayFrames(source: string, frames: readonly Canvas[]): void {
  overlayCache.set(source, [...frames]);
}

function blendChannel(base: number, overlay: number, mode: OverlayBlendMode): number {
  switch (mode) {
    case "screen":
      return 1 - (1 - base) * (1 - overlay);
    case "add":
      return Math.min(1, base + overlay);
    case "multiply":
      return base * overlay;
    case "color-dodge":
      return overlay >= 1 ? 1 : Math.min(1, base / (1 - overlay));
    case "soft-light":
      return overlay <= 0.5
        ? base - (1 - 2 * overlay) * base * (1 - base)
        : base + (2 * overlay - 1) * ((base <= 0.25 ? ((16 * base - 12) * base + 4) * base : Math.sqrt(base)) - base);
    default:
      return base <= 0.5
        ? 2 * base * overlay
        : 1 - 2 * (1 - base) * (1 - overlay);
  }
}

function createProceduralOverlay(kind: string, width: number, height: number, time: number, seed: number): Canvas {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (kind.includes("streak")) {
    const gradient = ctx.createLinearGradient(0, height * 0.3, width, height * 0.7);
    gradient.addColorStop(0, "rgba(255, 140, 60, 0)");
    gradient.addColorStop(0.45, "rgba(255, 170, 90, 0.55)");
    gradient.addColorStop(0.55, "rgba(120, 190, 255, 0.45)");
    gradient.addColorStop(1, "rgba(80, 120, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    return canvas;
  }
  for (let spot = 0; spot < 4; spot += 1) {
    const drift = noise2d(seed + spot * 17, time * 0.3 + spot, spot * 1.7);
    const centerX = width * (0.2 + 0.6 * ((spot + 1) / 5)) + drift * width * 0.1;
    const centerY = height * (0.25 + 0.5 * noise2d(seed + spot * 31, time * 0.2, spot));
    const radius = Math.max(width, height) * (0.25 + 0.3 * ((spot % 3) + 1) / 3);
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    const palette = ["255, 215, 0", "255, 140, 0", "255, 20, 147", "255, 107, 107"];
    gradient.addColorStop(0, `rgba(${palette[spot % palette.length]}, 0.5)`);
    gradient.addColorStop(1, `rgba(${palette[spot % palette.length]}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  return canvas;
}

function resolveSourceCanvas(
  input: EffectInput,
  params: OverlayParams,
): Canvas | null {
  const source = params.source;
  if (!source) return null;
  if (source.startsWith("procedural")) {
    const kind = source.includes(":") ? source.split(":")[1] ?? "glow" : "glow";
    return createProceduralOverlay(kind, input.width, input.height, input.time, params.seed ?? input.seed);
  }
  const frames = overlayCache.get(source);
  if (!frames || frames.length === 0) {
    if (!warnedSources.has(source)) {
      warnedSources.add(source);
      console.warn(`CC6101: Overlay source not preloaded: ${source}. Call preloadOverlay() before rendering.`);
    }
    return null;
  }
  const animate = params.animate ?? true;
  const fps = Math.max(1, params.fps ?? 30);
  const frameIndex = animate
    ? Math.floor(input.time * fps + (params.frameOffset ?? 0)) % frames.length
    : 0;
  return frames[frameIndex] ?? frames[0] ?? null;
}

export function blendOverlayCanvas(
  input: EffectInput,
  source: Canvas,
  mode: OverlayBlendMode = "screen",
  opacity = 0.5,
  position?: { readonly x: number; readonly y: number },
  scale = 1,
  rotationDegrees = 0,
): void {
  const stage = createCanvas(input.width, input.height);
  const stageContext = stage.getContext("2d");
  const rotation = (rotationDegrees * Math.PI) / 180;
  const offsetX = (position?.x ?? 0) * input.width;
  const offsetY = (position?.y ?? 0) * input.height;
  stageContext.save();
  stageContext.translate(input.width / 2 + offsetX, input.height / 2 + offsetY);
  stageContext.rotate(rotation);
  stageContext.drawImage(source, (-input.width * scale) / 2, (-input.height * scale) / 2, input.width * scale, input.height * scale);
  stageContext.restore();

  const base = getData(input);
  const layer = stageContext.getImageData(0, 0, input.width, input.height).data;
  const clampedOpacity = Math.max(0, Math.min(1, opacity));

  for (let index = 0; index < base.length; index += 4) {
    const alpha = (layer[index + 3] ?? 0) / 255;
    if (alpha <= 0) continue;
    const strength = clampedOpacity * alpha;
    for (let channel = 0; channel < 3; channel += 1) {
      const baseValue = (base[index + channel] ?? 0) / 255;
      const overlayValue = (layer[index + channel] ?? 0) / 255;
      const blended = blendChannel(baseValue, overlayValue, mode);
      base[index + channel] = Math.max(0, Math.min(255, Math.round((baseValue + (blended - baseValue) * strength) * 255)));
    }
  }
  putData(input, base);
}

export function applyOverlay(input: EffectInput, params: OverlayParams, frames?: readonly Canvas[]): void {
  const source = frames && frames.length > 0
    ? frames[Math.floor(input.time * Math.max(1, params.fps ?? 30)) % frames.length]
    : resolveSourceCanvas(input, params);
  if (!source) return;
  blendOverlayCanvas(
    input,
    source,
    params.blendMode ?? "screen",
    params.opacity ?? 0.5,
    params.position,
    params.scale ?? 1,
    params.rotation ?? 0,
  );
}

export const overlayEffect: EffectProcessor = defineEffect({
  name: "overlay",
  params: {
    source: { default: "", type: "string" },
    blendMode: { default: "screen", type: "string" },
    opacity: { default: 0.5, type: "number" },
    scale: { default: 1, type: "number" },
    rotation: { default: 0, type: "number" },
    animate: { default: true, type: "boolean" },
    fps: { default: 30, type: "number" },
  },
  process: (input, params) => {
    applyOverlay(input, {
      source: params.source as string | undefined,
      blendMode: params.blendMode as OverlayBlendMode | undefined,
      opacity: params.opacity as number | undefined,
      scale: params.scale as number | undefined,
      rotation: params.rotation as number | undefined,
      animate: params.animate as boolean | undefined,
      fps: params.fps as number | undefined,
      position: params.position as { x: number; y: number } | undefined,
      seed: params.seed as number | undefined,
    });
  },
});

registerEffect(overlayEffect);
