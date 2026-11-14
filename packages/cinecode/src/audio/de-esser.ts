import type { AudioBuffer } from "./types.js";
import { toDb } from "./metering.js";

export type DeEsserMode = "split-band" | "wideband";

export interface DeEsserOptions {
  readonly mode?: DeEsserMode;
  readonly frequencyHz?: number;
  readonly q?: number;
  readonly thresholdDb?: number;
  readonly ratio?: number;
  readonly attackMs?: number;
  readonly releaseMs?: number;
  readonly rangeDb?: number;
}

const DEFAULTS: Required<DeEsserOptions> = {
  mode: "split-band",
  frequencyHz: 5500,
  q: 0.707,
  thresholdDb: -28,
  ratio: 4,
  attackMs: 0.3,
  releaseMs: 35,
  rangeDb: -18,
};

interface HighPassCoefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

function highPass(frequencyHz: number, sampleRate: number, q: number): HighPassCoefficients {
  const omega = (2 * Math.PI * Math.min(frequencyHz, sampleRate * 0.49)) / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cosine) / 2) / a0,
    b1: (-(1 + cosine)) / a0,
    b2: ((1 + cosine) / 2) / a0,
    a1: (-2 * cosine) / a0,
    a2: (1 - alpha) / a0,
  };
}

function filterHighPass(input: Float32Array, coefficients: HighPassCoefficients): Float32Array {
  const output = new Float32Array(input.length);
  let state1 = 0;
  let state2 = 0;
  for (let index = 0; index < input.length; index += 1) {
    const sample = input[index] ?? 0;
    const value = coefficients.b0 * sample + state1;
    state1 = coefficients.b1 * sample - coefficients.a1 * value + state2;
    state2 = coefficients.b2 * sample - coefficients.a2 * value;
    output[index] = value;
  }
  return output;
}

export function applyDeEsser(buffer: AudioBuffer, options: DeEsserOptions = {}): AudioBuffer {
  const settings = { ...DEFAULTS, ...options };
  const { sampleRate, channels, length, data } = buffer;
  const output = new Float32Array(data);
  const coefficients = highPass(settings.frequencyHz, sampleRate, settings.q);
  const attackCoefficient = Math.exp(-1 / ((settings.attackMs / 1000) * sampleRate));
  const releaseCoefficient = Math.exp(-1 / ((settings.releaseMs / 1000) * sampleRate));
  const maxReduction = 10 ** (Math.min(0, settings.rangeDb) / 20);
  const ratio = Math.max(1, settings.ratio);

  const sibilance = new Float32Array(length);
  for (let frame = 0; frame < length; frame += 1) {
    let peak = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const value = Math.abs(data[frame * channels + channel] ?? 0);
      if (value > peak) peak = value;
    }
    sibilance[frame] = peak;
  }
  const filtered = filterHighPass(sibilance, coefficients);

  const appliedGain = new Float32Array(length);
  let gain = 1;
  for (let frame = 0; frame < length; frame += 1) {
    const levelDb = toDb(filtered[frame] ?? 0);
    let targetGain = 1;
    if (Number.isFinite(levelDb) && levelDb > settings.thresholdDb) {
      const excess = levelDb - settings.thresholdDb;
      const reductionDb = excess - excess / ratio;
      targetGain = Math.max(maxReduction, 10 ** (-reductionDb / 20));
    }
    if (targetGain < gain) {
      gain = attackCoefficient * gain + (1 - attackCoefficient) * targetGain;
    } else {
      gain = releaseCoefficient * gain + (1 - releaseCoefficient) * targetGain;
    }
    appliedGain[frame] = Math.max(maxReduction, Math.min(1, gain));
  }

  if (settings.mode === "wideband") {
    for (let frame = 0; frame < length; frame += 1) {
      const gainValue = appliedGain[frame] ?? 1;
      for (let channel = 0; channel < channels; channel += 1) {
        const index = frame * channels + channel;
        output[index] = (data[index] ?? 0) * gainValue;
      }
    }
    return { sampleRate, channels, length, data: output };
  }

  for (let channel = 0; channel < channels; channel += 1) {
    const extracted = new Float32Array(length);
    for (let frame = 0; frame < length; frame += 1) extracted[frame] = data[frame * channels + channel] ?? 0;
    const band = filterHighPass(extracted, coefficients);
    for (let frame = 0; frame < length; frame += 1) {
      const index = frame * channels + channel;
      const gainValue = appliedGain[frame] ?? 1;
      output[index] = (data[index] ?? 0) - (band[frame] ?? 0) * (1 - gainValue);
    }
  }

  return { sampleRate, channels, length, data: output };
}
