import type { FilterOptions } from "../types.js";

export interface BiquadCoefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a0: number;
  readonly a1: number;
  readonly a2: number;
}

export interface FilterState {
  readonly x1: number;
  readonly x2: number;
  readonly y1: number;
  readonly y2: number;
}

function calculateCoefficients(type: FilterOptions["type"], cutoff: number, resonance: number, sampleRate: number): BiquadCoefficients {
  const omega = 2 * Math.PI * cutoff / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * resonance);

  let b0 = 0, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

  switch (type) {
    case "low-pass":
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;

    case "high-pass":
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;

    case "band-pass":
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;

    case "notch":
      b0 = 1;
      b1 = -2 * cos;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a0: 1,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

export function createFilter(options: FilterOptions, sampleRate: number): {
  process: (input: Float32Array, output: Float32Array, offset: number, length: number) => void;
  setCutoff: (cutoff: number) => void;
  setResonance: (resonance: number) => void;
  getState: () => FilterState;
  reset: () => void;
} {
  const { type } = options;
  let cutoff = options.cutoff;
  let resonance = options.resonance;
  let coeffs = calculateCoefficients(type, cutoff, resonance, sampleRate);
  let state: FilterState = { x1: 0, x2: 0, y1: 0, y2: 0 };

  return {
    process(input: Float32Array, output: Float32Array, offset: number, length: number): void {
      const { b0, b1, b2, a1, a2 } = coeffs;
      let { x1, x2, y1, y2 } = state;

      for (let i = 0; i < length; i++) {
        const x = input[offset + i]!;
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;

        output[offset + i] = y;

        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
      }

      state = { x1, x2, y1, y2 };
    },

    setCutoff(newCutoff: number): void {
      cutoff = newCutoff;
      coeffs = calculateCoefficients(type, cutoff, resonance, sampleRate);
    },

    setResonance(newResonance: number): void {
      resonance = newResonance;
      coeffs = calculateCoefficients(type, cutoff, resonance, sampleRate);
    },

    getState(): FilterState {
      return state;
    },

    reset(): void {
      state = { x1: 0, x2: 0, y1: 0, y2: 0 };
    },
  };
}

export function createLowPassFilter(cutoff: number, resonance: number, sampleRate: number) {
  return createFilter({ type: "low-pass", cutoff, resonance }, sampleRate);
}

export function createHighPassFilter(cutoff: number, resonance: number, sampleRate: number) {
  return createFilter({ type: "high-pass", cutoff, resonance }, sampleRate);
}

export function createBandPassFilter(cutoff: number, resonance: number, sampleRate: number) {
  return createFilter({ type: "band-pass", cutoff, resonance }, sampleRate);
}

export function createNotchFilter(cutoff: number, resonance: number, sampleRate: number) {
  return createFilter({ type: "notch", cutoff, resonance }, sampleRate);
}