import type { Canvas, CanvasGradient, SKRSContext2D } from "@napi-rs/canvas";
import type { Rect, Stroke, Transform } from "../renderer/shapes/primitives.js";
import { applyTransform, createDefaultTransform } from "../renderer/shapes/primitives.js";
import type { Rgba } from "../renderer/color/types.js";
import { parseColor } from "../renderer/color/parse.js";
import { createCanvas, createContext } from "../renderer/composite/engine.js";
import type { SvgDefs, SvgElement, SvgGradient, SvgPathCommand } from "./types.js";
import { applySvgTransform, pathBoundingBox, tracePath, type SvgBoundingBox } from "./geometry.js";

export function drawSvg(ctx: SKRSContext2D, element: SvgElement, bounds: Rect, transform: Transform, opacity: number): void {
  ctx.save();
  applyTransform(ctx, transform, bounds.width, bounds.height);
  const viewBox = parseViewBox(element);
  const scale = Math.min(bounds.width / viewBox.width, bounds.height / viewBox.height);
  const offsetX = (bounds.width - viewBox.width * scale) / 2;
  const offsetY = (bounds.height - viewBox.height * scale) / 2;
  ctx.translate(bounds.x + offsetX, bounds.y + offsetY);
  ctx.scale(scale, scale);
  const defs = element.defs ?? emptyDefs;
  for (const child of element.children) {
    drawElement(ctx, child, element.styles, defs, opacity);
  }
  ctx.restore();
}

export function renderSvgToCanvas(element: SvgElement, width: number, height: number): Canvas {
  const canvas = createCanvas(width, height);
  const ctx = createContext(canvas);
  drawSvg(ctx, element, { x: 0, y: 0, width, height }, createDefaultTransform(), 1);
  return canvas;
}

const emptyDefs: SvgDefs = { gradients: new Map(), clipPaths: new Map() };

interface ViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function parseViewBox(element: SvgElement): ViewBox {
  const value = element.attrs.viewBox;
  if (value !== undefined) {
    const parts = value.split(/[\s,]+/).filter(Boolean).map(Number.parseFloat);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! };
    }
  }
  const width = toNumber(element.attrs.width, 100);
  const height = toNumber(element.attrs.height, 100);
  return { x: 0, y: 0, width, height };
}

function toNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function drawElement(
  ctx: SKRSContext2D,
  element: SvgElement,
  inherited: Readonly<Record<string, string>>,
  defs: SvgDefs,
  inheritedOpacity: number,
): void {
  const styles: Record<string, string> = { ...inherited, ...element.styles };
  if (styles.display === "none") return;
  const opacity = inheritedOpacity * toNumber(styles.opacity, 1);

  ctx.save();
  ctx.globalAlpha = opacity;
  applySvgTransform(ctx, styles.transform);

  const clipShapeIds = resolveClipReference(styles["clip-path"]);
  if (clipShapeIds !== undefined) {
    const shapes = defs.clipPaths.get(clipShapeIds);
    if (shapes !== undefined && shapes.length > 0) {
      ctx.beginPath();
      for (const shape of shapes) {
        tracePath(ctx, shape.paths);
      }
      const rule: "nonzero" | "evenodd" = styles["clip-rule"] === "evenodd" ? "evenodd" : "nonzero";
      ctx.clip(rule);
    }
  }

  const commands = collectCommands(element);
  const bbox = pathBoundingBox(commands);
  if (commands.length > 0) {
    paintShape(ctx, commands, styles, defs, bbox);
  }

  for (const child of element.children) {
    drawElement(ctx, child, styles, defs, opacity);
  }
  ctx.restore();
}

function collectCommands(element: SvgElement): readonly SvgPathCommand[] {
  if (element.paths.length > 0) return element.paths;
  return [];
}

function paintShape(
  ctx: SKRSContext2D,
  commands: readonly SvgPathCommand[],
  styles: Readonly<Record<string, string>>,
  defs: SvgDefs,
  bbox: SvgBoundingBox,
): void {
  ctx.beginPath();
  tracePath(ctx, commands);
  const fill = resolvePaint(ctx, styles.fill, styles["fill-opacity"], defs, bbox);
  const stroke = resolveStroke(styles, defs);
  if (fill !== undefined) {
    ctx.fillStyle = fill;
    const rule: "nonzero" | "evenodd" = styles["fill-rule"] === "evenodd" ? "evenodd" : "nonzero";
    ctx.fill(rule);
  }
  if (stroke !== undefined) {
    ctx.strokeStyle = rgbaToString(stroke.color);
    ctx.lineWidth = stroke.width;
    ctx.lineCap = stroke.lineCap;
    ctx.lineJoin = stroke.lineJoin;
    if (stroke.dashArray.length > 0) {
      ctx.setLineDash([...stroke.dashArray]);
      ctx.lineDashOffset = stroke.dashOffset;
    }
    ctx.stroke();
  }
}

