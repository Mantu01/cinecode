import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { PDFDocument as PdfLibDocument, PDFPage } from "pdf-lib";
import type { Composition, PathSegment, Point, Stroke } from "../core/types/index.js";
import { parseColor } from "../renderer/color/parse.js";

export interface PdfVectorOptions {
  readonly width: number;
  readonly height: number;
}

export interface ShapeStyle {
  readonly fill?: string;
  readonly stroke?: Stroke;
  readonly opacity?: number;
}

/**
 * Checks whether a composition contains only vector-friendly clips (shape/text).
 * Returns false for any video or raster image clip.
 */
export function isVectorOnly(composition: Composition): boolean {
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind === "audio") continue;
    for (const clip of track.clips) {
      if ((clip as { type?: string }).type === "video") return false;
    }
  }
  return true;
}

/**
 * Converts a vector-only composition to a single-page PDF at the given frame.
 * Returns null if the composition contains non-vector elements.
 */
export async function compositionToVectorPdf(
  composition: Composition,
  _frame: number,
  options: PdfVectorOptions,
): Promise<Buffer | null> {
  if (!isVectorOnly(composition)) return null;
  const pdfDoc = await PDFDocument.create();
  await appendVectorPage(pdfDoc, composition, _frame, options);
  return Buffer.from(await pdfDoc.save());
}

/**
 * Appends one page representing the composition at the given frame to an
 * existing PDF document, so callers can assemble multi-page vector PDFs.
 */
export async function appendVectorPage(
  pdfDoc: PdfLibDocument,
  composition: Composition,
  frame: number,
  options: PdfVectorOptions,
): Promise<void> {
  const page = pdfDoc.addPage([options.width, options.height]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const time = frame / composition.fps;
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind === "audio") continue;
    for (const clip of track.clips) {
      await renderVectorClip(page, clip as never, time, composition.fps, options, font);
    }
  }
}

async function renderVectorClip(
  page: PDFPage,
  clip: never,
  time: number,
  fps: number,
  options: PdfVectorOptions,
  font: import("pdf-lib").PDFFont,
): Promise<void> {
  const shape = clip as {
    type?: string;
    start?: number | string;
    duration?: number | string;
    content?: { text?: string; color?: string; fontSize?: number };
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    shapeType?: string;
    radius?: number;
    points?: readonly Point[];
    path?: readonly PathSegment[];
    fill?: string;
    stroke?: Stroke;
    opacity?: number;
    closed?: boolean;
  };
  if (!isActive(shape, time, fps)) return;
  const style: ShapeStyle = { fill: shape.fill, stroke: shape.stroke, opacity: shape.opacity };
  if (shape.type === "text" && shape.content?.text) {
    const color = shape.content.color ? hexToRgb(shape.content.color) : rgb(0, 0, 0);
    const size = shape.content.fontSize ?? 12;
    page.drawText(shape.content.text, {
      x: shape.x ?? 10,
      y: (options.height ?? 792) - (shape.y ?? 0) - size,
      size,
      font,
      color,
    });
    return;
  }
  if (shape.type !== "shape") return;
  const x = shape.x ?? 0;
  const y = shape.y ?? 0;
  if (shape.shapeType === "rectangle" || shape.shapeType === "rounded-rectangle") {
    drawRect(page, { x, y, width: shape.width ?? 0, height: shape.height ?? 0 }, style, options.height, shape.shapeType === "rounded-rectangle" ? shape.radius : undefined);
    return;
  }
  if (shape.shapeType === "ellipse") {
    drawCircle(
      page,
      {
        cx: x + (shape.width ?? 0) / 2,
        cy: y + (shape.height ?? 0) / 2,
        radiusX: (shape.width ?? 0) / 2,
        radiusY: (shape.height ?? 0) / 2,
      },
      style,
      options.height,
    );
    return;
  }
  const segments = shape.path ?? polygonToSegments(shape.points, shape.closed !== false);
  if (segments.length > 0) drawPath(page, segments, style, options.height, { x, y });
}

function isActive(shape: { start?: number | string; duration?: number | string }, time: number, fps: number): boolean {
  const start = shape.start === undefined ? 0 : typeof shape.start === "number" ? shape.start : parseTime(shape.start, fps);
  const duration = shape.duration === undefined ? Infinity : typeof shape.duration === "number" ? shape.duration : parseTime(shape.duration, fps);
  return time >= start && time < start + duration;
}

function parseTime(value: string, fps: number): number {
  if (value.endsWith("f")) return parseInt(value, 10) / fps;
  if (value.endsWith("%")) return 0;
  return parseFloat(value) || 0;
}

