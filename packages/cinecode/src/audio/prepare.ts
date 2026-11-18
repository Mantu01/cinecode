import { resolve } from "node:path";
import type { AudioClip, SoundClip, TtsClip } from "../core/types/index.js";
import { synthesizeTts } from "../tts/produce.js";
import type { MediaCache } from "../media/cache.js";
import type { AudioBuffer, AudioTrackState } from "./types.js";
import { decodeAudioFile } from "./decode.js";
import { separateStems, type StemName } from "./stem-separation.js";
import { spatialPanBuffer } from "./spatial/panning.js";
import { spatialAttenuation, type SpatialPosition } from "./spatial/attenuation.js";
import { recordDegradation } from "../errors/degradations.js";
import { createError, ErrorCode } from "../errors/codes.js";
import { frameToSeconds, timeInputToFrames, type FrameConversion } from "../core/time/index.js";

const LOOP_SEAM_SECONDS = 0.01;

interface AuthoredAudioClip {
  readonly buffer?: AudioBuffer;
  readonly src?: string;
  readonly start?: number | string;
  readonly duration?: number | string;
  readonly trimStart?: number | string;
  readonly trimEnd?: number | string;
  readonly speed?: number;
  readonly reverse?: boolean;
  readonly loop?: boolean;
  readonly fadeIn?: number | string;
  readonly fadeOut?: number | string;
  readonly volume?: number;
  readonly pan?: number;
  readonly muted?: boolean;
  readonly name?: string;
  readonly position3d?: SpatialPosition & {
    readonly velocity?: { readonly x?: number; readonly y?: number; readonly z?: number };
  };
  readonly sidechainFrom?: string;
  readonly stem?: StemName;
  readonly stemModel?: string;
}

export interface AudioPrepareOptions {
  readonly cache: MediaCache;
  readonly sampleRate: number;
  readonly channels: number;
  readonly duration: number;
  readonly trackMuted?: boolean;
  readonly stemCacheDir?: string;
  readonly conversion: FrameConversion;
  readonly trackNames: readonly string[];
}

