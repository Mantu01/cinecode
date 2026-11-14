import type { Composition, Clip } from "../core/types/index.js";

export type ResolutionScale = 1 | 0.5 | 0.25 | 0.1;

export type QualityLevel = "full" | "half" | "quarter" | "thumbnail";

export const QUALITY_SCALES: Readonly<Record<QualityLevel, ResolutionScale>> = {
  full: 1,
  half: 0.5,
  quarter: 0.25,
  thumbnail: 0.1,
};

const SCALED_NUMERIC_KEYS = new Set([
  "width",
  "height",
  "fontSize",
  "maxWidth",
  "letterSpacing",
  "radius",
  "radiusX",
  "radiusY",
  "cx",
  "cy",
  "blur",
  "offsetX",
  "offsetY",
  "extrusionDepth",
  "bevelDepth",
  "roundedCorners",
  "strokeWidth",
  "size",
  "padding",
  "barWidth",
  "barGap",
]);

const NESTED_SCALED_KEYS: Readonly<Record<string, readonly string[]>> = {
  transform: ["x", "y"],
  stroke: ["width", "blur"],
  shadow: ["blur", "offsetX", "offsetY"],
  dropShadow: ["blur", "offsetX", "offsetY"],
};

const UNSCALED_OBJECT_KEYS = new Set(["crop", "params", "buffer", "data"]);

export function qualityFromScale(scale: number): QualityLevel {
  if (scale >= 0.9) return "full";
  if (scale >= 0.45) return "half";
  if (scale >= 0.2) return "quarter";
  return "thumbnail";
}

export function clampResolutionScale(scale: number): ResolutionScale {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  if (scale >= 0.9) return 1;
  if (scale >= 0.45) return 0.5;
  if (scale >= 0.2) return 0.25;
  return 0.1;
}

function scaleValue(value: number, scale: number): number {
  return value * scale;
}

function scaleRecord(value: unknown, scale: number): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => scaleRecord(entry, scale));
  }
  if (value === null || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (UNSCALED_OBJECT_KEYS.has(key)) {
      result[key] = entry;
      continue;
    }
    if (typeof entry === "number" && SCALED_NUMERIC_KEYS.has(key)) {
      result[key] = scaleValue(entry, scale);
      continue;
    }
    const nestedKeys = NESTED_SCALED_KEYS[key];
    if (nestedKeys && entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      const nestedSource = entry as Record<string, unknown>;
      const nested: Record<string, unknown> = { ...nestedSource };
      for (const nestedKey of nestedKeys) {
        const candidate = nestedSource[nestedKey];
        if (typeof candidate === "number") nested[nestedKey] = scaleValue(candidate, scale);
      }
      result[key] = nested;
      continue;
    }
    if (key === "mask" && entry !== null && typeof entry === "object") {
      const mask = entry as { shape?: unknown; [k: string]: unknown };
      result[key] = mask.shape === undefined
        ? entry
        : { ...mask, shape: scaleRecord(mask.shape, scale) };
      continue;
    }
    result[key] = entry;
  }
  return result;
}

export function scaleClipGeometry(clip: Clip, scale: number): Clip {
  if (scale === 1) return clip;
  return scaleRecord(clip, scale) as Clip;
}

export function scaleComposition(composition: Composition, scale: number): Composition {
  if (scale === 1) return composition;
  const width = Math.max(1, Math.round(composition.width * scale));
  const height = Math.max(1, Math.round(composition.height * scale));
  const tracks = composition.rootTimeline.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => scaleClipGeometry(clip, scale)),
  }) as typeof track);
  return {
    ...composition,
    width,
    height,
    rootTimeline: { ...composition.rootTimeline, tracks },
    ...(composition.splitScreen
      ? { splitScreen: { ...composition.splitScreen, padding: (composition.splitScreen.padding ?? 0) * scale } }
      : {}),
  };
}
