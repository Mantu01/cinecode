import type { AudioBuffer } from "../audio/types.js";
import type { TtsEngine, TtsOptions } from "./engine.js";
import {
  buildWordBoundaries,
  parseSsml,
  type ParsedSsml,
  type WordBoundary,
} from "./ssml-parser.js";

export interface SsmlSpeechOptions extends TtsOptions {
  readonly engine?: TtsEngine;
  readonly sampleRate?: number;
}

export interface SsmlSpeechResult {
  readonly buffer: AudioBuffer;
  readonly boundaries: readonly WordBoundary[];
  readonly parsed: ParsedSsml;
}

const DEFAULT_SAMPLE_RATE = 48000;

function semitonesToHertz(semitones: number): number {
  if (semitones === 0) return 0;
  return (2 ** (semitones / 12) - 1) * 200;
}

function silence(sampleRate: number, durationMs: number): AudioBuffer {
  const frames = Math.max(0, Math.round((durationMs / 1000) * sampleRate));
  return { sampleRate, channels: 1, length: frames, data: new Float32Array(frames) };
}

function scale(buffer: AudioBuffer, gain: number): AudioBuffer {
  if (gain === 1) return buffer;
  const data = new Float32Array(buffer.data.length);
  for (let index = 0; index < data.length; index += 1) data[index] = (buffer.data[index] ?? 0) * gain;
  return { ...buffer, data };
}

export async function synthesizeSsml(
  input: string | ParsedSsml,
  engine: TtsEngine,
  options: SsmlSpeechOptions = {},
): Promise<SsmlSpeechResult> {
  const parsed = typeof input === "string" ? parseSsml(input) : input;
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const chunks: AudioBuffer[] = [];
  const boundaries: WordBoundary[] = [];
  let cursorSeconds = 0;

  for (const segment of parsed.segments) {
    if (segment.breakBeforeMs > 0) {
      const pause = silence(sampleRate, segment.breakBeforeMs);
      chunks.push(pause);
      cursorSeconds += pause.length / sampleRate;
    }
    if (segment.text.trim().length > 0) {
      const synthesized = await engine.synthesize(segment.text, {
        ...options,
        voice: options.voice ?? parsed.voice,
        language: options.language ?? parsed.language,
        speed: (options.speed ?? 1) * segment.rate,
        pitch: semitonesToHertz(segment.pitchSemitones),
      });
      const voiced = scale(synthesized, 10 ** (segment.volumeDb / 20));
      const duration = voiced.length / voiced.sampleRate;
      boundaries.push(...buildWordBoundaries(segment.text, cursorSeconds, duration));
      chunks.push(voiced);
      cursorSeconds += duration;
    }
    if (segment.breakAfterMs > 0) {
      const pause = silence(sampleRate, segment.breakAfterMs);
      chunks.push(pause);
      cursorSeconds += pause.length / sampleRate;
    }
  }

  if (chunks.length === 0) {
    return { buffer: silence(sampleRate, 0), boundaries, parsed };
  }

  const totalFrames = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const data = new Float32Array(totalFrames);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk.data.subarray(0, chunk.length), offset);
    offset += chunk.length;
  }
  return {
    buffer: { sampleRate, channels: 1, length: totalFrames, data },
    boundaries,
    parsed,
  };
}
