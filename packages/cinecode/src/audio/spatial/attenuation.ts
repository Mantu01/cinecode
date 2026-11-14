export interface SpatialPosition {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly maxDistance?: number;
  readonly rolloffFactor?: number;
}

export interface AttenuationResult {
  readonly gain: number;
  readonly distance: number;
  readonly lowPass: number;
}

export function sourceDistance(position: SpatialPosition): number {
  const x = position.x ?? 0;
  const y = position.y ?? 0;
  const z = position.z ?? 0;
  return Math.hypot(x, y, z);
}

export function computeDistanceAttenuation(
  distance: number,
  maxDistance = Number.POSITIVE_INFINITY,
  rolloffFactor = 1,
): number {
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) {
    return 1 / (1 + Math.max(0, rolloffFactor) * Math.max(0, distance));
  }
  if (distance >= maxDistance) return 0;
  if (rolloffFactor <= 0) return 1;
  const clamped = Math.min(distance / maxDistance, 0.999);
  const inverse = 1 / (1 + rolloffFactor * distance);
  const edgeFade = 1 - clamped * clamped;
  return Math.max(0, Math.min(1, inverse * edgeFade + (1 - clamped) * 0.15));
}

export function perceptualAttenuation(
  distance: number,
  maxDistance = Number.POSITIVE_INFINITY,
  rolloffFactor = 1,
): number {
  if (distance <= 1) return 1;
  if (distance >= maxDistance) return 0;
  const near = 1;
  const far = Math.max(0, 1 - Math.log(distance) / Math.log(Math.max(2, maxDistance)));
  return Math.max(0, Math.min(near, far * Math.max(0.05, 1 - rolloffFactor * 0.1)));
}

export function airAbsorption(distance: number, maxDistance = Number.POSITIVE_INFINITY): number {
  const normalized = Number.isFinite(maxDistance) ? Math.min(1, distance / Math.max(1, maxDistance)) : Math.min(1, distance / 30);
  return Math.max(0.15, 1 - normalized * 0.85);
}

export function spatialAttenuation(position: SpatialPosition): AttenuationResult {
  const distance = sourceDistance(position);
  const gain = computeDistanceAttenuation(distance, position.maxDistance, position.rolloffFactor ?? 1);
  return { gain, distance, lowPass: airAbsorption(distance, position.maxDistance) };
}

export function onePoleCoefficient(cutoffHz: number, sampleRate: number): number {
  const clamped = Math.max(20, Math.min(sampleRate / 2 - 1, cutoffHz));
  return Math.exp((-2 * Math.PI * clamped) / sampleRate);
}
