export type ResolutionScale = 1 | 0.5 | 0.25 | 0.1;

export type QualityLevel = "full" | "half" | "quarter" | "thumbnail";

/** Supported preview scales. Rendering always happens at full layout size. */
export const QUALITY_SCALES: Readonly<Record<QualityLevel, ResolutionScale>> = {
  full: 1,
  half: 0.5,
  quarter: 0.25,
  thumbnail: 0.1,
};

export function qualityFromScale(scale: number): QualityLevel {
  if (scale >= 0.9) return "full";
  if (scale >= 0.45) return "half";
  if (scale >= 0.2) return "quarter";
  return "thumbnail";
}

/** Snaps to one of the documented scales; all layout stays resolution-independent. */
export function clampResolutionScale(scale: number): ResolutionScale {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  if (scale >= 0.9) return 1;
  if (scale >= 0.45) return 0.5;
  if (scale >= 0.2) return 0.25;
  return 0.1;
}
