import type { Canvas } from "@napi-rs/canvas";
import { createTextureCanvas, fbm, fractional, hexToRgb } from "./common.js";

export type WeaveType = "plain" | "twill" | "satin";

export interface FabricTextureParams {
  readonly threadCount?: number;
  readonly warpColor?: string;
  readonly weftColor?: string;
  readonly weave?: WeaveType;
  readonly threadThickness?: number;
  readonly fuzziness?: number;
  readonly seed?: number;
}

export function generateFabricTexture(width: number, height: number, params: FabricTextureParams = {}): Canvas {
  const warp = hexToRgb(params.warpColor ?? "#8f2f2f", { r: 143, g: 47, b: 47 });
  const weft = hexToRgb(params.weftColor ?? "#d9b48f", { r: 217, g: 180, b: 143 });
  const threadCount = Math.max(2, params.threadCount ?? 40);
  const weave = params.weave ?? "plain";
  const thickness = Math.max(0.1, Math.min(0.95, params.threadThickness ?? 0.75));
  const fuzziness = Math.max(0, Math.min(1, params.fuzziness ?? 0.25));
  const seed = params.seed ?? 13;
  const cell = Math.max(1, Math.min(width, height) / threadCount);
  const threadVariation = (index: number): number => 0.86 + fbm(seed + index * 31, index * 0.37, 0.5, 2) * 0.28;

  return createTextureCanvas(width, height, (x, y) => {
    const cellX = Math.floor(x / cell);
    const cellY = Math.floor(y / cell);
    const localX = fractional(x / cell);
    const localY = fractional(y / cell);
    const overPattern = weave === "plain"
      ? (cellX + cellY) % 2 === 0
      : weave === "twill"
        ? (cellX + cellY) % 4 < 2
        : (cellX % 5 === 0 || cellY % 5 === 0);

    const warpVisible = overPattern ? localX < 0.5 : localY < 0.5;
    const threadIndex = warpVisible ? cellX : cellY + 1000;
    const color = warpVisible ? warp : weft;
    const edgeDistance = Math.min(
      Math.min(localX, 1 - localX),
      Math.min(localY, 1 - localY),
    );
    const weaveRoundness = Math.sin(Math.PI * Math.min(1, edgeDistance / (thickness * 0.5) + 1e-6));
    const fuzz = fbm(seed, x * 0.35, y * 0.35, 2) * fuzziness;
    const shade = (0.55 + weaveRoundness * 0.45) * threadVariation(threadIndex) * (1 - fuzz * 0.25);
    return { r: color.r * shade, g: color.g * shade, b: color.b * shade };
  });
}
