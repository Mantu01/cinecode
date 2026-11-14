import { join } from "node:path";
import { tmpdir } from "node:os";
import { MediaCache } from "../media/cache.js";
import { decodeAudioFile } from "./decode.js";
import type { AudioBuffer } from "./types.js";

const ANALYSIS_SAMPLE_RATE = 48000;

let mediaCache: MediaCache | undefined;
let cacheInitializing: Promise<MediaCache> | undefined;

export function setVisualizerMediaCache(cache: MediaCache): void {
  mediaCache = cache;
}

async function ensureCache(): Promise<MediaCache> {
  if (mediaCache !== undefined) return mediaCache;
  if (cacheInitializing === undefined) {
    cacheInitializing = (async () => {
      const cache = new MediaCache(join(tmpdir(), "cinecode-audio-visualizer"));
      await cache.initialize();
      return cache;
    })();
  }
  mediaCache = await cacheInitializing;
  return mediaCache;
}

const decodedBuffers = new Map<string, Promise<AudioBuffer | undefined>>();

export function getAnalysisBuffer(src: string): Promise<AudioBuffer | undefined> {
  let pending = decodedBuffers.get(src);
  if (pending === undefined) {
    pending = loadAnalysisBuffer(src);
    decodedBuffers.set(src, pending);
  }
  return pending;
}

async function loadAnalysisBuffer(src: string): Promise<AudioBuffer | undefined> {
  try {
    const cache = await ensureCache();
    const decoded = await decodeAudioFile(src, { cache, targetSampleRate: ANALYSIS_SAMPLE_RATE, targetChannels: 1 });
    return decoded.buffer;
  } catch {
    return undefined;
  }
}

export function extractVisualizerSample(buffer: AudioBuffer, startSample: number, windowSize: number): Float32Array {
  const window = new Float32Array(windowSize);
  const channels = Math.max(1, buffer.channels);
  const first = Math.max(0, Math.floor(startSample));
  for (let i = 0; i < windowSize; i += 1) {
    const index = (first + i) * channels;
    if (index + channels - 1 >= buffer.data.length) break;
    let sum = 0;
    for (let c = 0; c < channels; c += 1) {
      sum += buffer.data[index + c]!;
    }
    window[i] = sum / channels;
  }
  return window;
}
