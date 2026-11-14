import type { Transform } from "../shapes/primitives.js";

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

export type Alignment = "start" | "center" | "end" | "stretch";
export type Direction = "row" | "column";

export interface LayoutItem {
  readonly id: string;
  readonly size: Size;
  readonly margin?: { top: number; right: number; bottom: number; left: number };
  readonly alignment?: Alignment;
  readonly flex?: number;
}

export interface LayoutOptions {
  readonly direction: Direction;
  readonly gap: number;
  readonly alignment: Alignment;
  readonly padding: { top: number; right: number; bottom: number; left: number };
  readonly containerSize: Size;
  readonly safeArea?: { top: number; right: number; bottom: number; left: number };
}

export interface LayoutResult {
  readonly positions: Map<string, Point>;
  readonly contentSize: Size;
}

export function layoutRow(items: readonly LayoutItem[], options: LayoutOptions): LayoutResult {
  const { gap, alignment, padding, containerSize, safeArea } = options;
  const innerWidth = containerSize.width - padding.left - padding.right - (safeArea?.left ?? 0) - (safeArea?.right ?? 0);
  const innerHeight = containerSize.height - padding.top - padding.bottom - (safeArea?.top ?? 0) - (safeArea?.bottom ?? 0);
  const startX = padding.left + (safeArea?.left ?? 0);
  const startY = padding.top + (safeArea?.top ?? 0);

  const positions = new Map<string, Point>();
  let totalFixedWidth = 0;
  let totalFlex = 0;
  const flexItems: LayoutItem[] = [];

  for (const item of items) {
    const margin = item.margin ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const itemWidth = item.size.width + margin.left + margin.right;
    if (item.flex && item.flex > 0) {
      totalFlex += item.flex;
      flexItems.push(item);
    } else {
      totalFixedWidth += itemWidth;
    }
  }

  const remainingWidth = Math.max(0, innerWidth - totalFixedWidth - gap * (items.length - 1));
  const flexUnit = totalFlex > 0 ? remainingWidth / totalFlex : 0;

  let currentX = startX;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const margin = item.margin ?? { top: 0, right: 0, bottom: 0, left: 0 };
    let itemWidth = item.size.width + margin.left + margin.right;
    if (item.flex && item.flex > 0) {
      itemWidth = item.flex * flexUnit;
    }
    const itemHeight = item.size.height + margin.top + margin.bottom;
    let y = startY;
    switch (alignment) {
      case "center":
        y += (innerHeight - itemHeight) / 2;
        break;
      case "end":
        y += innerHeight - itemHeight;
        break;
      case "stretch":
        break;
      default:
        break;
    }
    positions.set(item.id, { x: currentX + margin.left, y: y + margin.top });
    currentX += itemWidth + gap;
  }

  return { positions, contentSize: { width: currentX - startX - gap + padding.left + padding.right, height: innerHeight + padding.top + padding.bottom } };
}

export function layoutColumn(items: readonly LayoutItem[], options: LayoutOptions): LayoutResult {
  const { gap, alignment, padding, containerSize, safeArea } = options;
  const innerWidth = containerSize.width - padding.left - padding.right - (safeArea?.left ?? 0) - (safeArea?.right ?? 0);
  const innerHeight = containerSize.height - padding.top - padding.bottom - (safeArea?.top ?? 0) - (safeArea?.bottom ?? 0);
  const startX = padding.left + (safeArea?.left ?? 0);
  const startY = padding.top + (safeArea?.top ?? 0);

  const positions = new Map<string, Point>();
  let totalFixedHeight = 0;
  let totalFlex = 0;
  const flexItems: LayoutItem[] = [];

  for (const item of items) {
    const margin = item.margin ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const itemHeight = item.size.height + margin.top + margin.bottom;
    if (item.flex && item.flex > 0) {
      totalFlex += item.flex;
      flexItems.push(item);
    } else {
      totalFixedHeight += itemHeight;
    }
  }

  const remainingHeight = Math.max(0, innerHeight - totalFixedHeight - gap * (items.length - 1));
  const flexUnit = totalFlex > 0 ? remainingHeight / totalFlex : 0;

  let currentY = startY;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const margin = item.margin ?? { top: 0, right: 0, bottom: 0, left: 0 };
    let itemHeight = item.size.height + margin.top + margin.bottom;
    if (item.flex && item.flex > 0) {
      itemHeight = item.flex * flexUnit;
    }
    const itemWidth = item.size.width + margin.left + margin.right;
    let x = startX;
    switch (alignment) {
      case "center":
        x += (innerWidth - itemWidth) / 2;
        break;
      case "end":
        x += innerWidth - itemWidth;
        break;
      case "stretch":
        break;
      default:
        break;
    }
    positions.set(item.id, { x: x + margin.left, y: currentY + margin.top });
    currentY += itemHeight + gap;
  }

  return { positions, contentSize: { width: innerWidth + padding.left + padding.right, height: currentY - startY - gap + padding.top + padding.bottom } };
}

