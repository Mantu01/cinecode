import type { SKRSContext2D } from "@napi-rs/canvas";

export type RegionFit = "cover" | "contain" | "fill";

export interface SplitRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Source track name. Takes precedence over `clipIndex`. */
  readonly track?: string;
  /** Legacy source track index, used by the layout presets. */
  readonly clipIndex: number;
  readonly fit?: RegionFit;
  readonly padding?: number;
  readonly roundedCorners?: number;
  readonly shadow?: boolean;
}

export interface ResolvedRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly track?: string;
  readonly clipIndex: number;
  readonly fit: RegionFit;
  readonly roundedCorners: number;
  readonly shadow: boolean;
}

export interface FitRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function resolveRegions(
  totalWidth: number,
  totalHeight: number,
  regionsConfig: readonly SplitRegion[],
  padding = 0,
): ResolvedRegion[] {
  return regionsConfig.map((region) => {
    const gap = Math.max(0, region.padding ?? padding);
    const inset = gap / 2;
    const rawX = region.x * totalWidth + (region.x > 0 ? inset : 0);
    const rawY = region.y * totalHeight + (region.y > 0 ? inset : 0);
    const spansRightEdge = region.x + region.width >= 1;
    const spansBottomEdge = region.y + region.height >= 1;
    const rawWidth = region.width * totalWidth - (spansRightEdge ? (region.x > 0 ? inset : 0) : gap);
    const rawHeight = region.height * totalHeight - (spansBottomEdge ? (region.y > 0 ? inset : 0) : gap);
    const x = clamp(rawX, 0, totalWidth - 1);
    const y = clamp(rawY, 0, totalHeight - 1);
    return {
      x,
      y,
      width: clamp(rawWidth, 1, totalWidth - x),
      height: clamp(rawHeight, 1, totalHeight - y),
      track: region.track,
      clipIndex: region.clipIndex,
      fit: region.fit ?? "cover",
      roundedCorners: Math.max(0, region.roundedCorners ?? 0),
      shadow: region.shadow ?? false,
    };
  });
}

export function computeFitRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  fit: RegionFit,
): FitRect {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  }
  if (fit === "fill") {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  }
  const scale = fit === "cover"
    ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
    : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

export function roundedRectPath(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  if (radius <= 0) {
    ctx.rect(x, y, width, height);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export function drawRegionShadow(ctx: SKRSContext2D, region: ResolvedRegion): void {
  if (!region.shadow) return;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = Math.max(8, Math.round(Math.min(region.width, region.height) * 0.03));
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = "#000000";
  roundedRectPath(ctx, region.x, region.y, region.width, region.height, region.roundedCorners);
  ctx.fill();
  ctx.restore();
}

export function drawSourceIntoRegion(
  ctx: SKRSContext2D,
  source: { readonly width: number; readonly height: number },
  region: ResolvedRegion,
): void {
  const rect = computeFitRect(source.width, source.height, region.width, region.height, region.fit);
  ctx.save();
  roundedRectPath(ctx, region.x, region.y, region.width, region.height, region.roundedCorners);
  ctx.clip();
  ctx.drawImage(
    source as never,
    region.x + rect.x,
    region.y + rect.y,
    rect.width,
    rect.height,
  );
  ctx.restore();
}

export function createSideBySide(padding = 0): SplitRegion[] {
  return [
    { x: 0, y: 0, width: 0.5, height: 1, clipIndex: 0, fit: "cover", padding },
    { x: 0.5, y: 0, width: 0.5, height: 1, clipIndex: 1, fit: "cover", padding },
  ];
}

export function createPiP(insetRatio = 0.25, padding = 0): SplitRegion[] {
  const margin = 0.03;
  return [
    { x: 0, y: 0, width: 1, height: 1, clipIndex: 0, fit: "fill", padding },
    {
      x: 1 - insetRatio - margin,
      y: 1 - insetRatio - margin,
      width: insetRatio,
      height: insetRatio,
      clipIndex: 1,
      fit: "cover",
      padding,
      roundedCorners: 12,
      shadow: true,
    },
  ];
}

export function createGrid(cols: number, rows: number, padding = 0): SplitRegion[] {
  const regions: SplitRegion[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      regions.push({
        x: col / cols,
        y: row / rows,
        width: 1 / cols,
        height: 1 / rows,
        clipIndex: row * cols + col,
        fit: "cover",
        padding,
      });
    }
  }
  return regions;
}

export function createThirds(direction: "vertical" | "horizontal" = "vertical", padding = 0): SplitRegion[] {
  return [0, 1, 2].map((index) => ({
    x: direction === "vertical" ? index / 3 : 0,
    y: direction === "vertical" ? 0 : index / 3,
    width: direction === "vertical" ? 1 / 3 : 1,
    height: direction === "vertical" ? 1 : 1 / 3,
    clipIndex: index,
    fit: "cover" as const,
    padding,
  }));
}

export type SplitLayoutPreset =
  | "side-by-side"
  | "pip"
  | "grid-2x2"
  | "grid-3x3"
  | "thirds-vertical"
  | "thirds-horizontal"
  | "custom";

export function resolveLayout(layout: SplitLayoutPreset, padding = 0): SplitRegion[] {
  switch (layout) {
    case "side-by-side":
      return createSideBySide(padding);
    case "pip":
      return createPiP(0.25, padding);
    case "grid-2x2":
      return createGrid(2, 2, padding);
    case "grid-3x3":
      return createGrid(3, 3, padding);
    case "thirds-vertical":
      return createThirds("vertical", padding);
    case "thirds-horizontal":
      return createThirds("horizontal", padding);
    case "custom":
      return [];
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
