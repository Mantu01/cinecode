import type { SKRSContext2D } from "@napi-rs/canvas";
import type { BarChartLayout, LineChartLayout, ScatterPlotLayout, ChartLayout } from "./layout.js";
import { getColor } from "./palette.js";

export interface ChartRenderOptions {
  readonly colors?: readonly string[];
  readonly lineWidth?: number;
  readonly pointRadius?: number;
  readonly showGrid?: boolean;
  readonly showAxes?: boolean;
  readonly showValues?: boolean;
  readonly labelColor?: string;
}

export function drawChart(ctx: SKRSContext2D, layout: ChartLayout, options: ChartRenderOptions = {}): void {
  drawAxesAndGrid(ctx, layout, options);
  if (layout.type === "bar") drawBarChart(ctx, layout, options);
  else if (layout.type === "line") drawLineChart(ctx, layout, options);
  else drawScatterPlot(ctx, layout, options);
}

function drawAxesAndGrid(ctx: SKRSContext2D, layout: ChartLayout, options: ChartRenderOptions): void {
  const { plotArea, zeroY } = layout;
  const gridColor = "rgba(128, 128, 128, 0.25)";
  const axisColor = "rgba(128, 128, 128, 0.6)";
  if (options.showGrid !== false) {
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (const tick of layout.ticks) {
      ctx.beginPath();
      ctx.moveTo(plotArea.x, tick.y);
      ctx.lineTo(plotArea.x + plotArea.width, tick.y);
      ctx.stroke();
    }
  }
  if (options.showAxes !== false) {
    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotArea.x, plotArea.y);
    ctx.lineTo(plotArea.x, plotArea.y + plotArea.height);
    ctx.lineTo(plotArea.x + plotArea.width, plotArea.y + plotArea.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(plotArea.x, zeroY);
    ctx.lineTo(plotArea.x + plotArea.width, zeroY);
    ctx.stroke();
  }
  ctx.fillStyle = options.labelColor ?? "rgba(160, 160, 160, 0.9)";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const tick of layout.ticks) {
    ctx.fillText(formatTickLabel(tick.value), plotArea.x - 4, tick.y);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
}

function formatTickLabel(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

export function drawBarChart(ctx: SKRSContext2D, layout: BarChartLayout, options: ChartRenderOptions = {}): void {
  for (let i = 0; i < layout.bars.length; i += 1) {
    const bar = layout.bars[i]!;
    if (bar.height <= 0) continue;
    ctx.fillStyle = getColor(i, options.colors);
    ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
    if (options.showValues === true) {
      ctx.fillStyle = options.labelColor ?? "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = bar.y < layout.zeroY ? "bottom" : "top";
      ctx.font = "11px sans-serif";
      ctx.fillText(formatTickLabel(bar.value), bar.x + bar.width / 2, bar.y < layout.zeroY ? bar.y - 2 : bar.y + bar.height + 2);
    }
    ctx.fillStyle = options.labelColor ?? "rgba(160, 160, 160, 0.9)";
    ctx.textBaseline = "top";
    ctx.font = "10px sans-serif";
    ctx.fillText(bar.label, bar.x + bar.width / 2, layout.zeroY + 4);
  }
}

export function drawLineChart(ctx: SKRSContext2D, layout: LineChartLayout, options: ChartRenderOptions = {}): void {
  const points = layout.points;
  if (points.length === 0) return;
  if (points.length > 1) {
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i]!.x, points[i]!.y);
    }
    ctx.strokeStyle = getColor(0, options.colors);
    ctx.lineWidth = options.lineWidth ?? 2;
    ctx.stroke();
  }
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]!;
    ctx.beginPath();
    ctx.arc(point.x, point.y, options.pointRadius ?? 3, 0, Math.PI * 2);
    ctx.fillStyle = getColor(i, options.colors);
    ctx.fill();
  }
}

export function drawScatterPlot(ctx: SKRSContext2D, layout: ScatterPlotLayout, options: ChartRenderOptions = {}): void {
  for (let i = 0; i < layout.points.length; i += 1) {
    const point = layout.points[i]!;
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(1, options.pointRadius !== undefined ? options.pointRadius : point.radius), 0, Math.PI * 2);
    ctx.fillStyle = getColor(i, options.colors);
    ctx.fill();
  }
}

export function drawNoData(ctx: SKRSContext2D, width: number, height: number): void {
  ctx.fillStyle = "rgba(128, 128, 128, 0.8)";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("No data", width / 2, height / 2);
}
