import { cpus } from "node:os";
import type { Composition } from "../core/types/index.js";

export type WorkloadClass = "cpu-bound" | "io-bound" | "balanced";

export interface WorkloadProfile {
  readonly classification: WorkloadClass;
  readonly cpuScore: number;
  readonly ioScore: number;
  readonly layerCount: number;
  readonly mediaClipCount: number;
  readonly proceduralClipCount: number;
  readonly effectCount: number;
}

const IO_CLIP_TYPES = new Set(["video", "chromakey", "mesh-warp", "audioVisualizer"]);
const MEDIA_CLIP_TYPES = new Set(["image", "svg", "sticker"]);
const CPU_CLIP_TYPES = new Set(["particles", "noise", "model3d", "multiCamera", "text3d", "gradient-mesh", "dataviz", "audio-visualizer"]);

const IO_WEIGHT = 2;
const CPU_WEIGHT = 1.5;
const EFFECT_WEIGHT = 0.5;

export interface WorkloadAnalysisOptions {
  readonly fromFrame?: number;
  readonly toFrame?: number;
}

function clipSpanRange(clip: { start?: number | string; duration?: number | string; end?: number | string }, fps: number): { start: number; end: number } {
  const start = typeof clip.start === "number" ? clip.start : Number.parseFloat(String(clip.start ?? 0)) || 0;
  let end: number;
  if (typeof clip.end === "number") end = clip.end;
  else if (typeof clip.duration === "number") end = start + clip.duration;
  else end = Number.parseFloat(String(clip.end ?? clip.duration ?? 0)) || start + 1;
  return { start: Math.floor(start * fps), end: Math.ceil(end * fps) };
}

export function analyzeWorkload(
  composition: Composition,
  options: WorkloadAnalysisOptions = {},
): WorkloadProfile {
  const fromFrame = options.fromFrame ?? 0;
  const toFrame = options.toFrame ?? Number.POSITIVE_INFINITY;
  let mediaClipCount = 0;
  let proceduralClipCount = 0;
  let effectCount = 0;
  let layerCount = 0;

  for (const track of composition.rootTimeline.tracks) {
    if (track.kind === "audio") continue;
    for (const clip of track.clips) {
      const span = clipSpanRange(clip as { start?: number | string; duration?: number | string; end?: number | string }, composition.fps);
      if (span.end < fromFrame || span.start > toFrame) continue;
      layerCount += 1;
      const typed = clip as { type: string; effects?: readonly unknown[]; preprocess?: unknown };
      if (IO_CLIP_TYPES.has(typed.type) || (typed.type === "video" && typed.preprocess !== undefined)) mediaClipCount += 1;
      else if (MEDIA_CLIP_TYPES.has(typed.type)) mediaClipCount += 0.5;
      if (CPU_CLIP_TYPES.has(typed.type)) proceduralClipCount += 1;
      effectCount += typed.effects?.length ?? 0;
    }
  }
  effectCount += (composition.postProcessing?.effects ?? []).filter((effect) => effect.enabled !== false).length;

  const cpuScore = proceduralClipCount * CPU_WEIGHT + effectCount * EFFECT_WEIGHT + layerCount * 0.1;
  const ioScore = mediaClipCount * IO_WEIGHT;
  const classification: WorkloadClass = ioScore > cpuScore * 1.5
    ? "io-bound"
    : cpuScore > ioScore * 1.5
      ? "cpu-bound"
      : "balanced";

  return {
    classification,
    cpuScore,
    ioScore,
    layerCount,
    mediaClipCount,
    proceduralClipCount,
    effectCount,
  };
}

export interface TuningLimits {
  readonly cpuCount?: number;
  readonly minWorkers?: number;
  readonly maxWorkers?: number;
}

export interface TuningResult {
  readonly concurrency: number;
  readonly classification: WorkloadClass;
  readonly reason: string;
}

export function tuneConcurrency(profile: WorkloadProfile, limits: TuningLimits = {}): TuningResult {
  const cpuCount = Math.max(1, limits.cpuCount ?? cpus().length);
  const minWorkers = Math.max(1, limits.minWorkers ?? 1);
  const maxWorkers = Math.max(minWorkers, limits.maxWorkers ?? cpuCount);
  const clamp = (value: number): number => Math.max(minWorkers, Math.min(maxWorkers, value));

  switch (profile.classification) {
    case "io-bound":
      return {
        concurrency: clamp(Math.min(4, Math.max(2, Math.floor(cpuCount / 3)))),
        classification: profile.classification,
        reason: "I/O-bound segment: limited concurrency avoids disk seek thrashing and descriptor saturation",
      };
    case "cpu-bound":
      return {
        concurrency: clamp(cpuCount),
        classification: profile.classification,
        reason: "CPU-bound segment: one worker per logical core",
      };
    default:
      return {
        concurrency: clamp(Math.max(2, cpuCount - 1)),
        classification: profile.classification,
        reason: "Balanced segment: cores minus one leaves headroom for the encoder and main thread",
      };
  }
}

export function tuneConcurrencyForComposition(
  composition: Composition,
  options: WorkloadAnalysisOptions & TuningLimits = {},
): TuningResult {
  return tuneConcurrency(analyzeWorkload(composition, options), options);
}

export class ConcurrencyTuner {
  private readonly limits: TuningLimits;
  private lastResult: TuningResult | null = null;

  constructor(limits: TuningLimits = {}) {
    this.limits = limits;
  }

  tune(composition: Composition, options: WorkloadAnalysisOptions = {}): TuningResult {
    this.lastResult = tuneConcurrencyForComposition(composition, { ...this.limits, ...options });
    return this.lastResult;
  }

  getLastResult(): TuningResult | null {
    return this.lastResult;
  }
}

export function createConcurrencyTuner(limits: TuningLimits = {}): ConcurrencyTuner {
  return new ConcurrencyTuner(limits);
}