export function layoutStack(items: readonly LayoutItem[], options: LayoutOptions): LayoutResult {
  const { alignment, padding, containerSize, safeArea } = options;
  const innerWidth = containerSize.width - padding.left - padding.right - (safeArea?.left ?? 0) - (safeArea?.right ?? 0);
  const innerHeight = containerSize.height - padding.top - padding.bottom - (safeArea?.top ?? 0) - (safeArea?.bottom ?? 0);
  const startX = padding.left + (safeArea?.left ?? 0);
  const startY = padding.top + (safeArea?.top ?? 0);

  const positions = new Map<string, Point>();
  for (const item of items) {
    const margin = item.margin ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const itemWidth = item.size.width + margin.left + margin.right;
    const itemHeight = item.size.height + margin.top + margin.bottom;
    let x = startX;
    let y = startY;
    switch (alignment) {
      case "center":
        x += (innerWidth - itemWidth) / 2;
        y += (innerHeight - itemHeight) / 2;
        break;
      case "end":
        x += innerWidth - itemWidth;
        y += innerHeight - itemHeight;
        break;
      case "stretch":
        break;
      default:
        break;
    }
    positions.set(item.id, { x: x + margin.left, y: y + margin.top });
  }

  return { positions, contentSize: { width: innerWidth + padding.left + padding.right, height: innerHeight + padding.top + padding.bottom } };
}

export function anchorPosition(
  containerSize: Size,
  elementSize: Size,
  anchor: "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right",
  margin: { top: number; right: number; bottom: number; left: number } = { top: 0, right: 0, bottom: 0, left: 0 },
): Point {
  let x = 0;
  let y = 0;
  switch (anchor) {
    case "top-left":
      x = margin.left;
      y = margin.top;
      break;
    case "top":
      x = (containerSize.width - elementSize.width) / 2;
      y = margin.top;
      break;
    case "top-right":
      x = containerSize.width - elementSize.width - margin.right;
      y = margin.top;
      break;
    case "left":
      x = margin.left;
      y = (containerSize.height - elementSize.height) / 2;
      break;
    case "center":
      x = (containerSize.width - elementSize.width) / 2;
      y = (containerSize.height - elementSize.height) / 2;
      break;
    case "right":
      x = containerSize.width - elementSize.width - margin.right;
      y = (containerSize.height - elementSize.height) / 2;
      break;
    case "bottom-left":
      x = margin.left;
      y = containerSize.height - elementSize.height - margin.bottom;
      break;
    case "bottom":
      x = (containerSize.width - elementSize.width) / 2;
      y = containerSize.height - elementSize.height - margin.bottom;
      break;
    case "bottom-right":
      x = containerSize.width - elementSize.width - margin.right;
      y = containerSize.height - elementSize.height - margin.bottom;
      break;
  }
  return { x, y };
}
export function rectArea(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

export function rectsOverlap(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function intersectRects(left: Rect, right: Rect): Rect | null {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const maxX = Math.min(left.x + left.width, right.x + right.width);
  const maxY = Math.min(left.y + left.height, right.y + right.height);
  if (maxX <= x || maxY <= y) return null;
  return { x, y, width: maxX - x, height: maxY - y };
}

export function expandRect(rect: Rect, padding: number): Rect {
  return { x: rect.x - padding, y: rect.y - padding, width: rect.width + padding * 2, height: rect.height + padding * 2 };
}

export function clipRectToBounds(rect: Rect, width: number, height: number): Rect | null {
  return intersectRects(rect, { x: 0, y: 0, width, height });
}

export function transformedAabb(bounds: Rect, transform: Transform): Rect {
  const anchorX = transform.anchorX * bounds.width;
  const anchorY = transform.anchorY * bounds.height;
  const radians = (transform.rotate * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: bounds.width, y: 0 },
    { x: bounds.width, y: bounds.height },
    { x: 0, y: bounds.height },
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    const scaledX = (corner.x - anchorX) * transform.scaleX;
    const scaledY = (corner.y - anchorY) * transform.scaleY;
    const rotatedX = scaledX * cos - scaledY * sin;
    const rotatedY = scaledX * sin + scaledY * cos;
    const x = bounds.x + transform.translateX + anchorX + rotatedX;
    const y = bounds.y + transform.translateY + anchorY + rotatedY;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function computeDirtyRect(
  previous: readonly Rect[],
  current: readonly Rect[],
  width: number,
  height: number,
  padding = 0,
): Rect | null {
  const union = unionRects([...previous, ...current]);
  if (!union) return null;
  return clipRectToBounds(expandRect(union, padding), width, height);
}

export function isFullFrameRect(rect: Rect, width: number, height: number): boolean {
  return rect.x <= 0 && rect.y <= 0 && rect.width >= width && rect.height >= height;
}
