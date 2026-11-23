import { Command } from "commander";
import { createError, ErrorCode } from "../../errors/codes.js";
import { runReport } from "../output/run-report.js";
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import fs from "node:fs";
import path from "node:path";
import { pc } from "../output/palette.js";
import type { Composition } from "../../core/types/index.js";
import { createProjectResolver } from "../resolve/project-resolver.js";
import { loadComposition, selectComposition } from "../resolve/composition-loader.js";
import { assembleTimelineComposition } from "../../manifest/index.js";
import { createChunks, createWorkerManager } from "../../pipeline/workers.js";

export interface BenchmarkStats {
  readonly frames: number;
  readonly runs: number;
  readonly minMs: number;
  readonly averageMs: number;
  readonly maxMs: number;
  readonly p95Ms: number;
  readonly peakMemoryMb: number;
  readonly totalMs: number;
  readonly workers: number;
  readonly timestamp?: string;
}

export interface BenchmarkHistoryEntry extends BenchmarkStats {
  file: string;
  isBaseline?: boolean;
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index]!;
}

export function getBenchmarkHistoryPath(projectDir = process.cwd()): string {
  return path.join(projectDir, ".cinecode", "benchmarks", "history.json");
}

export function loadBenchmarkHistory(projectDir = process.cwd()): BenchmarkHistoryEntry[] {
  const file = getBenchmarkHistoryPath(projectDir);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as BenchmarkHistoryEntry[];
  } catch {
    return [];
  }
}

export function saveBenchmarkRun(entry: BenchmarkHistoryEntry, projectDir = process.cwd()): void {
  const history = loadBenchmarkHistory(projectDir);
  history.push(entry);
  const file = getBenchmarkHistoryPath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(history, null, 2), "utf8");
}

export async function benchmarkComposition(
  composition: Composition,
  cacheDir: string,
  options: { frames?: number; runs?: number; seed?: number; concurrency?: number },
): Promise<BenchmarkStats> {
  const frames = Math.max(1, options.frames ?? 30);
  const runs = Math.max(1, options.runs ?? 3);
  const seed = options.seed ?? 0;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? cpus().length, frames));
  const timings: number[] = [];
  let peakMemory = process.memoryUsage().rss;
  const started = performance.now();

  for (let run = 0; run < runs; run += 1) {
    const manager = createWorkerManager({ concurrency, composition, seed, cacheDir });
    const runStart = performance.now();
    try {
      const chunks = createChunks(frames, Math.max(1, Math.ceil(frames / concurrency)));
      await manager.processChunks(chunks, () => {
        peakMemory = Math.max(peakMemory, process.memoryUsage().rss);
      });
    } finally {
      await manager.terminate();
    }
    const elapsed = performance.now() - runStart;
    timings.push(elapsed / frames);
    peakMemory = Math.max(peakMemory, process.memoryUsage().rss);
  }

  const sorted = [...timings].sort((left, right) => left - right);
  const total = timings.reduce((sum, value) => sum + value, 0);
  return {
    frames: frames * runs,
    runs,
    minMs: sorted[0] ?? 0,
    averageMs: total / Math.max(1, timings.length),
    maxMs: sorted[sorted.length - 1] ?? 0,
    p95Ms: percentile(sorted, 0.95),
    peakMemoryMb: peakMemory / (1024 * 1024),
    totalMs: performance.now() - started,
    workers: concurrency,
    timestamp: new Date().toISOString(),
  };
}

interface BenchmarkOptions {
  root?: string;
  config?: string;
  frames?: number;
  runs?: number;
  seed?: number;
  compositionName?: string;
  compareBaseline?: boolean;
  failOnRegression?: boolean;
  saveBaseline?: boolean;
  dryRun?: boolean;
  concurrency?: number;
}

async function resolveBenchmarkComposition(
  file: string | undefined,
  options: BenchmarkOptions,
): Promise<{ composition: Composition; cacheDir: string; root: string; label: string }> {
  if (file) {
    const abs = path.resolve(options.root ?? process.cwd(), file);
    const selected = selectComposition(await loadComposition(abs), options.compositionName);
    const resolution = await createProjectResolver({ root: options.root, config: options.config }).resolve();
    return { composition: selected, cacheDir: resolution.context.roots.cache, root: resolution.root, label: file };
  }
  const resolution = await createProjectResolver({ root: options.root, config: options.config, requireSelection: false }).resolve();
  const selected = await resolution.selected();
  const composition = selected[0] ?? (resolution.manifest?.manifest.timelines?.[0]
    ? await assembleTimelineComposition(resolution.manifest, resolution.manifest.manifest.timelines[0].id)
    : undefined);
  if (!composition) {
    throw createError(ErrorCode.CC1010, {
      path: resolution.manifestPath,
      reason: "benchmark needs a file or a project with at least one timeline",
    });
  }
  return { composition, cacheDir: resolution.context.roots.cache, root: resolution.root, label: composition.name };
}

