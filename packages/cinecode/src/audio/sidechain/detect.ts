import type { AudioBuffer } from "../types.js";

export interface SidechainEnvelopeOptions {
  readonly attackMs?: number;
  readonly releaseMs?: number;
  readonly windowMs?: number;
}

function coefficient(timeMs: number, sampleRate: number): number {
  if (timeMs <= 0) return 0;
  return Math.exp(-1 / ((timeMs / 1000) * sampleRate));
}

export function computeSidechainEnvelope(
  signal: Float32Array,
  sampleRate: number,
  attackMs = 10,
  releaseMs = 100,
): Float32Array {
  const attack = coefficient(attackMs, sampleRate);
  const release = coefficient(releaseMs, sampleRate);
  const envelope = new Float32Array(signal.length);
  let value = 0;
  for (let i = 0; i < signal.length; i += 1) {
    const amplitude = Math.abs(signal[i] ?? 0);
    const target = Math.min(1, amplitude);
    const coeff = target > value ? attack : release;
    value = coeff * value + (1 - coeff) * target;
    envelope[i] = value;
  }
  return envelope;
}

export function computeRmsEnvelope(
  signal: Float32Array,
  sampleRate: number,
  options: SidechainEnvelopeOptions = {},
): Float32Array {
  const window = Math.max(1, Math.round(((options.windowMs ?? 5) / 1000) * sampleRate));
  const envelope = new Float32Array(signal.length);
  let sum = 0;
  for (let i = 0; i < signal.length; i += 1) {
    sum += (signal[i] ?? 0) * (signal[i] ?? 0);
    if (i >= window) sum -= (signal[i - window] ?? 0) * (signal[i - window] ?? 0);
    envelope[i] = Math.sqrt(Math.max(0, sum) / Math.min(i + 1, window));
  }
  const attack = coefficient(options.attackMs ?? 10, sampleRate);
  const release = coefficient(options.releaseMs ?? 100, sampleRate);
  let value = 0;
  for (let i = 0; i < envelope.length; i += 1) {
    const target = Math.min(1, envelope[i] ?? 0);
    const coeff = target > value ? attack : release;
    value = coeff * value + (1 - coeff) * target;
    envelope[i] = value;
  }
  return envelope;
}

export function computeTimelineEnvelope(
  controller: AudioBuffer,
  startSample: number,
  totalSamples: number,
  sampleRate: number,
  options: SidechainEnvelopeOptions = {},
): Float32Array {
  const source = new Float32Array(totalSamples);
  const copyLength = Math.min(controller.length, Math.max(0, totalSamples - startSample));
  for (let i = 0; i < copyLength; i += 1) {
    let peak = 0;
    for (let channel = 0; channel < controller.channels; channel += 1) {
      const value = Math.abs(controller.data[i * controller.channels + channel] ?? 0);
      if (value > peak) peak = value;
    }
    source[startSample + i] = peak;
  }
  return computeSidechainEnvelope(source, sampleRate, options.attackMs, options.releaseMs);
}
