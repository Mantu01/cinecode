import type { AudioBuffer } from "../types.js";
import { convolveOverlapAdd } from "./convolve.js";
import { roomDecaySeconds, synthesizeReverbIr, type RoomType } from "./synthesize.js";

export interface ReverbParams {
  readonly irPath?: string;
  readonly impulse?: Float32Array;
  readonly roomType?: RoomType;
  readonly decayTime?: number;
  readonly wetLevel?: number;
  readonly dryLevel?: number;
  readonly preDelay?: number;
}

const irCache = new Map<string, Float32Array>();

function resolveIr(buffer: AudioBuffer, params: ReverbParams): Float32Array {
  if (params.impulse) return params.impulse;
  const roomType = params.roomType ?? "medium";
  const decay = params.decayTime ?? roomDecaySeconds(roomType);
  const key = `${roomType}:${decay}:${buffer.sampleRate}`;
  const cached = irCache.get(key);
  if (cached) return cached;
  const ir = synthesizeReverbIr(roomType, { decayTime: decay, sampleRate: buffer.sampleRate });
  if (irCache.size > 32) irCache.clear();
  irCache.set(key, ir);
  return ir;
}

export function reverbEffect(buffer: AudioBuffer, params: ReverbParams = {}): AudioBuffer {
  const wetLevel = clamp01(params.wetLevel ?? 0.3);
  const dryLevel = clamp01(params.dryLevel ?? 1);
  if (wetLevel === 0) return buffer;
  const ir = resolveIr(buffer, params);
  const channels = buffer.channels;
  const length = buffer.length;
  const data = new Float32Array(length * channels);
  const preDelaySamples = Math.max(0, Math.round(((params.preDelay ?? 0) / 1000) * buffer.sampleRate));
  const wet = new Float32Array(length * channels);

  for (let channel = 0; channel < channels; channel += 1) {
    const input = new Float32Array(length);
    for (let i = 0; i < length; i += 1) input[i] = buffer.data[i * channels + channel] ?? 0;
    const convolved = convolveOverlapAdd(input, ir);
    for (let i = 0; i < length; i += 1) {
      const sourceIndex = i - preDelaySamples;
      const wetSample = sourceIndex >= 0 ? (convolved[sourceIndex] ?? 0) : 0;
      wet[i * channels + channel] = wetSample;
    }
  }

  for (let i = 0; i < length * channels; i += 1) {
    data[i] = (buffer.data[i] ?? 0) * dryLevel + (wet[i] ?? 0) * wetLevel;
  }

  return { sampleRate: buffer.sampleRate, channels, length, data };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
