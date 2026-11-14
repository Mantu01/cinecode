import type { MediaCache } from "../../media/cache.js";
import { decodeAudioFile } from "../decode.js";

const impulseCache = new Map<string, Float32Array>();

export interface LoadImpulseOptions {
  readonly cache?: MediaCache;
  readonly sampleRate?: number;
}

export async function loadImpulseResponse(
  path: string,
  options: LoadImpulseOptions = {},
): Promise<Float32Array> {
  const key = `${path}@${options.sampleRate ?? 48000}`;
  const cached = impulseCache.get(key);
  if (cached) return cached;
  const decoded = await decodeAudioFile(path, {
    cache: options.cache,
    targetSampleRate: options.sampleRate ?? 48000,
    targetChannels: 1,
  });
  const samples = decoded.buffer.channels === 1
    ? Float32Array.from(decoded.buffer.data)
    : monoMix(decoded.buffer);
  impulseCache.set(key, samples);
  return samples;
}

function monoMix(buffer: { readonly channels: number; readonly length: number; readonly data: Float32Array }): Float32Array {
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

export function clearImpulseCache(): void {
  impulseCache.clear();
}
