export interface BudgetRow {
  readonly id: string;
  readonly name: string;
  readonly category: "speed" | "memory" | "size" | "quality" | "concurrency";
  readonly fixture: string;
  readonly threshold: number;
  readonly baseline: number;
  readonly unit: "ms" | "MB" | "KB" | "files" | "ratio" | "delta" | "copies";
  readonly blocking: boolean;
  readonly comparison: "max" | "min"; // max: measured <= threshold, min: measured >= threshold
}

export const BUDGET_TABLE: readonly BudgetRow[] = [
  {
    id: "cold-start-version",
    name: "CLI --version cold start",
    category: "speed",
    fixture: "cinecode --version",
    threshold: 2500,
    baseline: 200,
    unit: "ms",
    blocking: true,
    comparison: "max",
  },
  {
    id: "cold-start-help",
    name: "CLI --help cold start",
    category: "speed",
    fixture: "cinecode --help",
    threshold: 2500,
    baseline: 205,
    unit: "ms",
    blocking: true,
    comparison: "max",
  },
  {
    id: "cold-start-still",
    name: "1-frame still render cold start",
    category: "speed",
    fixture: "cinecode still --file fixture.js -f 0",
    threshold: 5000,
    baseline: 2800,
    unit: "ms",
    blocking: true,
    comparison: "max",
  },
  {
    id: "render-1080p-10s-memory",
    name: "1080p 10s peak memory",
    category: "memory",
    fixture: "1920x1080 30fps 300 frames render",
    threshold: 1400,
    baseline: 1130,
    unit: "MB",
    blocking: true,
    comparison: "max",
  },
  {
    id: "render-4k-memory",
    name: "4K short render peak memory",
    category: "memory",
    fixture: "3840x2160 24 frames render",
    threshold: 1500,
    baseline: 1280,
    unit: "MB",
    blocking: true,
    comparison: "max",
  },
  {
    id: "multi-worker-scaling",
    name: "Multi-worker scaling factor",
    category: "concurrency",
    fixture: "4 workers vs 1 worker throughput",
    threshold: 1.3,
    baseline: 2.1,
    unit: "ratio",
    blocking: true,
    comparison: "min",
  },
  {
    id: "frame-copies-per-frame",
    name: "Main thread pixel copies per frame",
    category: "memory",
    fixture: "Zero main-thread pixel copy (transfer only)",
    threshold: 0,
    baseline: 0,
    unit: "copies",
    blocking: true,
    comparison: "max",
  },
  {
    id: "cache-byte-limits",
    name: "Renderer cache post-job retention",
    category: "memory",
    fixture: "ByteBoundedCache empties between jobs",
    threshold: 0,
    baseline: 0,
    unit: "MB",
    blocking: true,
    comparison: "max",
  },
  {
    id: "tarball-size",
    name: "Framework packed tarball size",
    category: "size",
    fixture: "npm pack packages/cinecode",
    threshold: 750,
    baseline: 699,
    unit: "KB",
    blocking: true,
    comparison: "max",
  },
  {
    id: "tarball-files",
    name: "Framework packed file count",
    category: "size",
    fixture: "npm pack file count",
    threshold: 900,
    baseline: 879,
    unit: "files",
    blocking: true,
    comparison: "max",
  },
  {
    id: "audio-ceiling",
    name: "Audio mix limiter peak clamp",
    category: "quality",
    fixture: "60s hot audio mix",
    threshold: 0.95,
    baseline: 0.95,
    unit: "ratio",
    blocking: true,
    comparison: "max",
  },
  {
    id: "golden-exact-tolerance",
    name: "Visual golden exact feature tolerance",
    category: "quality",
    fixture: "Gradients, shapes, alpha, split-screen",
    threshold: 0,
    baseline: 0,
    unit: "delta",
    blocking: true,
    comparison: "max",
  },
  {
    id: "golden-text-tolerance",
    name: "Visual golden rasterized text tolerance",
    category: "quality",
    fixture: "Subpixel text rendering",
    threshold: 2,
    baseline: 0,
    unit: "delta",
    blocking: true,
    comparison: "max",
  },
];

export interface BenchmarkMeasurement {
  readonly id: string;
  readonly measured: number;
  readonly baseline: number;
  readonly threshold: number;
  readonly unit: string;
  readonly passed: boolean;
  readonly blocking: boolean;
}

export function evaluateBudget(row: BudgetRow, measured: number): BenchmarkMeasurement {
  const passed = row.comparison === "max" ? measured <= row.threshold : measured >= row.threshold;
  return {
    id: row.id,
    measured,
    baseline: row.baseline,
    threshold: row.threshold,
    unit: row.unit,
    passed,
    blocking: row.blocking,
  };
}

export function formatBudgetComparison(measurement: BenchmarkMeasurement): string {
  const status = measurement.passed ? "PASS" : measurement.blocking ? "FAIL" : "WARN";
  const diffPct = (((measurement.measured - measurement.baseline) / (measurement.baseline || 1)) * 100).toFixed(1);
  const sign = Number(diffPct) > 0 ? "+" : "";
  return `[${status}] ${measurement.id}: measured ${measurement.measured} ${measurement.unit} (baseline: ${measurement.baseline} ${measurement.unit}, delta: ${sign}${diffPct}%, threshold: ${measurement.threshold} ${measurement.unit})`;
}