function polygonToSegments(points: readonly Point[] | undefined, closed: boolean): readonly PathSegment[] {
  if (!points || points.length < 2) return [];
  const segments: PathSegment[] = [{ command: "move", points: [points[0]!] }];
  for (let i = 1; i < points.length; i++) segments.push({ command: "line", points: [points[i]!] });
  if (closed && points.length > 2) segments.push({ command: "close", points: [] });
  return segments;
}

/** pdf-lib draws from the bottom-left origin; compositions use top-left. */
function flipY(y: number, pageHeight: number | undefined): number {
  return (pageHeight ?? 792) - y;
}

export function drawRect(
  page: PDFPage,
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  style: ShapeStyle,
  pageHeight?: number,
  cornerRadius?: number,
): void {
  if (cornerRadius && cornerRadius > 0) {
    drawRoundedRect(page, rect, cornerRadius, style, pageHeight);
    return;
  }
  const opacity = style.opacity ?? 1;
  const paint = style.fill ? hexToRgb(style.fill) : undefined;
  const border = style.stroke;
  page.drawRectangle({
    x: rect.x,
    y: flipY(rect.y + rect.height, pageHeight),
    width: rect.width,
    height: rect.height,
    color: paint,
    opacity: paint ? opacity : 0,
    borderColor: border ? hexToRgb(border.color) : undefined,
    borderWidth: border?.width ?? 0,
    borderOpacity: border ? opacity : 0,
  });
}

/**
 * pdf-lib's drawSvgPath anchors SVG space (y grows downward) at the given
 * (x, y) point, so anchoring at (0, pageHeight) matches composition coordinates.
 */
function drawRoundedRect(
  page: PDFPage,
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  radius: number,
  style: ShapeStyle,
  pageHeight?: number,
): void {
  const opacity = style.opacity ?? 1;
  const r = Math.min(radius, rect.width / 2, rect.height / 2);
  const x = rect.x;
  const y = rect.y;
  const w = rect.width;
  const h = rect.height;
  const path =
    `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} ` +
    `V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} ` +
    `H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} ` +
    `V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
  page.drawSvgPath(path, {
    x: 0,
    y: pageHeight ?? 792,
    color: style.fill ? hexToRgb(style.fill) : undefined,
    borderColor: style.stroke ? hexToRgb(style.stroke.color) : undefined,
    borderWidth: style.stroke?.width ?? 0,
    opacity,
  });
}

export function drawCircle(
  page: PDFPage,
  circle: { readonly cx: number; readonly cy: number; readonly radiusX: number; readonly radiusY: number },
  style: ShapeStyle,
  pageHeight?: number,
): void {
  const opacity = style.opacity ?? 1;
  const paint = style.fill ? hexToRgb(style.fill) : undefined;
  const border = style.stroke;
  page.drawEllipse({
    x: circle.cx,
    y: flipY(circle.cy, pageHeight),
    xScale: Math.max(0.01, circle.radiusX),
    yScale: Math.max(0.01, circle.radiusY),
    color: paint,
    opacity: paint ? opacity : 0,
    borderColor: border ? hexToRgb(border.color) : undefined,
    borderWidth: border?.width ?? 0,
    borderOpacity: border ? opacity : 0,
  });
}

export function drawPath(
  page: PDFPage,
  segments: readonly PathSegment[],
  style: ShapeStyle,
  pageHeight?: number,
  offset?: { readonly x: number; readonly y: number },
): void {
  const opacity = style.opacity ?? 1;
  const border = style.stroke;
  const paint = style.fill ? hexToRgb(style.fill) : undefined;
  const strokeColor = border ? hexToRgb(border.color) : paint;
  const strokeWidth = border?.width ?? 0;
  const oy = offset?.y ?? 0;
  const ox = offset?.x ?? 0;
  const toPdf = (p: Point): Point => ({ x: ox + p.x, y: flipY(oy + p.y, pageHeight) });
  let current: Point | undefined;
  let start: Point | undefined;
  for (const segment of segments) {
    const first = segment.points[0];
    if (segment.command === "move" && first) {
      current = toPdf(first);
      start = current;
      continue;
    }
    if (segment.command === "close" && start && current && strokeColor && strokeWidth > 0) {
      page.drawLine({ start: current, end: start, color: strokeColor, thickness: strokeWidth, opacity });
      current = start;
      continue;
    }
    for (const point of segment.points) {
      const next = toPdf(point);
      if (current && (strokeColor || paint)) {
        page.drawLine({
          start: current,
          end: next,
          color: strokeColor ?? paint!,
          thickness: Math.max(0.1, strokeWidth),
          opacity,
        });
      }
      current = next;
    }
  }
}

function hexToRgb(hex: string): ReturnType<typeof rgb> {
  const color = parseColor(hex);
  return rgb(color.r / 255, color.g / 255, color.b / 255);
}
