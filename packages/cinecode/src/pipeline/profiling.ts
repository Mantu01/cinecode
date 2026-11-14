/**
 * Render profiling: per-stage timing, bottleneck identification, and render
 * time estimation. Deterministic in its accounting — same stage timings yield
 * the same report. The pipeline records stage durations; the reporter turns
 * them into a summary.
 */

export type ProfilableStage = "decode" | "render" | "encode" | "mux" | "audio" | "other";

export interface StageTiming {
  readonly stage: ProfilableStage;
  readonly totalMs: number;
  readonly count: number;
}

export interface RenderProfile {
  readonly stages: readonly StageTiming[];
  readonly totalMs: number;
  /** Stage consuming the largest share of wall time. */
  readonly bottleneck: ProfilableStage | null;
}

export interface RenderProfiler {
  start(): void;
  end(): void;
  /** Time a synchronous section and attribute it to a stage. */
  measure<T>(stage: ProfilableStage, fn: () => T): T;
  /** Time an async section and attribute it to a stage. */
  measureAsync<T>(stage: ProfilableStage, fn: () => Promise<T>): Promise<T>;
  report(): RenderProfile;
}

export function createRenderProfiler(): RenderProfiler {
  const totals = new Map<ProfilableStage, { ms: number; count: number }>();
  let startedAt = 0;
  let endedAt = 0;

  const add = (stage: ProfilableStage, ms: number): void => {
    const entry = totals.get(stage) ?? { ms: 0, count: 0 };
    entry.ms += ms;
    entry.count += 1;
    totals.set(stage, entry);
  };

  return {
    start() {
      startedAt = performance.now();
    },
    end() {
      endedAt = performance.now();
    },
    measure(stage, fn) {
      const t0 = performance.now();
      try {
        return fn();
      } finally {
        add(stage, performance.now() - t0);
      }
    },
    async measureAsync(stage, fn) {
      const t0 = performance.now();
      try {
        return await fn();
      } finally {
        add(stage, performance.now() - t0);
      }
    },
    report() {
      const stages: StageTiming[] = [...totals.entries()]
        .map(([stage, entry]) => ({ stage, totalMs: entry.ms, count: entry.count }))
        .sort((a, b) => b.totalMs - a.totalMs);
      const totalMs = stages.reduce((sum, s) => sum + s.totalMs, 0);
      return { stages, totalMs, bottleneck: stages[0]?.stage ?? null };
    },
  };
}

/**
 * Estimate total render time from frames completed so far. Returns
 * milliseconds, or null when no frames have completed yet.
 */
export function estimateRenderTimeMs(completedFrames: number, totalFrames: number, elapsedMs: number): number | null {
  if (completedFrames <= 0 || totalFrames <= 0) return null;
  const perFrame = elapsedMs / completedFrames;
  return perFrame * totalFrames;
}

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const LEVEL_ORDER: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

/** True when a message at `level` should be emitted under `configured` level. */
export function shouldLog(level: LogLevel, configured: LogLevel): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[configured] && configured !== "silent";
}
