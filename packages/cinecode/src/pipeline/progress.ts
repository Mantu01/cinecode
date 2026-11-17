import { degradationCode, recordDegradation, recordWarning } from "../errors/degradations.js";

export type RenderStage = "preparing" | "rendering" | "mixing-audio" | "encoding" | "multiplexing" | "done";

export interface ProgressEvent {
  readonly type: "start" | "frame" | "progress" | "audio-start" | "audio-done" | "encoding" | "muxing" | "done" | "error" | "warning";
  readonly stage: RenderStage;
  readonly percent: number;
  readonly frame?: number;
  readonly totalFrames?: number;
  readonly fps?: number;
  readonly instantaneousFps?: number;
  readonly elapsedMs?: number;
  readonly remainingMs?: number;
  readonly cacheHitRatio?: number;
  readonly memoryBytes?: number;
  readonly message?: string;
}

export type ProgressHandler = (event: ProgressEvent) => void;

export interface ProgressReporterOptions {
  readonly totalFrames: number;
  readonly onProgress?: ProgressHandler;
  readonly silent?: boolean;
  readonly onWarning?: (message: string, stage: RenderStage) => void;
  readonly emaAlpha?: number;
  readonly windowSize?: number;
  readonly refreshIntervalMs?: number;
  readonly terminal?: boolean;
  readonly phaseWeights?: Partial<Record<RenderStage, number>>;
}

interface EmaState {
  value: number | null;
  samples: number;
}

const DEFAULT_EMA_ALPHA = 0.15;
const DEFAULT_WINDOW_SIZE = 50;
const DEFAULT_REFRESH_INTERVAL_MS = 500;

const DEFAULT_PHASE_WEIGHTS: Readonly<Record<RenderStage, number>> = {
  preparing: 0.01,
  rendering: 0.82,
  "mixing-audio": 0.08,
  encoding: 0.06,
  multiplexing: 0.03,
  done: 1,
};

function createEma(alpha: number): EmaState {
  return { value: null, samples: 0 };
}

function pushEma(state: EmaState, sample: number, alpha: number): void {
  if (!Number.isFinite(sample) || sample < 0) return;
  state.value = state.value === null ? sample : state.value + alpha * (sample - state.value);
  state.samples += 1;
}

