import type { AudioBuffer } from "./types.js";
import { toDb } from "./metering.js";

export interface NoiseGateOptions {
  readonly thresholdDb?: number;
  readonly ratio?: number;
  readonly attackMs?: number;
  readonly holdMs?: number;
  readonly releaseMs?: number;
  readonly rangeDb?: number;
  readonly hysteresisDb?: number;
}

const DEFAULTS: Required<NoiseGateOptions> = {
  thresholdDb: -45,
  ratio: 4,
  attackMs: 1,
  holdMs: 80,
  releaseMs: 120,
  rangeDb: -40,
  hysteresisDb: 6,
};

export function gateGainCurve(
  envelope: Float32Array,
  sampleRate: number,
  options: NoiseGateOptions = {},
): Float32Array {
  const settings = { ...DEFAULTS, ...options };
  const threshold = Math.max(-60, Math.min(0, settings.thresholdDb));
  const closeThreshold = threshold - Math.max(0, settings.hysteresisDb);
  const attackCoefficient = Math.exp(-1 / ((settings.attackMs / 1000) * sampleRate));
  const releaseCoefficient = Math.exp(-1 / ((settings.releaseMs / 1000) * sampleRate));
  const holdSamples = Math.max(0, Math.round((settings.holdMs / 1000) * sampleRate));
  const floorGain = 10 ** (Math.min(0, settings.rangeDb) / 20);
  const ratio = Math.max(1, settings.ratio);
  const gains = new Float32Array(envelope.length);

  let open = false;
  let holdCounter = 0;
  let gain = floorGain;

  for (let frame = 0; frame < envelope.length; frame += 1) {
    const levelDb = toDb(envelope[frame] ?? 0);
    const level = Number.isFinite(levelDb) ? levelDb : -120;

    if (level >= threshold) {
      open = true;
      holdCounter = holdSamples;
    } else if (level < closeThreshold && open) {
      if (holdCounter > 0) {
        holdCounter -= 1;
      } else {
        open = false;
      }
    } else if (open && holdCounter > 0) {
      holdCounter -= 1;
    }

    let targetGain = 1;
    if (!open) {
      const below = threshold - level;
      const reductionDb = below > 0 ? below * (1 - 1 / ratio) : 0;
      targetGain = Math.max(floorGain, 10 ** (-reductionDb / 20));
    }

    if (targetGain > gain) {
      gain = attackCoefficient * gain + (1 - attackCoefficient) * targetGain;
    } else {
      gain = releaseCoefficient * gain + (1 - releaseCoefficient) * targetGain;
    }
    gains[frame] = Math.max(floorGain, Math.min(1, gain));
  }

  return gains;
}

export function computeGateEnvelope(buffer: AudioBuffer, windowMs = 5): Float32Array {
  const { sampleRate, channels, length, data } = buffer;
  const window = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const envelope = new Float32Array(length);
  let sum = 0;
  for (let frame = 0; frame < length; frame += 1) {
    let peak = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const value = data[frame * channels + channel] ?? 0;
      const magnitude = value * value;
      if (magnitude > peak) peak = magnitude;
    }
    sum += peak;
    if (frame >= window) {
      let oldest = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        const value = data[(frame - window) * channels + channel] ?? 0;
        const magnitude = value * value;
        if (magnitude > oldest) oldest = magnitude;
      }
      sum -= oldest;
    }
    envelope[frame] = Math.sqrt(Math.max(0, sum) / Math.min(frame + 1, window));
  }
  return envelope;
}

export function applyNoiseGate(buffer: AudioBuffer, options: NoiseGateOptions = {}): AudioBuffer {
  const { sampleRate, channels, length, data } = buffer;
  const gains = gateGainCurve(computeGateEnvelope(buffer), sampleRate, options);
  const output = new Float32Array(data.length);
  for (let frame = 0; frame < length; frame += 1) {
    const gain = gains[frame] ?? 1;
    for (let channel = 0; channel < channels; channel += 1) {
      const index = frame * channels + channel;
      output[index] = (data[index] ?? 0) * gain;
    }
  }
  return { sampleRate, channels, length, data: output };
}
