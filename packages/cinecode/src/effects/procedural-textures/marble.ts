import type { Canvas } from "@napi-rs/canvas";
import { createTextureCanvas, hexToRgb, mixRgb, turbulence } from "./common.js";

export interface MarbleTextureParams {
  readonly veinColor?: string;
  readonly baseColor?: string;
  readonly turbulence?: number;
  readonly veinThickness?: number;
  readonly scale?: number;
  readonly rotation?: number;
  readonly seed?: number;
  readonly octaves?: number;
}

export function generateMarbleTexture(width: number, height: number, params: MarbleTextureParams = {}): Canvas {
  const vein = hexToRgb(params.veinColor ?? "#3a3a44", { r: 58, g: 58, b: 68 });
  const base = hexToRgb(params.baseColor ?? "#f2efe8", { r: 242, g: 239, b: 232 });
  const turbulenceAmount = params.turbulence ?? 6;
  const thickness = Math.max(0.02, params.veinThickness ?? 0.18);
  const scale = Math.max(0.001, params.scale ?? 0.006);
  const rotation = ((params.rotation ?? 18) * Math.PI) / 180;
  const seed = params.seed ?? 3;
  const octaves = params.octaves ?? 5;
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);

  return createTextureCanvas(width, height, (x, y) => {
    const rotatedX = x * cosRotation - y * sinRotation;
    const rotatedY = x * sinRotation + y * cosRotation;
    const veinNoise = turbulence(seed, x * scale, y * scale, octaves);
    const veinValue = Math.sin((rotatedX * scale * 12) + veinNoise * turbulenceAmount * Math.PI);
    const normalized = (veinValue + 1) / 2;
    const edge = Math.pow(Math.abs(normalized - 0.5) * 2, Math.max(1, 1 / thickness));
    const color = mixRgb(vein, base, edge);
    const shading = 0.92 + 0.08 * turbulence(seed + 7, x * scale * 0.2, y * scale * 0.2, 3);
    return { r: color.r * shading, g: color.g * shading, b: color.b * shading };
  });
}
