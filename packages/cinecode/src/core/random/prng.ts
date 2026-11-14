export type SeededRandom = {
  next: () => number;
  int: (maxExclusive: number) => number;
  range: (min: number, max: number) => number;
  pick: <T>(values: readonly T[]) => T;
  state: () => number;
};

export function random(seed: number): SeededRandom {
  if (!Number.isInteger(seed) || seed < 0) {
    throw new RangeError(`random() seed must be a whole number >= 0, got ${seed}`);
  }
  let state = seed >>> 0 || 0x9e3779b9;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    z = (z ^ (z >>> 15)) >>> 0;
    return z / 0x100000000;
  };
  return {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    range: (min, max) => min + (max - min) * next(),
    pick: (values) => values[Math.min(values.length - 1, Math.floor(next() * values.length))]!,
    state: () => state,
  };
}

function noiseHash(seed: number, x: number, y: number): number {
  let h = (seed ^ 0x27d4eb2f) >>> 0;
  h = Math.imul(h ^ Math.imul(x | 0, 0x85ebca6b), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ Math.imul(y | 0, 0x165667b1), 0x27d4eb2f) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 0x100000000;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function noise2d(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const v00 = noiseHash(seed, x0, y0);
  const v10 = noiseHash(seed, x0 + 1, y0);
  const v01 = noiseHash(seed, x0, y0 + 1);
  const v11 = noiseHash(seed, x0 + 1, y0 + 1);
  const sx = smooth(fx);
  const sy = smooth(fy);
  return v00 * (1 - sx) * (1 - sy) + v10 * sx * (1 - sy) + v01 * (1 - sx) * sy + v11 * sx * sy;
}

export function noise1d(seed: number, t: number): number {
  return noise2d(seed, t, seed);
}