function toSeconds(
  value: number | string | undefined,
  fallback: number,
  conversion: FrameConversion,
): number {
  if (value === undefined) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (value.includes(":")) return frameToSeconds(timeInputToFrames(value, conversion), conversion);
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function sourceBuffer(
  authored: AuthoredAudioClip,
  options: AudioPrepareOptions,
): Promise<AudioBuffer | null> {
  if (authored.buffer) return authored.buffer;
  let src = authored.src;
  if (typeof src !== "string" || src.trim().length === 0) return null;
  if (authored.stem) {
    try {
      const separation = await separateStems(resolve(src), {
        cacheDir: options.stemCacheDir,
        model: authored.stemModel,
        stems: [authored.stem],
      });
      const stemPath = separation.stems[authored.stem];
      if (stemPath) src = stemPath;
    } catch (error) {
      recordDegradation({
        code: "CC5001",
        what: `stem separation (${authored.stem})`,
        reason: (error as Error).message,
        input: src,
        instead: "the original mixdown is used for this clip",
      });
    }
  }
  const decoded = await decodeAudioFile(resolve(src), {
    cache: options.cache,
    targetSampleRate: options.sampleRate,
    targetChannels: options.channels,
  });
  return decoded.buffer;
}

function slice(source: AudioBuffer, fromFrame: number, frameCount: number): AudioBuffer {
  if (fromFrame === 0 && frameCount === source.length) return source;
  const channels = source.channels;
  const data = new Float32Array(frameCount * channels);
  data.set(source.data.subarray(fromFrame * channels, (fromFrame + frameCount) * channels));
  return { sampleRate: source.sampleRate, channels, length: frameCount, data };
}

/** Linear resampling: speed 2 halves duration, speed 0.5 doubles it. */
function resample(source: AudioBuffer, speed: number, maxFrames = Number.POSITIVE_INFINITY): AudioBuffer {
  if (speed === 1) return source;
  const length = Math.max(1, Math.min(Math.floor(source.length / speed), maxFrames));
  const data = new Float32Array(length * source.channels);
  for (let i = 0; i < length; i += 1) {
    const position = i * speed;
    const index = Math.floor(position);
    const next = Math.min(index + 1, source.length - 1);
    const weight = position - index;
    for (let c = 0; c < source.channels; c += 1) {
      const a = source.data[index * source.channels + c] ?? 0;
      const b = source.data[next * source.channels + c] ?? 0;
      data[i * source.channels + c] = a + (b - a) * weight;
    }
  }
  return { sampleRate: source.sampleRate, channels: source.channels, length, data };
}

function reverse(source: AudioBuffer): AudioBuffer {
  const data = new Float32Array(source.length * source.channels);
  for (let i = 0; i < source.length; i += 1) {
    const from = (source.length - 1 - i) * source.channels;
    data.set(source.data.subarray(from, from + source.channels), i * source.channels);
  }
  return { sampleRate: source.sampleRate, channels: source.channels, length: source.length, data };
}

/** Folds the source tail into its head so the loop seam has no click. */
function foldLoopSeam(source: AudioBuffer, sampleRate: number): AudioBuffer {
  const seam = Math.min(Math.round(sampleRate * LOOP_SEAM_SECONDS), Math.floor(source.length / 4));
  if (seam < 2) return source;
  const length = source.length - seam;
  const channels = source.channels;
  const data = new Float32Array(length * channels);
  data.set(source.data.subarray(0, length * channels));
  for (let i = 0; i < seam; i += 1) {
    const weight = (i + 1) / (seam + 1);
    for (let c = 0; c < channels; c += 1) {
      const head = source.data[i * channels + c]!;
      const tail = source.data[(length + i) * channels + c]!;
      data[i * channels + c] = tail + (head - tail) * weight;
    }
  }
  return { sampleRate: source.sampleRate, channels, length, data };
}

function loopTo(source: AudioBuffer, frameCount: number): AudioBuffer {
  if (frameCount <= source.length) return slice(source, 0, frameCount);
  const data = new Float32Array(frameCount * source.channels);
  for (let i = 0; i < frameCount; i += 1) {
    const from = (i % source.length) * source.channels;
    data.set(source.data.subarray(from, from + source.channels), i * source.channels);
  }
  return { sampleRate: source.sampleRate, channels: source.channels, length: frameCount, data };
}

function applyFades(buffer: AudioBuffer, fadeInFrames: number, fadeOutFrames: number): AudioBuffer {
  if (fadeInFrames === 0 && fadeOutFrames === 0) return buffer;
  const data = new Float32Array(buffer.data);
  for (let i = 0; i < fadeInFrames && i < buffer.length; i += 1) {
    const gain = i / fadeInFrames;
    for (let c = 0; c < buffer.channels; c += 1) data[i * buffer.channels + c]! *= gain;
  }
  for (let i = 0; i < fadeOutFrames && i < buffer.length; i += 1) {
    const frame = buffer.length - 1 - i;
    const gain = i / fadeOutFrames;
    for (let c = 0; c < buffer.channels; c += 1) data[frame * buffer.channels + c]! *= gain;
  }
  return { ...buffer, data };
}

function attenuate(buffer: AudioBuffer, position: SpatialPosition): AudioBuffer {
  const gain = spatialAttenuation(position).gain;
  const data = new Float32Array(buffer.data.length);
  for (let i = 0; i < buffer.data.length; i += 1) data[i] = buffer.data[i]! * gain;
  return { ...buffer, data };
}

function hasSignal(buffer: AudioBuffer): boolean {
  for (let i = 0; i < buffer.data.length; i += 1) {
    if (Math.abs(buffer.data[i]!) > 1e-6) return true;
  }
  return false;
}

/** Fails when a clip ducks against a track that is missing or carries no signal. */
export function assertSidechainSources(tracks: readonly AudioTrackState[]): void {
  for (const track of tracks) {
    const source = track.sidechainFrom;
    if (!source) continue;
    const clipId = track.name ?? track.id;
    const controller = tracks.find((candidate) => (candidate.name ?? candidate.id) === source);
    if (!controller) {
      throw createError(ErrorCode.CC5001, {
        name: clipId,
        reason: `sidechain source track "${source}" does not exist`,
      });
    }
    if (controller.muted || !hasSignal(controller.buffer)) {
      throw createError(ErrorCode.CC5001, {
        name: clipId,
        reason: `sidechain source track "${source}" is silent`,
      });
    }
  }
}

/**
 * Turns authored audio clips into mixer-ready tracks: source resolution and rate
 * conform, trim, speed, reverse, loop seam, fades, then position. Gain, pan and
 * sidechain ducking apply in the mixer.
 */
export async function prepareAudioTracks(
  clips: readonly (AudioClip | SoundClip | TtsClip)[],
  options: AudioPrepareOptions,
): Promise<AudioTrackState[]> {
  const { sampleRate, duration } = options;
  const tracks: AudioTrackState[] = [];

  for (let clipIndex = 0; clipIndex < clips.length; clipIndex += 1) {
    const clip = clips[clipIndex]!;
    const synthesized = clip.type === "tts";
    const authored: AuthoredAudioClip = synthesized
      ? { ...(clip as TtsClip), buffer: await synthesizeTts(clip as TtsClip) }
      : (clip as AuthoredAudioClip);
    const clipId = authored.name ?? authored.src ?? `audio clip ${clipIndex}`;
    const speed = synthesized ? 1 : (authored.speed ?? 1);
    if (!Number.isFinite(speed) || speed <= 0) {
      throw createError(ErrorCode.CC5001, {
        name: clipId,
        reason: `speed must be a positive number, got ${speed}`,
      });
    }
    if (authored.sidechainFrom !== undefined && !options.trackNames.includes(authored.sidechainFrom)) {
      throw createError(ErrorCode.CC5001, {
        name: clipId,
        reason: `sidechain source track "${authored.sidechainFrom}" does not exist`,
      });
    }
    const decoded = await sourceBuffer(authored, options);
    if (!decoded) continue;
    const source =
      decoded.sampleRate === sampleRate ? decoded : resample(decoded, decoded.sampleRate / sampleRate);

    const start = Math.max(0, toSeconds(authored.start, 0, options.conversion));
    const startSample = Math.round(start * sampleRate);
    const remaining = Math.max(0, Math.round(duration * sampleRate) - startSample);
    const declared =
      authored.duration === undefined
        ? remaining
        : Math.round(toSeconds(authored.duration, 0, options.conversion) * sampleRate);
    const requested = Math.min(remaining, declared);
    if (requested <= 0) continue;

    const sourceEnd = source.length / sampleRate;
    const trimStart = Math.max(0, toSeconds(authored.trimStart, 0, options.conversion));
    const trimEnd = toSeconds(authored.trimEnd, Number.NaN, options.conversion);
    if (Number.isFinite(trimEnd) && trimEnd > sourceEnd + 1e-9) {
      throw createError(ErrorCode.CC5001, {
        name: clipId,
        reason: `trimEnd ${trimEnd}s exceeds source duration ${sourceEnd}s`,
      });
    }
    const fromFrame = Math.round(trimStart * sampleRate);
    if (fromFrame >= source.length) {
      throw createError(ErrorCode.CC5001, {
        name: clipId,
        reason: `trimStart ${trimStart}s is past source duration ${sourceEnd}s`,
      });
    }
    const toFrame = Number.isFinite(trimEnd)
      ? Math.min(Math.round(trimEnd * sampleRate), source.length)
      : source.length;
    if (toFrame <= fromFrame) {
      throw createError(ErrorCode.CC5001, {
        name: clipId,
        reason: `trimEnd ${trimEnd}s must be after trimStart ${trimStart}s`,
      });
    }

    let processed = resample(slice(source, fromFrame, toFrame - fromFrame), speed, requested);
    if (authored.reverse) processed = reverse(processed);
    if (authored.loop) processed = loopTo(foldLoopSeam(processed, sampleRate), requested);
    else processed = slice(processed, 0, Math.min(requested, processed.length));

    if ((authored.pan ?? 0) !== 0 && options.channels < 2) {
      recordDegradation({
        code: "CC5001",
        what: "audio pan on mono output",
        reason: `clip "${clipId}" declares pan ${authored.pan}`,
        input: clipId,
        instead: "the clip is mixed without pan",
      });
    }
    if (authored.position3d && options.channels < 2) {
      recordDegradation({
        code: "CC5001",
        what: "3D audio position on mono output",
        reason: `clip "${clipId}" declares position3d`,
        input: clipId,
        instead: "only the distance attenuation of the position is mixed",
      });
    }

    const faded = applyFades(
      processed,
      Math.round(Math.max(0, toSeconds(authored.fadeIn, 0, options.conversion)) * sampleRate),
      Math.round(Math.max(0, toSeconds(authored.fadeOut, 0, options.conversion)) * sampleRate),
    );
    const buffer = authored.position3d
      ? options.channels >= 2
        ? spatialPanBuffer(faded, authored.position3d, 2)
        : attenuate(faded, authored.position3d)
      : faded;

    tracks.push({
      id: `audio-${clipIndex}`,
      name: authored.name,
      sidechainFrom: authored.sidechainFrom,
      buffer,
      startSample,
      endSample: startSample + buffer.length,
      volume: authored.volume ?? 1,
      pan: authored.position3d ? 0 : (authored.pan ?? 0),
      muted: (options.trackMuted ?? false) || (authored.muted ?? false),
    });
  }

  return tracks;
}
