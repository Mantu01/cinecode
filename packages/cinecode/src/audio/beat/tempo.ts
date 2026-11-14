import type { OnsetEvent } from "./onset.js";

export interface BeatEvent {
  readonly time: number;
  readonly intensity: number;
}

export interface TempoResult {
  readonly bpm: number;
  readonly confidence: number;
  readonly beats: readonly BeatEvent[];
  readonly phaseOffset: number;
}

export interface TempoOptions {
  readonly minBpm?: number;
  readonly maxBpm?: number;
}

export function estimateTempo(
  onsets: readonly OnsetEvent[],
  _sampleRate: number,
  options: TempoOptions = {},
): TempoResult {
  const minBpm = options.minBpm ?? 60;
  const maxBpm = options.maxBpm ?? 190;
  if (onsets.length < 2) {
    return { bpm: 0, confidence: 0, beats: [], phaseOffset: 0 };
  }

  const intervals: number[] = [];
  for (let i = 1; i < onsets.length; i += 1) {
    const interval = onsets[i]!.time - onsets[i - 1]!.time;
    if (interval > 0.05 && interval < 2) intervals.push(interval);
  }
  if (intervals.length === 0) return { bpm: 0, confidence: 0, beats: [], phaseOffset: 0 };

  const histogram = new Map<number, number>();
  for (const interval of intervals) {
    const bpm = 60 / interval;
    const bucket = Math.round(bpm / 2) * 2;
    histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
  }
  let bestBpm = 0;
  let bestCount = 0;
  for (const [bpm, count] of histogram) {
    if (bpm < minBpm || bpm > maxBpm) continue;
    if (count > bestCount) {
      bestCount = count;
      bestBpm = bpm;
    }
  }
  if (bestBpm === 0) {
    const sorted = [...histogram.entries()].sort((left, right) => right[1] - left[1]);
    const fallback = sorted[0]?.[0] ?? 120;
    bestBpm = Math.max(minBpm, Math.min(maxBpm, fallback));
    bestCount = sorted[0]?.[1] ?? 0;
  }

  const period = 60 / bestBpm;
  const first = onsets[0]!.time;
  const phaseOffset = ((first % period) + period) % period;
  const lastTime = onsets[onsets.length - 1]!.time;
  const beats = alignBeats(onsets, bestBpm, phaseOffset, lastTime);
  const confidence = Math.min(1, bestCount / Math.max(1, intervals.length));

  return { bpm: bestBpm, confidence, beats, phaseOffset };
}

function alignBeats(
  onsets: readonly OnsetEvent[],
  bpm: number,
  phaseOffset: number,
  lastTime: number,
): BeatEvent[] {
  const period = 60 / bpm;
  if (period <= 0) return [];
  const beats: BeatEvent[] = [];
  for (let time = phaseOffset; time <= lastTime + period; time += period) {
    let intensity = 0;
    for (const onset of onsets) {
      const delta = Math.abs(onset.time - time);
      if (delta <= period * 0.25) intensity = Math.max(intensity, onset.strength);
    }
    beats.push({ time: Math.max(0, time - period), intensity });
  }
  return beats;
}

export function tapTempo(timestamps: readonly number[]): number {
  if (timestamps.length < 2) return 0;
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    const interval = timestamps[i]! - timestamps[i - 1]!;
    if (interval > 0) intervals.push(interval);
  }
  if (intervals.length === 0) return 0;
  intervals.sort((left, right) => left - right);
  const median = intervals[Math.floor(intervals.length / 2)]!;
  return Math.round(60 / median);
}
