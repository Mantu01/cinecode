import type { Rgba, Gradient } from "../color/types.js";
import type { GlobalCompositeOperation, SKRSContext2D, Canvas, Path2D, CanvasGradient, CanvasPattern } from "@napi-rs/canvas";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type Fill = Rgba | Gradient;

export interface Stroke {
  readonly color: Rgba;
  readonly width: number;
  readonly lineCap: "butt" | "round" | "square";
  readonly lineJoin: "miter" | "round" | "bevel";
  readonly dashArray: readonly number[];
  readonly dashOffset: number;
}

export interface Shadow {
  readonly color: Rgba;
  readonly blur: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface Transform {
  readonly translateX: number;
  readonly translateY: number;
  readonly rotate: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly anchorX: number;
  readonly anchorY: number;
}

export interface DrawContext {
  readonly canvas: Canvas;
  readonly ctx: SKRSContext2D;
  readonly transform: Transform;
  readonly opacity: number;
  readonly blendMode: BlendMode;
  readonly clipPath: Path2D | null;
}

export type BlendMode =
  | "source-over"
  | "multiply"
  | "screen"
  | "overlay"
  | "plus-lighter"
  | "darken"
  | "lighten"
  | "soft-light"
  | "difference";

export interface ShapeDrawParams {
  readonly fill?: Fill;
  readonly stroke?: Stroke;
  readonly shadow?: Shadow;
  readonly transform?: Partial<Transform>;
  readonly opacity?: number;
  readonly blendMode?: BlendMode;
  readonly clipPath?: Path2D;
}

export function createDefaultTransform(): Transform {
  return {
    translateX: 0,
    translateY: 0,
    rotate: 0,
    scaleX: 1,
    scaleY: 1,
    anchorX: 0.5,
    anchorY: 0.5,
  };
}

export function applyTransform(ctx: SKRSContext2D, transform: Transform, width: number, height: number): void {
  const cx = transform.anchorX * width;
  const cy = transform.anchorY * height;
  ctx.translate(transform.translateX + cx, transform.translateY + cy);
  ctx.rotate((transform.rotate * Math.PI) / 180);
  ctx.scale(transform.scaleX, transform.scaleY);
  ctx.translate(-cx, -cy);
}

export function applyBlendMode(ctx: SKRSContext2D, mode: BlendMode): void {
  const mapping: Record<BlendMode, GlobalCompositeOperation> = {
    "source-over": "source-over",
    multiply: "multiply",
    screen: "screen",
    overlay: "overlay",
    "plus-lighter": "lighter",
    darken: "darken",
    lighten: "lighten",
    "soft-light": "soft-light",
    difference: "difference",
  };
  ctx.globalCompositeOperation = mapping[mode];
}

export function applyFill(ctx: SKRSContext2D, fill: Fill, width: number, height: number): void {
  if ("r" in fill) {
    ctx.fillStyle = `rgba(${fill.r}, ${fill.g}, ${fill.b}, ${fill.a})`;
  } else {
    ctx.fillStyle = createGradient(ctx, fill, width, height);
  }
}

export function applyStroke(ctx: SKRSContext2D, stroke: Stroke): void {
  ctx.strokeStyle = `rgba(${stroke.color.r}, ${stroke.color.g}, ${stroke.color.b}, ${stroke.color.a})`;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = stroke.lineCap;
  ctx.lineJoin = stroke.lineJoin;
  if (stroke.dashArray.length > 0) {
    ctx.setLineDash([...stroke.dashArray]);
    ctx.lineDashOffset = stroke.dashOffset;
  }
}

export function applyShadow(ctx: SKRSContext2D, shadow: Shadow): void {
  ctx.shadowColor = `rgba(${shadow.color.r}, ${shadow.color.g}, ${shadow.color.b}, ${shadow.color.a})`;
  ctx.shadowBlur = shadow.blur;
  ctx.shadowOffsetX = shadow.offsetX;
  ctx.shadowOffsetY = shadow.offsetY;
}

function createGradient(ctx: SKRSContext2D, gradient: Gradient, width: number, height: number): CanvasGradient | CanvasPattern {
  if (gradient.type === "linear") {
    const angle = (gradient.angle * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const cx = width / 2;
    const cy = height / 2;
    const len = Math.max(width, height);
    const x1 = cx - cos * len;
    const y1 = cy - sin * len;
    const x2 = cx + cos * len;
    const y2 = cy + sin * len;
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    for (const stop of gradient.stops) {
      grad.addColorStop(stop.offset, `rgba(${stop.color.r}, ${stop.color.g}, ${stop.color.b}, ${stop.color.a})`);
    }
    return grad;
  }
  if (gradient.type === "radial") {
    const grad = ctx.createRadialGradient(
      gradient.centerX * width,
      gradient.centerY * height,
      0,
      gradient.centerX * width,
      gradient.centerY * height,
      gradient.radius * Math.max(width, height),
    );
    for (const stop of gradient.stops) {
      grad.addColorStop(stop.offset, `rgba(${stop.color.r}, ${stop.color.g}, ${stop.color.b}, ${stop.color.a})`);
    }
    return grad;
  }
  const grad = ctx.createConicGradient(
    (gradient.angle * Math.PI) / 180,
    gradient.centerX * width,
    gradient.centerY * height,
  );
  for (const stop of gradient.stops) {
    grad.addColorStop(stop.offset, `rgba(${stop.color.r}, ${stop.color.g}, ${stop.color.b}, ${stop.color.a})`);
  }
  return grad;
}