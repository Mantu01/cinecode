export type RoomType = "small" | "medium" | "large" | "hall" | "cathedral";

export interface ReverbSynthesisOptions {
  readonly duration?: number;
  readonly decayTime?: number;
  readonly sampleRate?: number;
  readonly seed?: number;
}

const ROOM_DEFAULTS: Readonly<
  Record<RoomType, { duration: number; decay: number; reflections: number }>
> = {
  small: { duration: 0.9, decay: 0.8, reflections: 6 },
  medium: { duration: 1.6, decay: 1.4, reflections: 9 },
  large: { duration: 2.6, decay: 2.2, reflections: 12 },
  hall: { duration: 3.4, decay: 3.0, reflections: 16 },
  cathedral: { duration: 5.0, decay: 4.2, reflections: 22 },
};

export function synthesizeReverbIr(
  roomType: RoomType,
  options: ReverbSynthesisOptions = {},
): Float32Array {
  const defaults = ROOM_DEFAULTS[roomType] ?? ROOM_DEFAULTS.medium;
  const sampleRate = options.sampleRate ?? 48000;
  const duration = Math.max(0.05, options.duration ?? defaults.duration);
  const decayTime = Math.max(0.05, options.decayTime ?? defaults.decay);
  const length = Math.max(1, Math.floor(duration * sampleRate));
  const ir = new Float32Array(length);
  const random = seededRandom(options.seed ?? 1);

  for (let i = 0; i < length; i += 1) {
    const time = i / sampleRate;
    const envelope = Math.exp((-6.907 * time) / decayTime);
    ir[i] = (random() * 2 - 1) * envelope;
  }

  const reflectionCount = defaults.reflections;
  for (let reflection = 0; reflection < reflectionCount; reflection += 1) {
    const ratio = (reflection + 1) / (reflectionCount + 1);
    const delaySeconds = 0.01 + ratio * ratio * Math.min(duration, decayTime) * 0.5;
    const index = Math.min(length - 1, Math.floor(delaySeconds * sampleRate));
    const amplitude = Math.exp(-ratio * 3.2) * 0.85;
    ir[index] = (ir[index] ?? 0) + amplitude;
  }

  highShelfDamping(ir, sampleRate);
  return ir;
}

function highShelfDamping(ir: Float32Array, sampleRate: number): void {
  const coefficient = Math.exp((-2 * Math.PI * 5200) / sampleRate);
  let state = 0;
  for (let i = 0; i < ir.length; i += 1) {
    state = coefficient * state + (1 - coefficient) * ir[i]!;
    ir[i] = state;
  }
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
}

export function roomDecaySeconds(roomType: RoomType): number {
  return ROOM_DEFAULTS[roomType]?.decay ?? ROOM_DEFAULTS.medium.decay;
}

export function roomSmall(durationSec: number, sampleRate: number, decayRate = 3.0): Float32Array {
  return decayingNoiseIr(durationSec, sampleRate, decayRate, 5, 0.02, 0.9);
}

export function hall(durationSec: number, sampleRate: number): Float32Array {
  return decayingNoiseIr(durationSec, sampleRate, 1.8, 14, 0.035, 0.8);
}

export function plate(durationSec: number, sampleRate: number, density = 0.9): Float32Array {
  const ir = decayingNoiseIr(durationSec, sampleRate, 2.6, 0, 0.01, 0.7);
  for (let i = 0; i < ir.length; i += 1) ir[i] = (ir[i] ?? 0) * density;
  return ir;
}

export function chamber(durationSec: number, sampleRate: number): Float32Array {
  const ir = decayingNoiseIr(durationSec, sampleRate, 2.2, 9, 0.012, 0.85);
  for (let i = 0; i < ir.length; i += 1) {
    const time = i / sampleRate;
    if (time < 0.05) ir[i] = (ir[i] ?? 0) + Math.exp(-time * 60) * 0.5;
  }
  return ir;
}

export function spring(durationSec: number, sampleRate: number): Float32Array {
  const ir = decayingNoiseIr(durationSec, sampleRate, 4.0, 3, 0.008, 1);
  const period = Math.floor(sampleRate / 180);
  for (let i = period; i < ir.length; i += period) {
    ir[i] = (ir[i] ?? 0) + Math.exp((-i / sampleRate) * 8) * 0.35;
  }
  return ir;
}

function decayingNoiseIr(
  durationSec: number,
  sampleRate: number,
  decayRate: number,
  reflections: number,
  reflectionSpreadSec: number,
  amplitude: number,
): Float32Array {
  const length = Math.max(1, Math.floor(durationSec * sampleRate));
  const ir = new Float32Array(length);
  const random = seededRandom(1);
  for (let i = 0; i < length; i += 1) {
    ir[i] = (random() * 2 - 1) * Math.exp(-decayRate * (i / sampleRate));
  }
  for (let reflection = 0; reflection < reflections; reflection += 1) {
    const ratio = (reflection + 1) / (reflections + 1);
    const index = Math.min(length - 1, Math.floor(ratio * reflectionSpreadSec * sampleRate));
    ir[index] = (ir[index] ?? 0) + Math.exp(-ratio * 3.2) * amplitude;
  }
  return ir;
}
