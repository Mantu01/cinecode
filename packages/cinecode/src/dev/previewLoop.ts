import type { Canvas } from "@napi-rs/canvas";
import type { Composition } from "../core/types/index.js";
import { renderFrame } from "../renderer/engine.js";
import { clampResolutionScale, qualityFromScale, type QualityLevel, type ResolutionScale } from "../renderer/scale.js";
import { frameToSeconds, createVfrConversion } from "../core/time/index.js";

export interface PreviewLoopMetrics {
  readonly fps: number;
  readonly frameTimeMs: number;
  readonly frame: number;
  readonly droppedFrames: number;
  readonly memoryBytes: number;
  readonly scale: ResolutionScale;
  readonly quality: QualityLevel;
  readonly averageFrameTimeMs: number;
}

export interface PreviewLoopOptions {
  readonly targetFps?: number;
  readonly seed?: number;
  readonly jpegQuality?: number;
  readonly minFps?: number;
  readonly adaptiveResolution?: boolean;
  readonly scale?: ResolutionScale | number;
  readonly refinementDelayMs?: number;
  readonly onMetrics?: (metrics: PreviewLoopMetrics) => void;
}

export interface PreviewFramePayload {
  readonly frame: number;
  readonly fps: number;
  readonly timestamp: number;
  readonly buffer: Buffer;
  readonly scale: ResolutionScale;
  readonly quality: QualityLevel;
  readonly refined: boolean;
}

const LATENCY_WINDOW = 12;
const REFINEMENT_DELAY_MS = 200;
const SCALE_STEPS: readonly ResolutionScale[] = [1, 0.5, 0.25, 0.1];

export class PreviewLoop {
  private readonly composition: Composition;
  private readonly options: PreviewLoopOptions;
  private readonly onFrame: (payload: PreviewFramePayload) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private refinementTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private paused = false;
  private frame = 0;
  private targetFps: number;
  private droppedFrames = 0;
  private lastFrameTime = 0;
  private windowStart = Date.now();
  private windowRendered = 0;
  private currentFps = 0;
  private scale: ResolutionScale;
  private readonly latencies: number[] = [];
  private lastNavigationAt = 0;
  private refinedForFrame = -1;

