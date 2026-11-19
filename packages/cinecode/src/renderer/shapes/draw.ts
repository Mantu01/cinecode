import type { DrawContext, ShapeDrawParams, Rect, Point } from "./primitives.js";
import { applyTransform, applyBlendMode, applyFill, applyStroke, applyShadow, createDefaultTransform } from "./primitives.js";

export function drawRectangle(
  context: DrawContext,
  rect: Rect,
  params: ShapeDrawParams = {},
): void {
  const { ctx } = context;
  const transform = { ...createDefaultTransform(), ...params.transform };
  ctx.save();
  applyBlendMode(ctx, params.blendMode ?? "source-over");
  ctx.globalAlpha = (params.opacity ?? 1) * context.opacity;
  applyTransform(ctx, transform, rect.width, rect.height);
  if (params.shadow) applyShadow(ctx, params.shadow);
  if (params.fill) {
    applyFill(ctx, params.fill, rect.width, rect.height);
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
  if (params.stroke) {
    applyStroke(ctx, params.stroke);
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }
  ctx.restore();
}

export function drawRoundedRectangle(
  context: DrawContext,
  rect: Rect,
  radius: number | { tl: number; tr: number; br: number; bl: number },
  params: ShapeDrawParams = {},
): void {
  const { ctx } = context;
  const transform = { ...createDefaultTransform(), ...params.transform };
  const r = typeof radius === "number" ? { tl: radius, tr: radius, br: radius, bl: radius } : radius;
  ctx.save();
  applyBlendMode(ctx, params.blendMode ?? "source-over");
  ctx.globalAlpha = (params.opacity ?? 1) * context.opacity;
  applyTransform(ctx, transform, rect.width, rect.height);
  if (params.shadow) applyShadow(ctx, params.shadow);
  ctx.beginPath();
  ctx.moveTo(rect.x + r.tl, rect.y);
  ctx.lineTo(rect.x + rect.width - r.tr, rect.y);
  ctx.arcTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + r.tr, r.tr);
  ctx.lineTo(rect.x + rect.width, rect.y + rect.height - r.br);
  ctx.arcTo(rect.x + rect.width, rect.y + rect.height, rect.x + rect.width - r.br, rect.y + rect.height, r.br);
  ctx.lineTo(rect.x + r.bl, rect.y + rect.height);
  ctx.arcTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - r.bl, r.bl);
  ctx.lineTo(rect.x, rect.y + r.tl);
  ctx.arcTo(rect.x, rect.y, rect.x + r.tl, rect.y, r.tl);
  ctx.closePath();
  if (params.fill) {
    applyFill(ctx, params.fill, rect.width, rect.height);
    ctx.fill();
  }
  if (params.stroke) {
    applyStroke(ctx, params.stroke);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawEllipse(
  context: DrawContext,
  center: Point,
  radiusX: number,
  radiusY: number,
  params: ShapeDrawParams = {},
): void {
  const { ctx } = context;
  const transform = { ...createDefaultTransform(), ...params.transform };
  ctx.save();
  applyBlendMode(ctx, params.blendMode ?? "source-over");
  ctx.globalAlpha = (params.opacity ?? 1) * context.opacity;
  applyTransform(ctx, transform, radiusX * 2, radiusY * 2);
  if (params.shadow) applyShadow(ctx, params.shadow);
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, radiusX, radiusY, 0, 0, Math.PI * 2);
  if (params.fill) {
    applyFill(ctx, params.fill, radiusX * 2, radiusY * 2);
    ctx.fill();
  }
  if (params.stroke) {
    applyStroke(ctx, params.stroke);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawLine(
  context: DrawContext,
  from: Point,
  to: Point,
  params: ShapeDrawParams = {},
): void {
  const { ctx } = context;
  const transform = { ...createDefaultTransform(), ...params.transform };
  const width = Math.abs(to.x - from.x) || 1;
  const height = Math.abs(to.y - from.y) || 1;
  ctx.save();
  applyBlendMode(ctx, params.blendMode ?? "source-over");
  ctx.globalAlpha = (params.opacity ?? 1) * context.opacity;
  applyTransform(ctx, transform, width, height);
  if (params.shadow) applyShadow(ctx, params.shadow);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  if (params.stroke) {
    applyStroke(ctx, params.stroke);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawPolygon(
  context: DrawContext,
  points: readonly Point[],
  params: ShapeDrawParams = {},
): void {
  const { ctx } = context;
  const transform = { ...createDefaultTransform(), ...params.transform };
  if (points.length < 3) return;
  let minX = points[0]!.x;
  let maxX = points[0]!.x;
  let minY = points[0]!.y;
  let maxY = points[0]!.y;
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  ctx.save();
  applyBlendMode(ctx, params.blendMode ?? "source-over");
  ctx.globalAlpha = (params.opacity ?? 1) * context.opacity;
  applyTransform(ctx, transform, width, height);
  if (params.shadow) applyShadow(ctx, params.shadow);
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i]!.x, points[i]!.y);
  }
  ctx.closePath();
  if (params.fill) {
    applyFill(ctx, params.fill, width, height);
    ctx.fill();
  }
  if (params.stroke) {
    applyStroke(ctx, params.stroke);
    ctx.stroke();
  }
  ctx.restore();
}

export interface PathSegment {
  readonly command: "move" | "line" | "quad" | "cubic" | "arc" | "close";
  readonly points: readonly Point[];
  readonly radius?: number;
  readonly startAngle?: number;
  readonly endAngle?: number;
  readonly counterclockwise?: boolean;
}

export function drawPath(
  context: DrawContext,
  segments: readonly PathSegment[],
  params: ShapeDrawParams = {},
): void {
  const { ctx } = context;
  const transform = { ...createDefaultTransform(), ...params.transform };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const seg of segments) {
    for (const p of seg.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  ctx.save();
  applyBlendMode(ctx, params.blendMode ?? "source-over");
  ctx.globalAlpha = (params.opacity ?? 1) * context.opacity;
  applyTransform(ctx, transform, width, height);
  if (params.shadow) applyShadow(ctx, params.shadow);
  ctx.beginPath();
  for (const seg of segments) {
    switch (seg.command) {
      case "move":
        ctx.moveTo(seg.points[0]!.x, seg.points[0]!.y);
        break;
      case "line":
        ctx.lineTo(seg.points[0]!.x, seg.points[0]!.y);
        break;
      case "quad":
        ctx.quadraticCurveTo(seg.points[0]!.x, seg.points[0]!.y, seg.points[1]!.x, seg.points[1]!.y);
        break;
      case "cubic":
        ctx.bezierCurveTo(seg.points[0]!.x, seg.points[0]!.y, seg.points[1]!.x, seg.points[1]!.y, seg.points[2]!.x, seg.points[2]!.y);
        break;
      case "arc":
        ctx.arc(seg.points[0]!.x, seg.points[0]!.y, seg.radius!, seg.startAngle!, seg.endAngle!, seg.counterclockwise);
        break;
      case "close":
        ctx.closePath();
        break;
    }
  }
  if (params.fill) {
    applyFill(ctx, params.fill, width, height);
    ctx.fill();
  }
  if (params.stroke) {
    applyStroke(ctx, params.stroke);
    ctx.stroke();
  }
  ctx.restore();
}