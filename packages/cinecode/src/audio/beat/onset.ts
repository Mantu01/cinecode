import type { AudioBuffer } from "../types.js";
import { fft, magnitude } from "../fft.js";

export interface OnsetEvent {
  readonly time: number;
  readonly strength: number;
}

export interface OnsetOptions {
  readonly hopSize?: number;
  readonly windowSize?: number;
  readonly thresholdMultiplier?: number;
}

function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return window;
}

function mono(buffer: AudioBuffer): Float32Array {
  if (buffer.channels === 1) return buffer.data;
  const output = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    let sum = 0;
    for (let channel = 0; channel < buffer.channels; channel += 1) {
      sum += buffer.data[i * buffer.channels + channel] ?? 0;
    }
    output[i] = sum / buffer.channels;
  }
  return output;
}

export function detectOnsets(buffer: AudioBuffer, options: OnsetOptions = {}): OnsetEvent[] {
  const hopSize = Math.max(64, options.hopSize ?? 512);
  const windowSize = Math.max(hopSize, options.windowSize ?? 2048);
  const multiplier = options.thresholdMultiplier ?? 1.5;
  const signal = mono(buffer);
  const window = hannWindow(windowSize);
  const spectrumSize = windowSize / 2;
  const previous = new Float32Array(spectrumSize);
  const flux: number[] = [];
  const times: number[] = [];

  for (let start = 0; start + windowSize <= signal.length; start += hopSize) {
    const frame = new Float32Array(windowSize);
    for (let i = 0; i < windowSize; i += 1) frame[i] = (signal[start + i] ?? 0) * window[i]!;
    const spectrum = magnitude(fft(frame));
    let sum = 0;
    for (let bin = 0; bin < spectrumSize; bin += 1) {
      const difference = (spectrum[bin] ?? 0) - (previous[bin] ?? 0);
      if (difference > 0) sum += difference;
    }
    flux.push(sum);
    times.push((start + windowSize / 2) / buffer.sampleRate);
    previous.set(spectrum);
  }

  if (flux.length === 0) return [];
  const mean = flux.reduce((sum, value) => sum + value, 0) / flux.length;
  const variance = flux.reduce((sum, value) => sum + (value - mean) ** 2, 0) / flux.length;
  const threshold = mean + Math.sqrt(variance) * multiplier;

  const onsets: OnsetEvent[] = [];
  for (let i = 1; i < flux.length - 1; i += 1) {
    const value = flux[i]!;
    if (value <= threshold) continue;
    if (value < flux[i - 1]! || value < flux[i + 1]!) continue;
    onsets.push({ time: times[i]!, strength: value });
  }
  return onsets;
}

export function onsetEnergyEnvelope(buffer: AudioBuffer, hopSize = 512): Float32Array {
  const signal = mono(buffer);
  const frames = Math.floor(signal.length / hopSize);
  const envelope = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let i = 0; i < hopSize; i += 1) {
      const value = signal[frame * hopSize + i] ?? 0;
      sum += value * value;
    }
    envelope[frame] = Math.sqrt(sum / hopSize);
  }
  return envelope;
}
