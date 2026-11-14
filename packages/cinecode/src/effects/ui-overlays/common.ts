import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import { createCanvas } from "@napi-rs/canvas";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OverlayContent {
  readonly content?: Canvas;
}

export function roundedRectPath(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function drawScaledContent(
  ctx: SKRSContext2D,
  content: Canvas,
  target: Rect,
  mode: "contain" | "cover" = "contain",
): Rect {
  const contentAspect = content.width / content.height;
  const targetAspect = target.width / target.height;
  let width = target.width;
  let height = target.height;
  if (mode === "contain" ? contentAspect > targetAspect : contentAspect < targetAspect) {
    height = target.width / contentAspect;
  } else {
    width = target.height * contentAspect;
  }
  const x = target.x + (target.width - width) / 2;
  const y = target.y + (target.height - height) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(target.x, target.y, target.width, target.height);
  ctx.clip();
  ctx.drawImage(content, x, y, width, height);
  ctx.restore();
  return { x, y, width, height };
}

export interface ShadowOptions {
  readonly enabled?: boolean;
  readonly color?: string;
  readonly blur?: number;
  readonly offsetY?: number;
}

export function drawWindowShadow(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  options: ShadowOptions = {},
): void {
  if (options.enabled === false) return;
  ctx.save();
  ctx.shadowColor = options.color ?? "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = options.blur ?? 30;
  ctx.shadowOffsetY = options.offsetY ?? 12;
  ctx.fillStyle = "#000000";
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.fill();
  ctx.restore();
}

export function createOverlayCanvas(width: number, height: number): Canvas {
  return createCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
}

export function renderOverlayCanvas(
  width: number,
  height: number,
  draw: (ctx: SKRSContext2D) => void,
): Canvas {
  const canvas = createOverlayCanvas(width, height);
  draw(canvas.getContext("2d"));
  return canvas;
}
