import type { Canvas } from "@napi-rs/canvas";
import { createTextureCanvas, fbm, fractional, hexToRgb, mixRgb } from "./common.js";

export interface WoodKnot {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface WoodTextureParams {
  readonly ringDensity?: number;
  readonly lightColor?: string;
  readonly darkColor?: string;
  readonly grainDirection?: number;
  readonly distortion?: number;
  readonly knots?: readonly WoodKnot[];
  readonly seed?: number;
  readonly scale?: number;
}

export function generateWoodTexture(width: number, height: number, params: WoodTextureParams = {}): Canvas {
  const light = hexToRgb(params.lightColor ?? "#c68b52", { r: 198, g: 139, b: 82 });
  const dark = hexToRgb(params.darkColor ?? "#6b3f22", { r: 107, g: 63, b: 34 });
  const ringDensity = params.ringDensity ?? 0.045;
  const distortion = params.distortion ?? 3.2;
  const seed = params.seed ?? 5;
  const direction = ((params.grainDirection ?? 0) * Math.PI) / 180;
  const centerX = width / 2;
  const centerY = height / 2;
  const cosDirection = Math.cos(direction);
  const sinDirection = Math.sin(direction);
  const scale = params.scale ?? 0.012;
  const knots = params.knots ?? [];

  return createTextureCanvas(width, height, (x, y) => {
    const centeredX = (x - centerX) * cosDirection - (y - centerY) * sinDirection;
    const centeredY = (x - centerX) * sinDirection + (y - centerY) * cosDirection;
    let distance = Math.sqrt(centeredX * centeredX + centeredY * centeredY * 0.35);
    for (const knot of knots) {
      const knotDistance = Math.hypot(x - knot.x, y - knot.y);
      if (knotDistance < knot.radius * 3) {
        distance += (knot.radius * 2) * Math.exp(-knotDistance / Math.max(1, knot.radius));
      }
    }
    const growthNoise = fbm(seed + 11, x * scale * 0.35, y * scale * 0.35, 3);
    const ringWidth = ringDensity * (0.75 + growthNoise * 0.5);
    const ring = fractional(distance * ringWidth + fbm(seed, x * scale, y * scale, 4) * distortion);
    const grain = Math.abs(Math.sin(ring * Math.PI));
    const color = mixRgb(dark, light, 0.35 + grain * 0.65);
    const pores = 0.94 + 0.06 * fbm(seed + 23, x * 0.12, y * 0.12, 2);
    return { r: color.r * pores, g: color.g * pores, b: color.b * pores };
  });
}
