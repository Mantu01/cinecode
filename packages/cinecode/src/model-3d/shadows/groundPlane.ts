import { Canvas } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";
import { applyShadowMap } from "./apply.js";
import type { ShadowMap } from "./software.js";

export interface GroundPlaneOptions {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color?: string;
  readonly opacity?: number;
  readonly shadow?: ShadowMap;
  readonly shadowOpacity?: number;
}

export function drawGroundPlane(ctx: SKRSContext2D, options: GroundPlaneOptions): Canvas {
  const { x, y, width, height } = options;
  const plane = new Canvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  const planeCtx = plane.getContext("2d");
  planeCtx.fillStyle = options.color ?? "#8a8f98";
  planeCtx.globalAlpha = options.opacity ?? 1;
  planeCtx.fillRect(0, 0, plane.width, plane.height);
  planeCtx.globalAlpha = 1;

  if (options.shadow) {
    applyShadowMap(planeCtx, options.shadow, {
      opacity: options.shadowOpacity ?? 0.5,
      targetRect: { x: 0, y: 0, width: plane.width, height: plane.height },
    });
  }

  ctx.save();
  ctx.drawImage(plane, x, y);
  ctx.restore();
  return plane;
}

export function createGroundPlaneCanvas(options: GroundPlaneOptions): Canvas {
  const plane = new Canvas(Math.max(1, Math.round(options.width)), Math.max(1, Math.round(options.height)));
  const ctx = plane.getContext("2d");
  drawGroundPlane(ctx, { ...options, x: 0, y: 0 });
  return plane;
}
