import type { AudioBuffer } from "./types.js";

/**
 * Metering and normalization. All functions are deterministic: same buffer in
 * yields same measurements/gain out. Measurement outputs feed automation
 * policies (silence detection, auto-leveling) in later phases.
 */

export interface PeakMeasurement {
  readonly peak: number;
  readonly peakDb: number;
  readonly channelPeaks: readonly number[];
}

export function measurePeaks(buffer: AudioBuffer): PeakMeasurement {
  const { channels, length, data } = buffer;
  const channelPeaks: number[] = Array.from({ length: channels }, () => 0);
  for (let i = 0; i < length; i += 1) {
    for (let ch = 0; ch < channels; ch += 1) {
      const magnitude = Math.abs(data[i * channels + ch] ?? 0);
      if (magnitude > channelPeaks[ch]!) channelPeaks[ch] = magnitude;
    }
  }
  const peak = Math.max(...channelPeaks, 0);
  return { peak, peakDb: toDb(peak), channelPeaks };
}

export interface RmsMeasurement {
  readonly rms: number;
  readonly rmsDb: number;
}

export function measureRms(buffer: AudioBuffer): RmsMeasurement {
  const { length, data } = buffer;
  if (length === 0) return { rms: 0, rmsDb: -Infinity };
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) sum += data[i]! * data[i]!;
  const rms = Math.sqrt(sum / length);
  return { rms, rmsDb: toDb(rms) };
}

export interface NormalizeOptions {
  readonly targetDb?: number;
}

/** Scale the buffer so its peak reaches targetDb (default -1 dBFS). */
export function normalizePeak(buffer: AudioBuffer, options: NormalizeOptions = {}): AudioBuffer {
  const targetDb = options.targetDb ?? -1;
  const { peak } = measurePeaks(buffer);
  if (peak === 0) return buffer;
  const target = fromDb(targetDb);
  const gain = target / peak;
  return scaleBuffer(buffer, gain);
}

/** Scale the buffer so its RMS reaches targetDb (default -18 dBFS RMS). */
export function normalizeRms(buffer: AudioBuffer, options: NormalizeOptions = {}): AudioBuffer {
  const targetDb = options.targetDb ?? -18;
  const { rms } = measureRms(buffer);
  if (rms === 0) return buffer;
  const target = fromDb(targetDb);
  const gain = target / rms;
  return scaleBuffer(buffer, gain);
}

/** Detect contiguous silent regions where RMS stays below thresholdDb for at least minDuration seconds. */
export interface SilenceRegion {
  readonly start: number;
  readonly end: number;
}

export interface SilenceDetectionOptions {
  readonly thresholdDb?: number;
  readonly minDuration?: number;
  readonly windowSize?: number;
}

export function detectSilence(buffer: AudioBuffer, options: SilenceDetectionOptions = {}): readonly SilenceRegion[] {
  const thresholdDb = options.thresholdDb ?? -40;
  const minDuration = options.minDuration ?? 0.1;
  const windowSize = options.windowSize ?? 1024;
  const { sampleRate, channels, length, data } = buffer;
  const threshold = fromDb(thresholdDb);
  const regions: SilenceRegion[] = [];
  let regionStart: number | null = null;
  for (let start = 0; start < length; start += windowSize) {
    const end = Math.min(length, start + windowSize);
    let sum = 0;
    let count = 0;
    for (let i = start; i < end; i += 1) {
      for (let ch = 0; ch < channels; ch += 1) {
        const sample = data[i * channels + ch] ?? 0;
        sum += sample * sample;
        count += 1;
      }
    }
    const rms = count > 0 ? Math.sqrt(sum / count) : 1;
    if (rms < threshold) {
      if (regionStart === null) regionStart = start;
    } else if (regionStart !== null) {
      pushRegion(regions, regionStart, start, sampleRate, minDuration);
      regionStart = null;
    }
  }
  if (regionStart !== null) pushRegion(regions, regionStart, length, sampleRate, minDuration);
  return regions;
}

export interface SilenceRemovalOptions extends SilenceDetectionOptions {
  /** Bridge non-silent gaps shorter than this (seconds) between silence regions. */
  readonly collapseGaps?: number;
}

/** Remove detected silence regions and return the compacted buffer plus the removed duration. */
export function removeSilence(
  buffer: AudioBuffer,
  options: SilenceRemovalOptions = {},
): { readonly buffer: AudioBuffer; readonly removedSeconds: number; readonly regions: readonly SilenceRegion[] } {
  let regions = detectSilence(buffer, options);
  if (options.collapseGaps && options.collapseGaps > 0) {
    regions = collapseGaps(regions, options.collapseGaps, buffer.sampleRate);
  }
  if (regions.length === 0) return { buffer, removedSeconds: 0, regions };
  const { sampleRate, channels, length, data } = buffer;
  const keep: SilenceRegion[] = [];
  let cursor = 0;
  for (const region of regions) {
    if (region.start > cursor) keep.push({ start: cursor, end: region.start });
    cursor = region.end;
  }
  if (cursor < length) keep.push({ start: cursor, end: length });
  let outLength = 0;
  for (const region of keep) outLength += region.end - region.start;
  const out = new Float32Array(outLength * channels);
  let write = 0;
  for (const region of keep) {
    const frameCount = region.end - region.start;
    out.set(data.subarray(region.start * channels, region.end * channels), write * channels);
    write += frameCount;
  }
  const removedSeconds = (length - outLength) / sampleRate;
  return { buffer: { sampleRate, channels, length: outLength, data: out }, removedSeconds, regions };
}

function pushRegion(
  regions: SilenceRegion[],
  start: number,
  end: number,
  sampleRate: number,
  minDuration: number,
): void {
  if ((end - start) / sampleRate >= minDuration) regions.push({ start, end });
}

/** Merge silence regions separated by gaps shorter than `maxGapSeconds`. */
function collapseGaps(regions: readonly SilenceRegion[], maxGapSeconds: number, sampleRate: number): readonly SilenceRegion[] {
  if (regions.length === 0) return regions;
  const maxGapSamples = maxGapSeconds * sampleRate;
  const sorted = [...regions].sort((a, b) => a.start - b.start);
  const merged: SilenceRegion[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (current.start - last.end <= maxGapSamples) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, current.end) };
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

export function scaleBuffer(buffer: AudioBuffer, gain: number): AudioBuffer {
  const { sampleRate, channels, length, data } = buffer;
  if (gain === 1) return buffer;
  const out = new Float32Array(data);
  for (let i = 0; i < out.length; i += 1) out[i] = data[i]! * gain;
  return { sampleRate, channels, length, data: out };
}

export function toDb(linear: number): number {
  return linear <= 0 ? -Infinity : 20 * Math.log10(linear);
}

export function fromDb(db: number): number {
  return 10 ** (db / 20);
}