export async function benchmarkCommand(
  fileOrOptions?: string | BenchmarkOptions,
  maybeOptions?: BenchmarkOptions,
  maybeContext?: import("../gate/preflight.js").PreflightContext,
): Promise<void> {
  const isFile = typeof fileOrOptions === "string";
  const options = (isFile ? (maybeOptions ?? {}) : (fileOrOptions ?? maybeOptions ?? {})) as BenchmarkOptions;
  const file = isFile ? fileOrOptions : undefined;
  const contextCandidates = isFile ? [maybeContext] : [maybeOptions, maybeContext];
  const context = contextCandidates.find(
    (candidate): candidate is import("../gate/preflight.js").PreflightContext =>
      typeof candidate === "object" && candidate !== null && "resolution" in candidate,
  );
  const { composition, cacheDir, root, label } = await resolveBenchmarkComposition(file, {
    ...options,
    root: options.root ?? context?.resolution?.root,
    config: options.config ?? context?.resolution?.configPath,
  });
  const frames = options.frames ?? 60;
  const runs = options.runs ?? 3;
  if (!runReport.isMachine()) runReport.diagnostic(`Benchmarking '${label}' (${frames} frames, ${runs} runs)...`);
  const stats = await benchmarkComposition(composition, cacheDir, {
    frames,
    runs,
    seed: options.seed ?? 42,
    concurrency: options.concurrency,
  });

  if (!runReport.isMachine()) {
    runReport.diagnostic("\nBenchmark Results");
    runReport.diagnostic("-----------------");
    runReport.diagnostic(`Frames rendered: ${stats.frames}`);
    runReport.diagnostic(`Avg frame time:  ${stats.averageMs.toFixed(1)} ms (${(1000 / (stats.averageMs || 1)).toFixed(1)} fps)`);
    runReport.diagnostic(`Min / P95 / Max: ${stats.minMs.toFixed(1)} / ${stats.p95Ms.toFixed(1)} / ${stats.maxMs.toFixed(1)} ms`);
    runReport.diagnostic(`Peak memory:     ${stats.peakMemoryMb.toFixed(0)} MB`);
    runReport.diagnostic(`Workers:         ${stats.workers}`);
    runReport.diagnostic(`Total duration:  ${(stats.totalMs / 1000).toFixed(2)}s`);
  }

  const writeHistory = !options.dryRun && !runReport.isMachine();
  const history = writeHistory ? loadBenchmarkHistory(root) : [];
  const baseline = [...history].reverse().find((entry) => entry.file === label);

  if (options.compareBaseline && baseline) {
    const timeDeltaPct = ((stats.averageMs - baseline.averageMs) / (baseline.averageMs || 1)) * 100;
    const memDeltaPct = ((stats.peakMemoryMb - baseline.peakMemoryMb) / (baseline.peakMemoryMb || 1)) * 100;
    if (!runReport.isMachine()) {
      runReport.diagnostic("\nBaseline Comparison:");
      runReport.diagnostic(`  Frame Time: ${timeDeltaPct <= 0 ? pc.green(`${timeDeltaPct.toFixed(1)}%`) : pc.red(`+${timeDeltaPct.toFixed(1)}%`)} (baseline: ${baseline.averageMs.toFixed(1)} ms)`);
      runReport.diagnostic(`  Memory RSS: ${memDeltaPct <= 0 ? pc.green(`${memDeltaPct.toFixed(1)}%`) : pc.red(`+${memDeltaPct.toFixed(1)}%`)} (baseline: ${baseline.peakMemoryMb.toFixed(0)} MB)`);
    }
    if (options.failOnRegression && (timeDeltaPct > 5.0 || memDeltaPct > 10.0)) {
      throw createError(ErrorCode.CC9002, { reason: `frame time ${timeDeltaPct.toFixed(1)}%, memory ${memDeltaPct.toFixed(1)}% over baseline` });
    }
  } else if (options.compareBaseline && !runReport.isMachine()) {
    runReport.diagnostic(pc.yellow("\nNo baseline found; run again with --save-baseline."));
  }

  runReport.result({
    frames: stats.frames,
    averageMs: stats.averageMs,
    peakMemoryMb: stats.peakMemoryMb,
    workers: stats.workers,
    dryRun: options.dryRun === true,
  });

  if (writeHistory) {
    saveBenchmarkRun({ ...stats, file: label, isBaseline: Boolean(options.saveBaseline) }, root);
    if (options.saveBaseline) runReport.diagnostic(pc.green("✔ Saved run as new baseline record."));
  }
}