  constructor(composition: Composition, onFrame: (payload: PreviewFramePayload) => void, options: PreviewLoopOptions = {}) {
    this.composition = composition;
    this.onFrame = onFrame;
    this.options = options;
    this.targetFps = Math.max(1, Math.min(60, options.targetFps ?? 30));
    this.scale = clampResolutionScale(options.scale ?? 1);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.windowStart = Date.now();
    this.windowRendered = 0;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.refinementTimer) clearTimeout(this.refinementTimer);
    this.timer = null;
    this.refinementTimer = null;
  }

  setFps(fps: number): void {
    this.targetFps = Math.max(1, Math.min(60, Math.round(fps)));
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.lastNavigationAt = Date.now();
    if (paused) this.scheduleRefinement();
  }

  getScale(): ResolutionScale {
    return this.scale;
  }

  scrubTo(frame: number): void {
    const total = this.totalFrames();
    const target = Math.max(0, Math.min(Math.max(0, total - 1), Math.round(frame)));
    if (target === this.frame) return;
    this.frame = target;
    this.lastNavigationAt = Date.now();
    this.refinedForFrame = -1;
    this.scheduleRefinement();
  }

  getFrame(): number {
    return this.frame;
  }

  get fps(): number {
    return this.currentFps || this.targetFps;
  }

  totalFrames(): number {
    if (this.composition.duration !== undefined) {
      const duration = typeof this.composition.duration === "number"
        ? this.composition.duration
        : Number.parseFloat(this.composition.duration);
      return Math.max(1, Math.ceil(duration * this.composition.fps));
    }
    let frames = 0;
    for (const track of this.composition.rootTimeline.tracks) {
      if (track.kind === "audio") continue;
      for (const clip of track.clips) {
        const start = typeof clip.start === "number" ? clip.start : 0;
        const duration = typeof clip.duration === "number" ? clip.duration : 1;
        frames = Math.max(frames, Math.ceil((start + duration) * this.composition.fps));
      }
    }
    return Math.max(1, frames);
  }

  private schedule(): void {
    if (!this.running) return;
    const interval = 1000 / this.targetFps;
    const delay = Math.max(0, interval - this.lastFrameTime);
    this.timer = setTimeout(() => {
      void this.tick();
    }, delay);
  }

  private scheduleRefinement(): void {
    if (!this.running || !this.options.adaptiveResolution) return;
    if (this.refinementTimer) clearTimeout(this.refinementTimer);
    const delay = this.options.refinementDelayMs ?? REFINEMENT_DELAY_MS;
    this.refinementTimer = setTimeout(() => {
      void this.refine();
    }, delay);
  }

  private async refine(): Promise<void> {
    if (!this.running || this.paused) return;
    const frame = this.frame;
    if (this.refinedForFrame === frame || this.scale === 1) return;
    this.refinedForFrame = frame;
    try {
      const result = await renderFrame(this.composition, frame, this.options.seed ?? 0, { resolutionScale: 1 });
      const buffer = encodeJpeg(result.canvas, this.options.jpegQuality ?? 90);
      this.onFrame({
        frame,
        fps: this.targetFps,
        timestamp: Date.now(),
        buffer,
        scale: 1,
        quality: "full",
        refined: true,
      });
    } catch {
      this.droppedFrames += 1;
    }
  }

  private budgetMs(): number {
    return 1000 / this.targetFps;
  }

  private recordLatency(latency: number): void {
    this.latencies.push(latency);
    if (this.latencies.length > LATENCY_WINDOW) this.latencies.shift();
  }

  private averageLatency(): number {
    if (this.latencies.length === 0) return this.lastFrameTime;
    return this.latencies.reduce((sum, value) => sum + value, 0) / this.latencies.length;
  }

  private adaptResolution(): void {
    if (!this.options.adaptiveResolution) return;
    const average = this.averageLatency();
    const budget = this.budgetMs();
    const currentIndex = SCALE_STEPS.indexOf(this.scale);
    if (average > budget && currentIndex < SCALE_STEPS.length - 1) {
      this.scale = SCALE_STEPS[currentIndex + 1] ?? this.scale;
      this.latencies.length = 0;
      return;
    }
    if (average < budget * 0.35 && currentIndex > 0) {
      const fasterSamples = this.latencies.filter((value) => value < budget * 0.35).length;
      if (fasterSamples >= LATENCY_WINDOW - 1) {
        this.scale = SCALE_STEPS[currentIndex - 1] ?? this.scale;
        this.latencies.length = 0;
      }
    }
  }

  private async tick(): Promise<void> {
    if (!this.running || this.paused) {
      this.schedule();
      return;
    }
    const started = Date.now();
    try {
      const result = await renderFrame(this.composition, this.frame, this.options.seed ?? 0, { resolutionScale: this.scale });
      const buffer = encodeJpeg(result.canvas, this.options.jpegQuality ?? 70);
      this.onFrame({
        frame: this.frame,
        fps: this.targetFps,
        timestamp: started,
        buffer,
        scale: this.scale,
        quality: qualityFromScale(this.scale),
        refined: false,
      });
      this.windowRendered += 1;
      this.recordLatency(Date.now() - started);
      this.adapt();
      this.adaptResolution();
      this.frame += 1;
      if (this.frame >= this.totalFrames()) this.frame = 0;
    } catch {
      this.droppedFrames += 1;
      this.onFrame({
        frame: this.frame,
        fps: this.targetFps,
        timestamp: started,
        buffer: Buffer.alloc(0),
        scale: this.scale,
        quality: qualityFromScale(this.scale),
        refined: false,
      });
    }
    this.lastFrameTime = Date.now() - started;
    this.schedule();
  }

  private adapt(): void {
    const now = Date.now();
    if (now - this.windowStart < 2000) return;
    const rendered = this.windowRendered;
    const elapsed = (now - this.windowStart) / 1000;
    this.currentFps = rendered / Math.max(0.001, elapsed);
    const minFps = this.options.minFps ?? 5;
    if (this.currentFps < this.targetFps * 0.6 && this.targetFps > minFps) {
      this.targetFps = Math.max(minFps, Math.round(this.targetFps * 0.75));
    }
    this.options.onMetrics?.({
      fps: this.currentFps,
      frameTimeMs: this.lastFrameTime,
      frame: this.frame,
      droppedFrames: this.droppedFrames,
      memoryBytes: process.memoryUsage().heapUsed,
      scale: this.scale,
      quality: qualityFromScale(this.scale),
      averageFrameTimeMs: this.averageLatency(),
    });
    this.windowStart = now;
    this.windowRendered = 0;
  }
}

export function encodeJpeg(canvas: Canvas, quality: number): Buffer {
  return canvas.toBuffer("image/jpeg", Math.max(10, Math.min(100, quality)));
}

export function previewTimeSeconds(composition: Composition, frame: number): number {
  const conversion = composition.tempo && composition.tempo.length > 0
    ? createVfrConversion(composition.tempo, composition.fps)
    : null;
  return conversion ? frameToSeconds(frame, conversion) : frame / composition.fps;
}
