import { Canvas } from "@napi-rs/canvas";
import type { Path2D, SKRSContext2D } from "@napi-rs/canvas";
import type { Rgba, Gradient } from "../color/types.js";
import type { BlendMode, Transform } from "../shapes/primitives.js";
import { applyBlendMode, applyTransform } from "../shapes/primitives.js";
import {
  canvasOperationForPorterDuff,
  compositeBuffers,
  premultiplyAlpha,
  unpremultiplyAlpha,
  type AlphaMode,
  type BufferCompositeOptions,
  type PorterDuffOperator,
} from "./porter-duff.js";

export interface CompositedLayer {
  readonly canvas: Canvas;
  readonly opacity: number;
  readonly blendMode: BlendMode;
  readonly transform: Transform;
  readonly mask?: Mask;
  readonly matte?: Matte;
  readonly operator?: PorterDuffOperator;
  readonly alphaMode?: AlphaMode;
}

export interface Mask {
  readonly kind: "shape" | "path";
  readonly shape: MaskShape;
  readonly invert: boolean;
}

export type MaskShape =
  | { readonly kind: "rectangle"; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly kind: "ellipse"; readonly cx: number; readonly cy: number; readonly radiusX: number; readonly radiusY: number }
  | { readonly kind: "path"; readonly path: Path2D };

export interface Matte {
  readonly kind: "alpha" | "luminance";
  readonly source: Canvas;
}

export function createCanvas(width: number, height: number): Canvas {
  return new Canvas(width, height);
}

export function createContext(canvas: Canvas): SKRSContext2D {
  return canvas.getContext("2d", { alpha: true, colorSpace: "srgb" });
}

export function clearCanvas(ctx: SKRSContext2D, width: number, height: number, background?: Rgba | Gradient): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (background) {
    if ("r" in background) {
      ctx.fillStyle = `rgba(${background.r}, ${background.g}, ${background.b}, ${background.a})`;
      ctx.fillRect(0, 0, width, height);
    }
  }
  ctx.restore();
}

export interface CompositeClipRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function compositeLayers(
  targetCtx: SKRSContext2D,
  layers: readonly CompositedLayer[],
  width: number,
  height: number,
  clipRect?: CompositeClipRect,
): void {
  for (const layer of layers) {
    targetCtx.save();
    if (clipRect) {
      targetCtx.beginPath();
      targetCtx.rect(clipRect.x, clipRect.y, clipRect.width, clipRect.height);
      targetCtx.clip();
    }
    if (layer.operator !== undefined) {
      targetCtx.globalCompositeOperation = canvasOperationForPorterDuff(layer.operator);
    } else {
      applyBlendMode(targetCtx, layer.blendMode);
    }
    targetCtx.globalAlpha = layer.opacity;
    if (layer.mask) {
      applyMask(targetCtx, layer.mask, width, height);
    }
    if (layer.matte) {
      applyMatte(targetCtx, layer.matte, width, height);
    }
    applyTransform(targetCtx, layer.transform, width, height);
    targetCtx.drawImage(layer.canvas, 0, 0);
    targetCtx.restore();
  }
}

function applyMask(ctx: SKRSContext2D, mask: Mask, width: number, height: number): void {
  ctx.save();
  ctx.beginPath();
  if (mask.shape.kind === "rectangle") {
    ctx.rect(mask.shape.x, mask.shape.y, mask.shape.width, mask.shape.height);
  } else if (mask.shape.kind === "ellipse") {
    ctx.ellipse(mask.shape.cx, mask.shape.cy, mask.shape.radiusX, mask.shape.radiusY, 0, 0, Math.PI * 2);
  } else if (mask.shape.kind === "path") {
    const path = mask.shape.path;
    ctx.fill(path);
    ctx.clip();
    ctx.restore();
    return;
  }
  if (mask.invert) {
    ctx.rect(0, 0, width, height);
    ctx.clip("evenodd");
  } else {
    ctx.clip();
  }
  ctx.restore();
}

/**
 * Matte support: uses a pooled canvas to avoid per-frame allocation.
 */
const matteCanvasPool = new Map<string, Canvas>();
function getMatteCanvas(width: number, height: number): Canvas {
  const key = `${width}x${height}`;
  let c = matteCanvasPool.get(key);
  if (!c) {
    c = new Canvas(width, height);
    matteCanvasPool.set(key, c);
  }
  return c;
}

function applyMatte(ctx: SKRSContext2D, matte: Matte, width: number, height: number): void {
  const tempCanvas = getMatteCanvas(width, height);
  const tempCtx = createContext(tempCanvas);
  tempCtx.drawImage(matte.source, 0, 0);
  const imageData = tempCtx.getImageData(0, 0, width, height);
  const data = imageData.data;
  if (matte.kind !== "alpha") {
    for (let i = 0; i < data.length; i += 4) {
      const luminance = 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
      data[i + 3] = luminance;
    }
  }
  tempCtx.putImageData(imageData, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(tempCanvas, 0, 0);
}

export interface CanvasCompositeOptions extends BufferCompositeOptions {
  readonly width?: number;
  readonly height?: number;
}

export function compositeCanvases(target: Canvas, source: Canvas, options: CanvasCompositeOptions = {}): Canvas {
  const width = options.width ?? Math.min(target.width, source.width);
  const height = options.height ?? Math.min(target.height, source.height);
  const targetCtx = createContext(target);
  const sourceCtx = createContext(source);
  const targetData = targetCtx.getImageData(0, 0, width, height);
  const sourceData = sourceCtx.getImageData(0, 0, width, height);
  compositeBuffers(sourceData.data, targetData.data, options);
  targetCtx.putImageData(targetData, 0, 0);
  return target;
}

export function convertCanvasAlphaMode(canvas: Canvas, from: AlphaMode, to: AlphaMode = "premultiplied"): Canvas {
  if (from === to) return canvas;
  const ctx = createContext(canvas);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (to === "premultiplied") premultiplyAlpha(data.data);
  else unpremultiplyAlpha(data.data);
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export function copyCanvas(source: Canvas): Canvas {
  const copy = createCanvas(source.width, source.height);
  const ctx = createContext(copy);
  ctx.drawImage(source, 0, 0);
  return copy;
}

export function applyOpacity(canvas: Canvas, opacity: number): Canvas {
  const result = createCanvas(canvas.width, canvas.height);
  const ctx = createContext(result);
  ctx.globalAlpha = opacity;
  ctx.drawImage(canvas, 0, 0);
  return result;
}
