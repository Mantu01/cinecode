import { Canvas } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { ShadowMap } from "./software.js";

export interface ApplyShadowOptions {
  readonly opacity?: number;
  readonly tint?: readonly [number, number, number];
  readonly targetRect?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export function applyShadowMap(
  target: Canvas | SKRSContext2D,
  shadowMap: ShadowMap,
  options: ApplyShadowOptions = {},
): void {
  const ctx = isContext(target) ? target : target.getContext("2d");
  const canvas = ctx.canvas;
  const rect = options.targetRect ?? { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const opacity = Math.max(0, Math.min(1, options.opacity ?? 0.55));
  const tint = options.tint ?? [0, 0, 0];
  const resolution = shadowMap.resolution;

  const overlay = new Canvas(resolution, resolution);
  const overlayCtx = overlay.getContext("2d");
  const image = overlayCtx.createImageData(resolution, resolution);
  for (let i = 0, pixel = 0; i < image.data.length; i += 4, pixel += 1) {
    const luminance = shadowMap.data[pixel]! / 255;
    image.data[i] = tint[0];
    image.data[i + 1] = tint[1];
    image.data[i + 2] = tint[2];
    image.data[i + 3] = Math.round((1 - luminance) * opacity * 255);
  }
  overlayCtx.putImageData(image, 0, 0);

  ctx.save();
  ctx.drawImage(overlay, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

export function applyShadowMatrixToCanvas(
  target: Canvas,
  shadowMap: ShadowMap,
  options: ApplyShadowOptions = {},
): Canvas {
  applyShadowMap(target, shadowMap, options);
  return target;
}

function isContext(value: Canvas | SKRSContext2D): value is SKRSContext2D {
  return typeof (value as SKRSContext2D).fillRect === "function" && !("getContext" in value);
}
