import type { AudioTrack, Timeline } from "../core/types/tracks.js";
import type { AudioVisualizerClip } from "../core/types/clips.js";

export function resolveAudioTrack(ref: string, timeline: Timeline): AudioTrack | undefined {
  for (const track of timeline.tracks) {
    if (track.kind === "audio" && track.name === ref) {
      return track;
    }
  }
  return undefined;
}

export type VisualizerType = AudioVisualizerClip["vizType"];
export type VisualizerFrequencyScale = NonNullable<AudioVisualizerClip["frequencyScale"]>;

export interface VisualizerBar {
  readonly index: number;
  readonly magnitude: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface VisualizerPoint {
  readonly index: number;
  readonly amplitude: number;
  readonly x: number;
  readonly y: number;
}

export interface VisualizerRadialPoint {
  readonly index: number;
  readonly magnitude: number;
  readonly angle: number;
  readonly radius: number;
  readonly x: number;
  readonly y: number;
}

export interface VisualizerLayout {
  readonly type: VisualizerType;
  readonly bars?: readonly VisualizerBar[];
  readonly waveform?: readonly VisualizerPoint[];
  readonly radial?: readonly VisualizerRadialPoint[];
}

export interface VisualizerLayoutOptions {
  readonly barWidth?: number;
  readonly barGap?: number;
  readonly mirror?: boolean;
}

export function normalizeBands(bands: ArrayLike<number>): number[] {
  let max = 0;
  for (let i = 0; i < bands.length; i += 1) max = Math.max(max, bands[i]!);
  const out: number[] = new Array(bands.length);
  if (max <= 0) {
    out.fill(0);
    return out;
  }
  for (let i = 0; i < bands.length; i += 1) out[i] = bands[i]! / max;
  return out;
}

export function smoothBands(current: ArrayLike<number>, previous: ArrayLike<number> | undefined, smoothing: number): Float32Array {
  if (smoothing <= 0 || previous === undefined) return current instanceof Float32Array ? current : Float32Array.from(current);
  const factor = Math.min(1, Math.max(0, smoothing));
  const blended = new Float32Array(current.length);
  for (let i = 0; i < current.length; i += 1) {
    blended[i] = previous[i]! + (current[i]! - previous[i]!) * (1 - factor);
  }
  return blended;
}

export function layoutBars(bands: ArrayLike<number>, width: number, height: number, options: VisualizerLayoutOptions = {}): VisualizerLayout {
  const count = bands.length;
  const gap = Math.max(0, options.barGap ?? 2);
  const barWidth = Math.max(1, options.barWidth ?? (width - (count - 1) * gap) / count);
  const normalized = normalizeBands(bands);
  const bars: VisualizerBar[] = [];
  const baseline = options.mirror === true ? height / 2 : height;
  for (let i = 0; i < count; i += 1) {
    const barHeight = normalized[i]! * (options.mirror === true ? height / 2 : height);
    const x = i * (barWidth + gap);
    bars.push({
      index: i,
      magnitude: normalized[i]!,
      x,
      y: baseline - barHeight,
      width: barWidth,
      height: barHeight,
    });
    if (options.mirror === true) {
      bars.push({ index: i, magnitude: normalized[i]!, x, y: baseline, width: barWidth, height: barHeight });
    }
  }
  return { type: "bars", bars };
}

export function layoutWaveform(samples: ArrayLike<number>, width: number, height: number, options: VisualizerLayoutOptions = {}): VisualizerLayout {
  const points: VisualizerPoint[] = [];
  const mid = height / 2;
  let max = 0;
  for (let i = 0; i < samples.length; i += 1) max = Math.max(max, Math.abs(samples[i]!));
  const scale = max > 0 ? (mid - 2) / max : 0;
  const count = samples.length;
  for (let i = 0; i < width; i += 1) {
    const position = count <= 1 ? 0 : (i / (width - 1)) * (count - 1);
    const left = Math.floor(position);
    const right = Math.min(count - 1, left + 1);
    const t = position - left;
    const amplitude = samples[left]! * (1 - t) + samples[right]! * t;
    const y = mid - amplitude * scale;
    points.push({ index: i, amplitude, x: i, y });
    if (options.mirror === true) {
      points.push({ index: i, amplitude: -amplitude, x: i, y: mid + (mid - y) });
    }
  }
  return { type: "waveform", waveform: points };
}

export function layoutRadial(bands: ArrayLike<number>, width: number, height: number, options: VisualizerLayoutOptions = {}, type: VisualizerType = "radial"): VisualizerLayout {
  const count = bands.length;
  const normalized = normalizeBands(bands);
  const cx = width / 2;
  const cy = height / 2;
  const minSide = Math.min(width, height);
  const baseRadius = minSide * 0.15;
  const maxExtent = minSide * 0.35;
  const radial: VisualizerRadialPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const radius = baseRadius + normalized[i]! * maxExtent;
    radial.push({
      index: i,
      magnitude: normalized[i]!,
      angle,
      radius,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }
  if (options.mirror === true) {
    for (let i = 0; i < count; i += 1) {
      const point = radial[i]!;
      radial.push({ ...point, index: count + i, angle: point.angle + Math.PI, x: cx - (point.x - cx), y: cy - (point.y - cy) });
    }
  }
  return { type, radial };
}
