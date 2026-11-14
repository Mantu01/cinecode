import type { AudioBuffer } from "../types.js";
import { fromDb, toDb } from "../metering.js";

export interface DuckingBand {
  readonly lowHz: number;
  readonly highHz: number;
}

export interface FrequencySelectiveDuckingOptions {
  readonly band?: DuckingBand;
  readonly thresholdDb?: number;
  readonly reductionDb?: number;
  readonly attackMs?: number;
  readonly holdMs?: number;
  readonly releaseMs?: number;
  readonly ratio?: number;
  readonly kneeDb?: number;
}

export const SPEECH_BAND: DuckingBand = { lowHz: 300, highHz: 3500 };

const DEFAULTS: Required<Omit<FrequencySelectiveDuckingOptions, "band">> = {
  thresholdDb: -28,
  reductionDb: -14,
  attackMs: 12,
  holdMs: 180,
  releaseMs: 320,
  ratio: 4,
  kneeDb: 4,
};

interface Biquad {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

function highPassCoefficients(cutoffHz: number, sampleRate: number, q: number): Biquad {
  const omega = (2 * Math.PI * Math.min(cutoffHz, sampleRate * 0.49)) / sampleRate;
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

function lowPassCoefficients(cutoffHz: number, sampleRate: number, q: number): Biquad {
  const omega = (2 * Math.PI * Math.min(cutoffHz, sampleRate * 0.49)) / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 - cosine) / 2) / a0,
    b1: (1 - cosine) / a0,
    b2: ((1 - cosine) / 2) / a0,
    a1: (-2 * cosine) / a0,
    a2: (1 - alpha) / a0,
  };
}

function applyBiquad(input: Float32Array, coefficients: Biquad): Float32Array {
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

export function bandLimitSignal(
  signal: Float32Array,
  sampleRate: number,
  band: DuckingBand = SPEECH_BAND,
): Float32Array {
  const highPassed = applyBiquad(applyBiquad(signal, highPassCoefficients(band.lowHz, sampleRate, 0.707)), highPassCoefficients(band.lowHz, sampleRate, 0.707));
  return applyBiquad(applyBiquad(highPassed, lowPassCoefficients(band.highHz, sampleRate, 0.707)), lowPassCoefficients(band.highHz, sampleRate, 0.707));
}

export function computeBandEnvelope(
  signal: Float32Array,
  sampleRate: number,
  band: DuckingBand = SPEECH_BAND,
  windowMs = 10,
): Float32Array {
  const filtered = bandLimitSignal(signal, sampleRate, band);
  const window = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const envelope = new Float32Array(filtered.length);
  let sum = 0;
  for (let index = 0; index < filtered.length; index += 1) {
    const sample = filtered[index] ?? 0;
    sum += sample * sample;
    if (index >= window) {
      const previous = filtered[index - window] ?? 0;
      sum -= previous * previous;
    }
    envelope[index] = Math.sqrt(Math.max(0, sum) / Math.min(index + 1, window));
  }
  return envelope;
}

export function duckingGainCurve(
  controllerEnvelope: Float32Array,
  sampleRate: number,
  options: FrequencySelectiveDuckingOptions = {},
): Float32Array {
  const thresholdDb = options.thresholdDb ?? DEFAULTS.thresholdDb;
  const reductionDb = Math.min(0, options.reductionDb ?? DEFAULTS.reductionDb);
  const ratio = Math.max(1, options.ratio ?? DEFAULTS.ratio);
  const kneeDb = Math.max(0, options.kneeDb ?? DEFAULTS.kneeDb);
  const attackCoefficient = Math.exp(-1 / (((options.attackMs ?? DEFAULTS.attackMs) / 1000) * sampleRate));
  const releaseCoefficient = Math.exp(-1 / (((options.releaseMs ?? DEFAULTS.releaseMs) / 1000) * sampleRate));
  const holdSamples = Math.max(0, Math.round(((options.holdMs ?? DEFAULTS.holdMs) / 1000) * sampleRate));
  const maxReduction = 10 ** (reductionDb / 20);
  const gains = new Float32Array(controllerEnvelope.length);
  let gain = 1;
  let holdCounter = 0;

  for (let index = 0; index < controllerEnvelope.length; index += 1) {
    const levelDb = toDb(controllerEnvelope[index] ?? 0);
    let targetDb = 0;
    if (Number.isFinite(levelDb)) {
      const over = levelDb - thresholdDb;
      if (over > kneeDb / 2) {
        targetDb = -(over - over / ratio);
      } else if (over > -kneeDb / 2 && kneeDb > 0) {
        const kneePosition = over + kneeDb / 2;
        targetDb = -((1 - 1 / ratio) * (kneePosition * kneePosition)) / (2 * kneeDb);
      }
    }
    const targetGain = Math.max(maxReduction, 10 ** (targetDb / 20));

    if (targetGain < gain) {
      gain = attackCoefficient * gain + (1 - attackCoefficient) * targetGain;
      holdCounter = holdSamples;
    } else if (holdCounter > 0) {
      holdCounter -= 1;
    } else {
      gain = releaseCoefficient * gain + (1 - releaseCoefficient) * targetGain;
    }
    gains[index] = Math.max(maxReduction, Math.min(1, gain));
  }
  return gains;
}

export function computeFrequencySelectiveDucking(
  controller: AudioBuffer,
  startSample: number,
  totalSamples: number,
  sampleRate: number,
  options: FrequencySelectiveDuckingOptions = {},
): Float32Array {
  const band = options.band ?? SPEECH_BAND;
  const mono = new Float32Array(totalSamples);
  const copyLength = Math.min(controller.length, Math.max(0, totalSamples - startSample));
  for (let frame = 0; frame < copyLength; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < controller.channels; channel += 1) {
      sum += controller.data[frame * controller.channels + channel] ?? 0;
    }
    mono[startSample + frame] = sum / controller.channels;
  }
  return duckingGainCurve(computeBandEnvelope(mono, sampleRate, band), sampleRate, options);
}

export function applyDuckingCurve(
  target: AudioBuffer,
  gainCurve: Float32Array,
  startSample: number,
  totalSamples: number,
): AudioBuffer {
  const data = new Float32Array(totalSamples * target.channels);
  const copyLength = Math.min(target.length, Math.max(0, totalSamples - startSample));
  for (let frame = 0; frame < copyLength; frame += 1) {
    const gain = gainCurve[startSample + frame] ?? 1;
    for (let channel = 0; channel < target.channels; channel += 1) {
      data[(startSample + frame) * target.channels + channel] = (target.data[frame * target.channels + channel] ?? 0) * gain;
    }
  }
  return { sampleRate: target.sampleRate, channels: target.channels, length: totalSamples, data };
}

export function dbToGain(db: number): number {
  return fromDb(db);
}
