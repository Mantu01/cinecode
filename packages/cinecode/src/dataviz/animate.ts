import type { ChartLayout, BarChartLayout, LineChartLayout, ScatterPlotLayout } from "./layout.js";
import { easeOutCubic } from "../core/easing/index.js";

export function interpolateChartData(layout: ChartLayout, progress: number): ChartLayout {
  const eased = easeOutCubic(progress);
  if (layout.type === "bar") return interpolateBarChart(layout, eased);
  if (layout.type === "line") return interpolateLineChart(layout, eased);
  return interpolateScatterPlot(layout, eased);
}

function interpolateBarChart(layout: BarChartLayout, eased: number): BarChartLayout {
  const bars = layout.bars.map((bar) => {
    if (bar.y < layout.zeroY) {
      const grown = (layout.zeroY - bar.y) * eased;
      return { ...bar, y: layout.zeroY - grown, height: grown };
    }
    return { ...bar, height: bar.height * eased };
  });
  return { ...layout, bars };
}

function interpolateLineChart(layout: LineChartLayout, eased: number): LineChartLayout {
  const points = layout.points.map((point) => ({
    ...point,
    y: layout.zeroY + (point.y - layout.zeroY) * eased,
  }));
  return { ...layout, points };
}

function interpolateScatterPlot(layout: ScatterPlotLayout, eased: number): ScatterPlotLayout {
  const points = layout.points.map((point) => ({
    ...point,
    y: layout.zeroY + (point.y - layout.zeroY) * eased,
    radius: point.radius * eased,
  }));
  return { ...layout, points };
}
