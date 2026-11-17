import { Command } from "commander";
import { EXIT_CODES, ExitSignal } from "./exit-codes.js";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { renderStill } from "../renderer/engine.js";
import { loadComposition, selectComposition } from "./still.js";

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
  return path.join(projectDir, ".cinecode", "cache", "benchmarks", "history.json");
}

export function loadBenchmarkHistory(projectDir = process.cwd()): BenchmarkHistoryEntry[] {
  const p = getBenchmarkHistoryPath(projectDir);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}

export function saveBenchmarkRun(entry: BenchmarkHistoryEntry, projectDir = process.cwd()): void {
  const history = loadBenchmarkHistory(projectDir);
  history.push(entry);
  const p = getBenchmarkHistoryPath(projectDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(history, null, 2), "utf8");
}

export async function benchmarkComposition(
  file: string,
  options: { frames?: number; runs?: number; seed?: number; composition?: string },
): Promise<BenchmarkStats> {
  const composition = selectComposition(await loadComposition(file, options.composition), options.composition);
  const frames = Math.max(1, options.frames ?? 30);
  const runs = Math.max(1, options.runs ?? 3);
  const seed = options.seed ?? 0;
  const timings: number[] = [];
  let peakMemory = process.memoryUsage().rss;
  const started = performance.now();

  for (let run = 0; run < runs; run += 1) {
    for (let frame = 0; frame < frames; frame += 1) {
      const frameStart = performance.now();
      await renderStill(composition, frame, seed);
      timings.push(performance.now() - frameStart);
      peakMemory = Math.max(peakMemory, process.memoryUsage().rss);
    }
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
    workers: cpus().length,
    timestamp: new Date().toISOString(),
  };
}

export function createBenchmarkCommand(): Command {
  return new Command("benchmark")
    .description("Measure per-frame render time, peak memory and regression tracking")
    .argument("<composition>", "Composition file")
    .option("-c, --composition-name <name>", "Composition name")
    .option("-n, --frames <number>", "Frames per run", (value) => parseInt(value, 10), 30)
    .option("-r, --runs <number>", "Number of runs", (value) => parseInt(value, 10), 3)
    .option("--seed <number>", "Deterministic seed", (value) => parseInt(value, 10))
    .option("--compare-baseline", "Compare results against historical baseline", false)
    .option("--fail-on-regression", "Exit with error code 1 if performance regresses > 5%", false)
    .option("--save-baseline", "Save this benchmark run as official baseline", false)
    .action(async (file: string, options) => {
      console.log(`Benchmarking '${file}' (${options.frames} frames, ${options.runs} runs)...`);
      const stats = await benchmarkComposition(file, {
        frames: options.frames,
        runs: options.runs,
        seed: options.seed ?? 0,
        composition: options.compositionName,
      });

      console.log("\nBenchmark Results");
      console.log("-----------------");
      console.log(`Frames rendered: ${stats.frames}`);
      console.log(`Avg frame time:  ${stats.averageMs.toFixed(1)} ms (${(1000 / (stats.averageMs || 1)).toFixed(1)} fps)`);
      console.log(`Min / P95 / Max: ${stats.minMs.toFixed(1)} / ${stats.p95Ms.toFixed(1)} / ${stats.maxMs.toFixed(1)} ms`);
      console.log(`Peak memory:     ${stats.peakMemoryMb.toFixed(0)} MB`);
      console.log(`Workers:         ${stats.workers}`);
      console.log(`Total duration:  ${(stats.totalMs / 1000).toFixed(2)}s`);

      const history = loadBenchmarkHistory();
      const baseline = history.reverse().find((h) => h.file === file && (h.isBaseline || !options.compareBaseline));

      if (options.compareBaseline && baseline) {
        const timeDeltaPct = ((stats.averageMs - baseline.averageMs) / (baseline.averageMs || 1)) * 100;
        const memDeltaPct = ((stats.peakMemoryMb - baseline.peakMemoryMb) / (baseline.peakMemoryMb || 1)) * 100;

        console.log("\nBaseline Comparison:");
        console.log(`  Frame Time: ${timeDeltaPct <= 0 ? pc.green(`${timeDeltaPct.toFixed(1)}%`) : pc.red(`+${timeDeltaPct.toFixed(1)}%`)} (baseline: ${baseline.averageMs.toFixed(1)} ms)`);
        console.log(`  Memory RSS: ${memDeltaPct <= 0 ? pc.green(`${memDeltaPct.toFixed(1)}%`) : pc.red(`+${memDeltaPct.toFixed(1)}%`)} (baseline: ${baseline.peakMemoryMb.toFixed(0)} MB)`);

        if (timeDeltaPct > 5.0 || memDeltaPct > 10.0) {
          console.warn(pc.red(pc.bold("\n⚠ PERFORMANCE REGRESSION DETECTED!")));
          if (options.failOnRegression) {
            throw new ExitSignal(EXIT_CODES.runtime);
          }
        } else {
          console.log(pc.green("\n✔ No performance regressions detected."));
        }
      }

      saveBenchmarkRun({
        ...stats,
        file,
        isBaseline: Boolean(options.saveBaseline),
      });

      if (options.saveBaseline) {
        console.log(pc.green("✔ Saved run as new baseline record."));
      }
    });
}
