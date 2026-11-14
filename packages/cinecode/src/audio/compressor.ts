import type { AudioBuffer } from "./types.js";
import { toDb, fromDb } from "./metering.js";

/**
 * Dynamic-range compression, beyond the brick-wall peak limiter.
 *
 * A compressor reduces the level of loud passages above a threshold by a
 * configured ratio, with attack/release smoothing, to even out dynamic range.
 * Unlike the limiter (which only prevents clipping), compression is a creative
 * and leveling tool. It is deterministic: same buffer + same settings = same
 * output.
 */

export interface CompressorOptions {
  /** Level above which compression begins, in dBFS (default -18). */
  readonly thresholdDb?: number;
  /** Compression ratio above the threshold (e.g. 4 = 4:1). Default 4. */
  readonly ratio?: number;
  /** Attack time in seconds (default 0.01). */
  readonly attackTime?: number;
  /** Release time in seconds (default 0.2). */
  readonly releaseTime?: number;
  /** Makeup gain applied after compression, in dB (default 0). */
  readonly makeupDb?: number;
  /** Softening knee width in dB around the threshold (default 6). */
  readonly kneeDb?: number;
  readonly sampleRate?: number;
}

export interface CompressorResult {
  readonly buffer: AudioBuffer;
  readonly engaged: boolean;
  readonly gainReductionDb: number;
}

function smoothCoefficient(timeSeconds: number, sampleRate: number): number {
  if (timeSeconds <= 0) return 0;
  return Math.exp(-1 / (timeSeconds * sampleRate));
}

/**
 * Compress an AudioBuffer in place-safe fashion (returns a new buffer). Uses a
 * feed-forward design with a smoothed gain envelope and optional soft knee.
 */
export function compressAudio(buffer: AudioBuffer, options: CompressorOptions = {}): CompressorResult {
  const thresholdDb = options.thresholdDb ?? -18;
  const ratio = Math.max(1, options.ratio ?? 4);
  const attackTime = options.attackTime ?? 0.01;
  const releaseTime = options.releaseTime ?? 0.2;
  const makeupDb = options.makeupDb ?? 0;
  const kneeDb = Math.max(0, options.kneeDb ?? 6);
  const sampleRate = options.sampleRate ?? buffer.sampleRate;

  const { channels, length, data } = buffer;
  const attack = smoothCoefficient(attackTime, sampleRate);
  const release = smoothCoefficient(releaseTime, sampleRate);
  const makeup = fromDb(makeupDb);
  const out = new Float32Array(data);

  let envelopeDb = 0;
  let maxReductionDb = 0;

  for (let i = 0; i < length; i += 1) {
    let peak = 0;
    for (let ch = 0; ch < channels; ch += 1) {
      const magnitude = Math.abs(out[i * channels + ch] ?? 0);
      if (magnitude > peak) peak = magnitude;
    }
    const inputDb = peak > 0 ? toDb(peak) : -120;

    let targetReductionDb = 0;
    if (kneeDb > 0 && inputDb > thresholdDb - kneeDb / 2 && inputDb < thresholdDb + kneeDb / 2) {
      const x = inputDb - thresholdDb + kneeDb / 2;
      targetReductionDb = ((1 / ratio - 1) * x * x) / (2 * kneeDb);
    } else if (inputDb >= thresholdDb) {
      targetReductionDb = (1 / ratio - 1) * (inputDb - thresholdDb);
    }

    const coefficient = targetReductionDb < envelopeDb ? attack : release;
    envelopeDb = coefficient * envelopeDb + (1 - coefficient) * targetReductionDb;
    if (envelopeDb < maxReductionDb || i === 0) maxReductionDb = envelopeDb;

    const gain = fromDb(envelopeDb) * makeup;
    for (let ch = 0; ch < channels; ch += 1) {
      out[i * channels + ch] = (out[i * channels + ch] ?? 0) * gain;
    }
  }

  return {
    buffer: { ...buffer, data: out },
    engaged: maxReductionDb < -0.1,
    gainReductionDb: -maxReductionDb,
  };
}