function resolveClipReference(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const match = /^url\(#([^)]+)\)/.exec(value.trim());
  return match === null ? undefined : match[1]!;
}

function resolvePaint(
  ctx: SKRSContext2D,
  value: string | undefined,
  opacityValue: string | undefined,
  defs: SvgDefs,
  bbox: SvgBoundingBox,
): string | CanvasGradient | undefined {
  if (value === undefined || value.trim() === "" || value.trim() === "none") return undefined;
  const gradient = resolveGradientReference(value, defs);
  if (gradient !== undefined) {
    return createSvgGradient(ctx, gradient, bbox);
  }
  return toCssColor(value, opacityValue);
}

function toCssColor(value: string, opacityValue: string | undefined): string {
  let color: Rgba;
  try {
    color = parseColor(value.trim());
  } catch {
    return "#000000";
  }
  const opacity = clampUnit(opacityValue === undefined ? 1 : toNumber(opacityValue, 1));
  const a = color.a * opacity;
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${a})`;
}

function resolveGradientReference(value: string, defs: SvgDefs): SvgGradient | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("url(")) return undefined;
  const id = resolveClipReference(trimmed);
  if (id === undefined) return undefined;
  return defs.gradients.get(id);
}

function createSvgGradient(ctx: SKRSContext2D, gradient: SvgGradient, bbox: SvgBoundingBox): CanvasGradient | string {
  const stops = gradient.stops;
  if (stops.length === 0) return "#000000";
  const useObjectUnits = gradient.gradientUnits === "objectBoundingBox";
  const box = useObjectUnits ? bbox : { x: 0, y: 0, width: 1, height: 1 };
  const mapX = (x: number): number => box.x + x * box.width;
  const mapY = (y: number): number => box.y + y * box.height;
  if (gradient.kind === "radial") {
    const radial = ctx.createRadialGradient(mapX(gradient.cx), mapY(gradient.cy), 0, mapX(gradient.cx), mapY(gradient.cy), Math.max(0, gradient.r * Math.max(box.width, box.height)));
    for (const stop of stops) {
      radial.addColorStop(stop.offset, rgbaToString(stop.color));
    }
    return radial;
  }
  const linear = ctx.createLinearGradient(mapX(gradient.x1), mapY(gradient.y1), mapX(gradient.x2), mapY(gradient.y2));
  for (const stop of stops) {
    linear.addColorStop(stop.offset, rgbaToString(stop.color));
  }
  return linear;
}

function rgbaToString(color: Rgba): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
}

function resolveStroke(
  styles: Readonly<Record<string, string>>,
  defs: SvgDefs,
): Stroke | undefined {
  const value = styles.stroke;
  if (value === undefined || value.trim() === "" || value.trim() === "none") return undefined;
  const gradient = resolveGradientReference(value, defs);
  const gradientColor = gradient === undefined ? undefined : gradient.stops[0]?.color;
  const opacity = clampUnit(toNumber(styles["stroke-opacity"], 1));
  let color: Rgba;
  if (gradientColor !== undefined) {
    color = gradientColor;
  } else {
    try {
      color = parseColor(value.trim());
    } catch {
      color = { r: 0, g: 0, b: 0, a: 1 };
    }
  }
  color = { ...color, a: color.a * opacity };
  const lineCap: Stroke["lineCap"] = styles["stroke-linecap"] === "round"
    ? "round"
    : styles["stroke-linecap"] === "square" ? "square" : "butt";
  const lineJoin: Stroke["lineJoin"] = styles["stroke-linejoin"] === "round"
    ? "round"
    : styles["stroke-linejoin"] === "bevel" ? "bevel" : "miter";
  return {
    color,
    width: Math.max(0, toNumber(styles["stroke-width"], 1)),
    lineCap,
    lineJoin,
    dashArray: parseDashArray(styles["stroke-dasharray"]),
    dashOffset: Math.max(0, toNumber(styles["stroke-dashoffset"], 0)),
  };
}

function parseDashArray(value: string | undefined): readonly number[] {
  if (value === undefined || value.trim() === "none" || value.trim() === "") return [];
  return value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number.parseFloat)
    .filter((n) => Number.isFinite(n) && n >= 0);
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