function updateEma(state: EmaState, sample: number, alpha: number): number {
  pushEma(state, sample, alpha);
  return state.value ?? sample;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export class ProgressReporter {
  private readonly totalFrames: number;
  private readonly onProgress?: ProgressHandler;
  private readonly silent: boolean;
  private readonly onWarning?: (message: string, stage: RenderStage) => void;
  private readonly emaAlpha: number;
  private readonly windowSize: number;
  private readonly refreshIntervalMs: number;
  private readonly terminal: boolean;
  private readonly phaseWeights: Readonly<Record<RenderStage, number>>;
  private readonly startTime = Date.now();
  private frameCount = 0;
  private currentStage: RenderStage = "preparing";
  private lastReportTime = 0;
  private lastFrameAt = 0;
  private lastLineLength = 0;
  private readonly frameDurations: number[] = [];
  private readonly renderEma = createEma(DEFAULT_EMA_ALPHA);
  private readonly audioEma = createEma(0.25);
  private readonly encodeEma = createEma(0.25);
  private readonly muxEma = createEma(0.3);
  private cacheHits = 0;
  private cacheLookups = 0;
  private phaseStartedAt = Date.now();
  private instantFps = 0;

  constructor(options: ProgressReporterOptions) {
    this.totalFrames = options.totalFrames;
    this.onProgress = options.onProgress;
    this.silent = options.silent ?? false;
    this.onWarning = options.onWarning;
    this.emaAlpha = options.emaAlpha ?? DEFAULT_EMA_ALPHA;
    this.windowSize = Math.max(1, options.windowSize ?? DEFAULT_WINDOW_SIZE);
    this.refreshIntervalMs = Math.max(0, options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS);
    this.terminal = options.terminal ?? (!this.silent && process.stdout.isTTY === true);
    this.phaseWeights = { ...DEFAULT_PHASE_WEIGHTS, ...(options.phaseWeights ?? {}) };
  }

  setStage(stage: RenderStage): void {
    this.completePhase(this.currentStage);
    this.currentStage = stage;
    this.phaseStartedAt = Date.now();
    this.emit({ type: "progress", stage, percent: this.getPercent(), frame: this.frameCount, totalFrames: this.totalFrames, message: `Stage: ${stage}` });
  }

  private completePhase(stage: RenderStage): void {
    if (stage === "done" || stage === "preparing") return;
    const elapsed = Date.now() - this.phaseStartedAt;
    if (stage === "mixing-audio") updateEma(this.audioEma, elapsed, this.emaAlpha);
    if (stage === "encoding") updateEma(this.encodeEma, elapsed, this.emaAlpha);
    if (stage === "multiplexing") updateEma(this.muxEma, elapsed, this.emaAlpha);
  }

  reportFrame(frame: number): void {
    const now = Date.now();
    this.frameCount = frame + 1;
    if (this.lastFrameAt > 0) {
      const duration = now - this.lastFrameAt;
      this.frameDurations.push(duration);
      if (this.frameDurations.length > this.windowSize) this.frameDurations.shift();
      const blended = duration * 0.6 + median(this.frameDurations) * 0.4;
      updateEma(this.renderEma, blended, this.emaAlpha);
      this.instantFps = duration > 0 ? 1000 / duration : 0;
    }
    this.lastFrameAt = now;

    if (now - this.lastReportTime >= this.refreshIntervalMs) {
      this.emitProgress(now);
      this.lastReportTime = now;
    }
  }

  reportCacheStats(hits: number, lookups: number): void {
    this.cacheHits = Math.max(0, hits);
    this.cacheLookups = Math.max(0, lookups);
  }

  getInstantaneousFps(): number {
    return this.instantFps;
  }

  getAverageFps(): number {
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    return elapsedSeconds > 0 ? this.frameCount / elapsedSeconds : 0;
  }

  getEmaFrameMs(): number {
    return this.renderEma.value ?? 0;
  }

  estimateRemainingMs(): number {
    const remainingFrames = Math.max(0, this.totalFrames - this.frameCount);
    if (remainingFrames === 0) {
      return this.remainingPhaseMs();
    }
    const perFrame = this.renderEma.value ?? this.averageFrameMs();
    const windowed = median(this.frameDurations);
    const blended = perFrame * 0.7 + (windowed > 0 ? windowed * 0.3 : perFrame * 0.3);
    return Math.round(remainingFrames * Math.max(0, blended) + this.remainingPhaseMs());
  }

  private averageFrameMs(): number {
    const elapsed = Date.now() - this.startTime;
    return this.frameCount > 0 ? elapsed / this.frameCount : 0;
  }

  private remainingPhaseMs(): number {
    let total = 0;
    if (this.currentStage === "rendering" || this.currentStage === "preparing") {
      total += this.audioEma.value ?? 0;
      total += this.encodeEma.value ?? 0;
      total += this.muxEma.value ?? 0;
    }
    if (this.currentStage === "mixing-audio") {
      total += Math.max(0, (this.audioEma.value ?? 0) - (Date.now() - this.phaseStartedAt)) + (this.encodeEma.value ?? 0) + (this.muxEma.value ?? 0);
    }
    if (this.currentStage === "encoding") {
      total += Math.max(0, (this.encodeEma.value ?? 0) - (Date.now() - this.phaseStartedAt)) + (this.muxEma.value ?? 0);
    }
    if (this.currentStage === "multiplexing") {
      total += Math.max(0, (this.muxEma.value ?? 0) - (Date.now() - this.phaseStartedAt));
    }
    return total;
  }

  private emitProgress(now: number): void {
    const elapsedMs = now - this.startTime;
    const remainingMs = this.estimateRemainingMs();
    const averageFps = this.getAverageFps();
    this.emit({
      type: "frame",
      stage: this.currentStage,
      percent: this.getPercent(),
      frame: this.frameCount,
      totalFrames: this.totalFrames,
      fps: Math.round(averageFps * 10) / 10,
      instantaneousFps: Math.round(this.instantFps * 10) / 10,
      elapsedMs,
      remainingMs,
      cacheHitRatio: this.cacheLookups > 0 ? this.cacheHits / this.cacheLookups : undefined,
      memoryBytes: process.memoryUsage().heapUsed,
    });
    if (this.terminal) this.writeTerminalLine(elapsedMs, remainingMs);
  }

  reportAudioStart(): void {
    this.setStage("mixing-audio");
    this.emit({ type: "audio-start", stage: "mixing-audio", percent: this.getPercent(), frame: this.frameCount, totalFrames: this.totalFrames });
  }

  reportAudioDone(): void {
    this.completePhase("mixing-audio");
    this.emit({ type: "audio-done", stage: "mixing-audio", percent: this.getPercent(), frame: this.frameCount, totalFrames: this.totalFrames });
  }

  reportEncoding(): void {
    this.setStage("encoding");
    this.emit({ type: "encoding", stage: "encoding", percent: this.getPercent(), frame: this.frameCount, totalFrames: this.totalFrames });
  }

  reportMuxing(): void {
    this.setStage("multiplexing");
    this.emit({ type: "muxing", stage: "multiplexing", percent: this.getPercent(), frame: this.frameCount, totalFrames: this.totalFrames });
  }

  reportDone(outputPath: string, duration: number, fileSize: number, cacheReuse: number): void {
    this.setStage("done");
    const elapsedMs = Date.now() - this.startTime;
    if (this.terminal) this.clearTerminalLine();
    this.emit({
      type: "done",
      stage: "done",
      percent: 100,
      frame: this.totalFrames,
      totalFrames: this.totalFrames,
      elapsedMs,
      remainingMs: 0,
      message: `Output: ${outputPath} (${duration.toFixed(3)}s, ${(fileSize / 1024 / 1024).toFixed(2)}MB, cache reuse: ${cacheReuse.toFixed(1)}%)`,
    });
  }

  reportError(error: Error): void {
    if (this.terminal) this.clearTerminalLine();
    this.emit({ type: "error", stage: this.currentStage, percent: this.getPercent(), frame: this.frameCount, totalFrames: this.totalFrames, message: error.message });
  }

  reportWarning(message: string): void {
    recordWarning({ code: degradationCode(message), message });
    if (this.terminal) this.clearTerminalLine();
    this.emit({ type: "warning", stage: this.currentStage, percent: this.getPercent(), frame: this.frameCount, totalFrames: this.totalFrames, message });
    this.onWarning?.(message, this.currentStage);
  }

  reportDegradation(
    message: string,
    detail: { code: string; what: string; input?: string; instead: string },
  ): void {
    recordDegradation({
      code: String(detail.code),
      what: detail.what,
      reason: message,
      input: detail.input,
      instead: detail.instead,
    });
    this.reportWarning(message);
  }

  formatLine(elapsedMs: number, remainingMs: number): string {
    const percent = this.getPercent();
    const frameLabel = `${Math.min(this.frameCount, this.totalFrames)}/${this.totalFrames}`;
    const instant = Number.isFinite(this.instantFps) ? this.instantFps.toFixed(1) : "0.0";
    const average = this.getAverageFps().toFixed(1);
    const cacheRatio = this.cacheLookups > 0 ? `${Math.round((this.cacheHits / this.cacheLookups) * 100)}%` : "n/a";
    const memoryMb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0);
    return `${this.currentStage.padEnd(13)} ${String(percent).padStart(3)}% | frame ${frameLabel} | ${instant} fps now / ${average} fps avg | elapsed ${formatTime(elapsedMs)} | eta ${formatTime(remainingMs)} | cache ${cacheRatio} | heap ${memoryMb}MB`;
  }

  private writeTerminalLine(elapsedMs: number, remainingMs: number): void {
    const line = this.formatLine(elapsedMs, remainingMs);
    const padding = line.length >= this.lastLineLength ? "" : " ".repeat(this.lastLineLength - line.length);
    process.stdout.write(`\r${line}${padding}\x1b[K`);
    this.lastLineLength = line.length;
  }

  private clearTerminalLine(): void {
    if (this.lastLineLength === 0) return;
    process.stdout.write("\r\x1b[K");
    this.lastLineLength = 0;
  }

  private getPercent(): number {
    if (this.totalFrames === 0) return 100;
    return Math.min(100, Math.round((this.frameCount / this.totalFrames) * 100));
  }

  private emit(event: ProgressEvent): void {
    if (this.onProgress) this.onProgress(event);
  }

  getStats(): { elapsedMs: number; frameCount: number; avgFps: number; emaFrameMs: number; etaMs: number } {
    return {
      elapsedMs: Date.now() - this.startTime,
      frameCount: this.frameCount,
      avgFps: this.getAverageFps(),
      emaFrameMs: this.getEmaFrameMs(),
      etaMs: this.estimateRemainingMs(),
    };
  }

  getPhaseWeights(): Readonly<Record<RenderStage, number>> {
    return this.phaseWeights;
  }
}

export function createProgressReporter(options: ProgressReporterOptions): ProgressReporter {
  return new ProgressReporter(options);
}

export function formatTime(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
