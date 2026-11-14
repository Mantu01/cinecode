import type { AudioBuffer } from "./types.js";

/**
 * Public audio processing operations. Each function is pure: it takes an
 * AudioBuffer and returns a new AudioBuffer, leaving the input untouched.
 * Time values (trim/fade/silence) are in seconds.
 */

export type FadeShape = "linear" | "exponential" | "logarithmic" | "s-curve";

function shapeGain(t: number, shape: FadeShape): number {
  switch (shape) {
    case "linear":
      return t;
    case "exponential":
      return t * t;
    case "logarithmic":
      return Math.sqrt(t);
    case "s-curve":
      return t * t * (3 - 2 * t);
  }
}

export function applyFade(
  buffer: AudioBuffer,
  fadeIn: number,
  fadeOut: number,
  shape: FadeShape = "linear",
): AudioBuffer {
  const { sampleRate, channels, length, data } = buffer;
  const fadeInSamples = Math.max(0, Math.round(fadeIn * sampleRate));
  const fadeOutSamples = Math.max(0, Math.round(fadeOut * sampleRate));
  if (fadeInSamples === 0 && fadeOutSamples === 0) return buffer;
  const out = new Float32Array(data);
  for (let i = 0; i < length; i += 1) {
    let gain = 1;
    if (i < fadeInSamples && fadeInSamples > 0) gain *= shapeGain(i / fadeInSamples, shape);
    const fromEnd = length - 1 - i;
    if (fromEnd < fadeOutSamples && fadeOutSamples > 0) gain *= shapeGain(fromEnd / fadeOutSamples, shape);
    if (gain !== 1) {
      for (let ch = 0; ch < channels; ch += 1) out[i * channels + ch] = data[i * channels + ch]! * gain;
    }
  }
  return { sampleRate, channels, length, data: out };
}

export function applyTrim(buffer: AudioBuffer, start: number, end: number): AudioBuffer {
  const { sampleRate, channels, length, data } = buffer;
  const startSample = Math.max(0, Math.min(length, Math.round(start * sampleRate)));
  const endSample = Math.max(startSample, Math.min(length, Math.round(end * sampleRate)));
  const outLength = endSample - startSample;
  const out = new Float32Array(outLength * channels);
  out.set(data.subarray(startSample * channels, endSample * channels));
  return { sampleRate, channels, length: outLength, data: out };
}

export function applySpeed(buffer: AudioBuffer, speed: number): AudioBuffer {
  if (speed === 1 || speed <= 0) return buffer;
  const { sampleRate, channels, length, data } = buffer;
  const outLength = Math.max(1, Math.floor(length / speed));
  const out = new Float32Array(outLength * channels);
  for (let i = 0; i < outLength; i += 1) {
    const src = i * speed;
    const i0 = Math.floor(src);
    const frac = src - i0;
    const i1 = Math.min(length - 1, i0 + 1);
    for (let ch = 0; ch < channels; ch += 1) {
      const a = data[i0 * channels + ch] ?? 0;
      const b = data[i1 * channels + ch] ?? 0;
      out[i * channels + ch] = a + (b - a) * frac;
    }
  }
  return { sampleRate, channels, length: outLength, data: out };
}

export function reverseAudio(buffer: AudioBuffer): AudioBuffer {
  const { sampleRate, channels, length, data } = buffer;
  const out = new Float32Array(data.length);
  for (let i = 0; i < length; i += 1) {
    const src = length - 1 - i;
    for (let ch = 0; ch < channels; ch += 1) out[i * channels + ch] = data[src * channels + ch] ?? 0;
  }
  return { sampleRate, channels, length, data: out };
}

export function applyPan(buffer: AudioBuffer, pan: number): AudioBuffer {
  const clamped = Math.max(-1, Math.min(1, pan));
  const { sampleRate, channels, length, data } = buffer;
  if (channels === 1) {
    const out = new Float32Array(length * 2);
    const leftGain = Math.cos(((clamped + 1) * Math.PI) / 4);
    const rightGain = Math.sin(((clamped + 1) * Math.PI) / 4);
    for (let i = 0; i < length; i += 1) {
      out[i * 2] = data[i]! * leftGain;
      out[i * 2 + 1] = data[i]! * rightGain;
    }
    return { sampleRate, channels: 2, length, data: out };
  }
  const out = new Float32Array(data);
  const leftGain = Math.cos(((clamped + 1) * Math.PI) / 4);
  const rightGain = Math.sin(((clamped + 1) * Math.PI) / 4);
  for (let i = 0; i < length; i += 1) {
    out[i * channels] = data[i * channels]! * leftGain;
    out[i * channels + 1] = data[i * channels + 1]! * rightGain;
  }
  return { sampleRate, channels, length, data: out };
}

export function insertSilence(buffer: AudioBuffer, before: number, after: number): AudioBuffer {
  const { sampleRate, channels, length, data } = buffer;
  const beforeSamples = Math.max(0, Math.round(before * sampleRate));
  const afterSamples = Math.max(0, Math.round(after * sampleRate));
  if (beforeSamples === 0 && afterSamples === 0) return buffer;
  const outLength = length + beforeSamples + afterSamples;
  const out = new Float32Array(outLength * channels);
  out.set(data, beforeSamples * channels);
  return { sampleRate, channels, length: outLength, data: out };
}
