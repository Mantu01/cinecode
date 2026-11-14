import { createConversion, type FrameConversion } from "./convert.js";

export interface TempoRegion {
  readonly start: number;
  readonly end: number;
  readonly fps: number;
}

export interface TempoMap {
  readonly regions: readonly TempoRegion[];
  readonly defaultFps: number;
}

export function normalizeTempoRegions(regions: readonly TempoRegion[], defaultFps: number): TempoMap {
  const sorted = [...regions]
    .filter((region) => region.end > region.start && region.fps > 0)
    .sort((left, right) => left.start - right.start);
  if (sorted.length === 0) {
    return { regions: [{ start: 0, end: Number.POSITIVE_INFINITY, fps: defaultFps }], defaultFps };
  }
  const normalized: TempoRegion[] = [];
  let cursor = 0;
  for (const region of sorted) {
    if (region.start > cursor) {
      normalized.push({ start: cursor, end: region.start, fps: defaultFps });
    }
    normalized.push({ start: Math.max(cursor, region.start), end: region.end, fps: region.fps });
    cursor = region.end;
  }
  if (Number.isFinite(cursor)) {
    normalized.push({ start: cursor, end: Number.POSITIVE_INFINITY, fps: defaultFps });
  }
  return { regions: normalized, defaultFps };
}

export function getTempoAt(regions: readonly TempoRegion[], timeSeconds: number, fallback: number): number {
  for (const region of regions) {
    if (timeSeconds >= region.start && timeSeconds < region.end) return region.fps;
  }
  const last = regions[regions.length - 1];
  return last && Number.isFinite(last.end) === false ? last.fps : fallback;
}

export function framesToTime(regions: readonly TempoRegion[], frameNumber: number, fallback: number): number {
  if (regions.length === 0) return frameNumber / fallback;
  let remaining = Math.max(0, frameNumber);
  for (const region of regions) {
    const span = region.end - region.start;
    const frames = Number.isFinite(span) ? Math.ceil(span * region.fps) : Number.POSITIVE_INFINITY;
    if (remaining < frames || !Number.isFinite(frames)) {
      return region.start + remaining / region.fps;
    }
    remaining -= frames;
  }
  return frameNumber / fallback;
}

export function timeToFrames(regions: readonly TempoRegion[], timeSeconds: number, fallback: number): number {
  if (regions.length === 0) return timeSeconds * fallback;
  let frame = 0;
  const time = Math.max(0, timeSeconds);
  for (const region of regions) {
    if (time <= region.start) break;
    const regionEnd = Math.min(region.end, time);
    frame += (regionEnd - region.start) * region.fps;
    if (time <= region.end) return frame;
  }
  return frame;
}

export function tempoDuration(regions: readonly TempoRegion[], fallbackDuration: number): number {
  if (regions.length === 0) return fallbackDuration;
  const finite = regions.filter((region) => Number.isFinite(region.end));
  if (finite.length === 0) return fallbackDuration;
  return Math.max(...finite.map((region) => region.end));
}

export function createTempoMap(regions: readonly TempoRegion[], defaultFps: number): TempoMap {
  return normalizeTempoRegions(regions, defaultFps);
}

export function attachTempo(conversion: FrameConversion, tempo: TempoMap): FrameConversion {
  return {
    ...conversion,
    tempo,
    getTempo: (time: number) => getTempoAt(tempo.regions, time, tempo.defaultFps),
  };
}

export function createVfrConversion(regions: readonly TempoRegion[], defaultFps: number): FrameConversion {
  return attachTempo(createConversion(defaultFps), createTempoMap(regions, defaultFps));
}

export function frameToSeconds(frameNumber: number, conversion: FrameConversion): number {
  const tempo = conversion.tempo;
  if (!tempo) return frameNumber / conversion.fpsFloat;
  return framesToTime(tempo.regions, frameNumber, conversion.fpsFloat);
}

export function secondsToFrame(timeSeconds: number, conversion: FrameConversion): number {
  const tempo = conversion.tempo;
  if (!tempo) return Math.round(timeSeconds * conversion.fpsFloat);
  return Math.round(timeToFrames(tempo.regions, timeSeconds, conversion.fpsFloat));
}

export function durationInFrames(durationSeconds: number, conversion: FrameConversion): number {
  return Math.ceil(secondsToFrame(durationSeconds, conversion));
}
