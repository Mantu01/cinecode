export interface ChartDataPoint {
  readonly label: string;
  readonly value: number;
}

export interface ChartLayoutOptions {
  readonly padding?: number;
  readonly barGapRatio?: number;
  readonly showValues?: boolean;
}

export interface BarChartLayout {
  readonly type: "bar";
  readonly bars: readonly {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly label: string;
    readonly value: number;
  }[];
  readonly maxValue: number;
  readonly minValue: number;
  readonly zeroY: number;
  readonly ticks: readonly ChartTick[];
  readonly xTicks: readonly ChartTickX[];
  readonly plotArea: { x: number; y: number; width: number; height: number };
}

export interface ChartTick {
  readonly value: number;
  readonly y: number;
}

export interface ChartTickX {
  readonly value: number;
  readonly position: number;
}

export interface LineChartLayout {
  readonly type: "line";
  readonly points: readonly { x: number; y: number; label: string; value: number }[];
  readonly maxValue: number;
  readonly minValue: number;
  readonly zeroY: number;
  readonly ticks: readonly ChartTick[];
  readonly xTicks: readonly ChartTickX[];
  readonly plotArea: { x: number; y: number; width: number; height: number };
}

export interface ScatterPlotLayout {
  readonly type: "scatter";
  readonly points: readonly {
    x: number;
    y: number;
    label: string;
    value: number;
    radius: number;
  }[];
  readonly maxValue: number;
  readonly minValue: number;
  readonly zeroY: number;
  readonly ticks: readonly ChartTick[];
  readonly xTicks: readonly ChartTickX[];
  readonly plotArea: { x: number; y: number; width: number; height: number };
}

export type ChartLayout = BarChartLayout | LineChartLayout | ScatterPlotLayout;

function xTicksForCount(count: number): readonly ChartTickX[] {
  const positions: ChartTickX[] = [];
  const last = Math.max(0, count - 1);
  const step = Math.max(1, Math.floor(count / 5));
  for (let i = 0; i < count; i += step) {
    positions.push({ value: i, position: last === 0 ? 0 : i / last });
  }
  if (positions[positions.length - 1]?.value !== last) {
    positions.push({ value: last, position: 1 });
  }
  return positions;
}

export function normalizeChartData(
  data: readonly number[] | ReadonlyArray<{ label: string; value: number }>,
): ChartDataPoint[] {
  if (data.length === 0) return [];
  if (typeof data[0] === "number") {
    return (data as readonly number[]).map((value, index) => ({
      label: String(index),
      value,
    }));
  }
  return (data as ReadonlyArray<{ label: string; value: number }>).map((point) => ({
    label: point.label,
    value: point.value,
  }));
}

function plotArea(
  width: number,
  height: number,
  options: ChartLayoutOptions,
): { x: number; y: number; width: number; height: number } {
  const padding = options.padding ?? Math.max(16, Math.min(width, height) * 0.08);
  return {
    x: padding,
    y: padding,
    width: Math.max(1, width - padding * 2),
    height: Math.max(1, height - padding * 2),
  };
}

function dataRange(points: readonly ChartDataPoint[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    min = Math.min(min, point.value);
    max = Math.max(max, point.value);
  }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 0;
  }
  if (min >= 0) min = 0;
  if (max <= 0) max = 0;
  if (min === max) {
    max = min + 1;
  }
  return { min, max };
}

export function niceTicks(min: number, max: number, targetCount = 5): readonly number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const rawStep = span / Math.max(1, targetCount);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const stepMultiplier = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
  const step = stepMultiplier * magnitude;
  const ticks: number[] = [];
  const epsilon = step * 1e-6;
  let tick = Math.ceil((min + epsilon) / step) * step;
  while (tick <= max + epsilon) {
    ticks.push(Math.round(tick * 1e6) / 1e6);
    tick += step;
  }
  return ticks;
}

function scaleToArea(
  min: number,
  max: number,
  area: { x: number; y: number; width: number; height: number },
): {
  zeroY: number;
  ticks: readonly ChartTick[];
  toY: (value: number) => number;
} {
  const toY = (value: number): number =>
    area.y + area.height - ((value - min) / (max - min)) * area.height;
  const tickValues = niceTicks(min, max);
  const zeroY = toY(Math.min(Math.max(0, min), max));
  return { zeroY, ticks: tickValues.map((value) => ({ value, y: toY(value) })), toY };
}

export function layoutBarChart(
  data: readonly ChartDataPoint[],
  width: number,
  height: number,
  options: ChartLayoutOptions = {},
): BarChartLayout {
  const area = plotArea(width, height, options);
  const { min, max } = dataRange(data);
  const { zeroY, ticks, toY } = scaleToArea(min, max, area);
  const gapRatio = options.barGapRatio ?? 0.2;
  const slot = area.width / Math.max(1, data.length);
  const barWidth = slot * (1 - gapRatio);
  const bars = data.map((point, index) => {
    const valueY = toY(point.value);
    return {
      x: area.x + index * slot + (slot - barWidth) / 2,
      y: Math.min(valueY, zeroY),
      width: barWidth,
      height: Math.abs(zeroY - valueY),
      label: point.label,
      value: point.value,
    };
  });
  return {
    type: "bar",
    bars,
    maxValue: max,
    minValue: min,
    zeroY,
    ticks,
    plotArea: area,
    xTicks: xTicksForCount(data.length),
  };
}
export function layoutLineChart(
  data: readonly ChartDataPoint[],
  width: number,
  height: number,
  options: ChartLayoutOptions = {},
): LineChartLayout {
  const area = plotArea(width, height, options);
  const { min, max } = dataRange(data);
  const { zeroY, ticks, toY } = scaleToArea(min, max, area);
  const count = Math.max(1, data.length - 1);
  const points = data.map((point, index) => ({
    x: area.x + (index / count) * area.width,
    y: toY(point.value),
    label: point.label,
    value: point.value,
  }));
  return {
    type: "line",
    points,
    maxValue: max,
    minValue: min,
    zeroY,
    ticks,
    plotArea: area,
    xTicks: xTicksForCount(data.length),
  };
}
export function layoutScatterPlot(
  data: readonly ChartDataPoint[],
  width: number,
  height: number,
  options: ChartLayoutOptions = {},
): ScatterPlotLayout {
  const area = plotArea(width, height, options);
  const { min, max } = dataRange(data);
  const { zeroY, ticks, toY } = scaleToArea(min, max, area);
  const count = Math.max(1, data.length - 1);
  const baseRadius = Math.min(area.width, area.height) * 0.02;
  const points = data.map((point, index) => ({
    x: area.x + (index / count) * area.width,
    y: toY(point.value),
    label: point.label,
    value: point.value,
    radius: Math.max(2, baseRadius * Math.sqrt(Math.abs(point.value) / Math.max(1, Math.abs(max)))),
  }));
  return {
    type: "scatter",
    points,
    maxValue: max,
    minValue: min,
    zeroY,
    ticks,
    plotArea: area,
    xTicks: xTicksForCount(data.length),
  };
}

export function layoutChart(
  data: readonly number[] | ReadonlyArray<{ label: string; value: number }>,
  chartType: "bar" | "line" | "scatter",
  width: number,
  height: number,
  options: ChartLayoutOptions = {},
): ChartLayout {
  const points = normalizeChartData(data);
  if (chartType === "line") return layoutLineChart(points, width, height, options);
  if (chartType === "scatter") return layoutScatterPlot(points, width, height, options);
  return layoutBarChart(points, width, height, options);
}
