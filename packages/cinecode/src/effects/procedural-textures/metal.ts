import type { Canvas } from "@napi-rs/canvas";
import { createTextureCanvas, fbm, hexToRgb } from "./common.js";

export type MetalPreset = "silver" | "gold" | "copper" | "titanium";

export interface MetalTextureParams {
  readonly brushDirection?: number;
  readonly roughness?: number;
  readonly baseColor?: string;
  readonly preset?: MetalPreset;
  readonly specularIntensity?: number;
  readonly lightAngle?: number;
  readonly seed?: number;
  readonly scale?: number;
}

const METAL_COLORS: Readonly<Record<MetalPreset, string>> = {
  silver: "#b8bcc2",
  gold: "#d8a93c",
  copper: "#b87333",
  titanium: "#8f949b",
};

export function generateMetalTexture(width: number, height: number, params: MetalTextureParams = {}): Canvas {
  const base = hexToRgb(params.baseColor ?? METAL_COLORS[params.preset ?? "silver"], { r: 184, g: 188, b: 194 });
  const brush = ((params.brushDirection ?? 0) * Math.PI) / 180;
  const roughness = params.roughness ?? 0.35;
  const specular = params.specularIntensity ?? 0.6;
  const lightAngle = ((params.lightAngle ?? 45) * Math.PI) / 180;
  const seed = params.seed ?? 9;
  const scale = params.scale ?? 0.02;
  const cosBrush = Math.cos(brush);
  const sinBrush = Math.sin(brush);
  const streakAlignment = Math.abs(Math.sin(lightAngle - brush));

  return createTextureCanvas(width, height, (x, y) => {
    const along = x * cosBrush + y * sinBrush;
    const across = -x * sinBrush + y * cosBrush;
    const streak = fbm(seed, across * scale * 6, along * scale * 0.35, 3);
    const fineStreak = fbm(seed + 17, across * scale * 26, along * scale * 0.9, 2);
    const brushed = (streak * 0.65 + fineStreak * 0.35) * roughness;
    const highlight = Math.pow(Math.max(0, 1 - Math.abs(streak - 0.5) * 2), 8) * specular * streakAlignment;
    const brightness = 0.72 + brushed * 0.5 + highlight * 0.6;
    return {
      r: base.r * brightness,
      g: base.g * brightness,
      b: base.b * brightness,
    };
  });
}
