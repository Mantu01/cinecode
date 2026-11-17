import { resolve } from "node:path";
import type { AudioClip, SoundClip, TtsClip } from "../core/types/index.js";
import { synthesizeTts } from "../tts/produce.js";
import type { MediaCache } from "../media/cache.js";
import type { AudioBuffer, AudioTrackState } from "./types.js";
import { decodeAudioFile } from "./decode.js";
import { separateStems, type StemName } from "./stem-separation.js";
import { applySpatialPanning } from "./spatial/panning.js";
import type { SpatialPosition } from "./spatial/attenuation.js";
import { recordDegradation } from "../errors/degradations.js";

interface AuthoredAudioClip {
  readonly buffer?: AudioBuffer;
  readonly src?: string;
  readonly start?: number | string;
  readonly duration?: number | string;
  readonly trimStart?: number | string;
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
}

function toSeconds(
  value: number | string | undefined,
  fallback: number,
  fallbackFps: number = 30,
): number {
  if (value === undefined) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (value.includes(":")) {
    const [h = 0, m = 0, s = 0, f = 0] = value.split(":").map(Number);
    return h * 3600 + m * 60 + s + f / fallbackFps;
  }
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

function slice(
  source: AudioBuffer,
  fromFrame: number,
  frameCount: number,
  fadeInFrames: number,
  fadeOutFrames: number,
): AudioBuffer {
  const channels = source.channels;
  const unchanged =
    fromFrame === 0 && frameCount === source.length && fadeInFrames === 0 && fadeOutFrames === 0;
  if (unchanged) return source;

  const data = new Float32Array(frameCount * channels);
  const offset = fromFrame * channels;
  data.set(source.data.subarray(offset, offset + data.length));

  for (let i = 0; i < fadeInFrames && i < frameCount; i++) {
    const gain = i / fadeInFrames;
    for (let c = 0; c < channels; c++) data[i * channels + c]! *= gain;
  }
  for (let i = 0; i < fadeOutFrames && i < frameCount; i++) {
    const frame = frameCount - 1 - i;
    const gain = i / fadeOutFrames;
    for (let c = 0; c < channels; c++) data[frame * channels + c]! *= gain;
  }

  return { sampleRate: source.sampleRate, channels, length: frameCount, data };
}

/**
 * Turns authored audio clips into mixer-ready tracks. Clips either carry a
 * synthesized `buffer` or point at a media file through `src`; file sources are
 * decoded once, then trimmed and faded to the clip's span.
 */
export async function prepareAudioTracks(
  clips: readonly (AudioClip | SoundClip | TtsClip)[],
  options: AudioPrepareOptions,
): Promise<AudioTrackState[]> {
  const { sampleRate, duration } = options;
  const tracks: AudioTrackState[] = [];

  for (const clip of clips) {
    const authored: AuthoredAudioClip =
      clip.type === "tts"
        ? { ...(clip as TtsClip), buffer: await synthesizeTts(clip as TtsClip) }
        : (clip as AuthoredAudioClip);
    const source = await sourceBuffer(authored, options);
    if (!source) continue;

    const start = Math.max(0, toSeconds(authored.start, 0));
    const fromFrame = Math.min(
      Math.round(Math.max(0, toSeconds(authored.trimStart, 0)) * sampleRate),
      source.length,
    );
    const available = source.length - fromFrame;
    if (available <= 0) continue;

    const requested =
      authored.duration === undefined
        ? Math.round(Math.max(0, duration - start) * sampleRate)
        : Math.round(Math.max(0, toSeconds(authored.duration, 0)) * sampleRate);
    const frameCount = Math.min(requested, available);
    if (frameCount <= 0) continue;

    const sliced = slice(
      source,
      fromFrame,
      frameCount,
      Math.round(Math.max(0, toSeconds(authored.fadeIn, 0)) * sampleRate),
      Math.round(Math.max(0, toSeconds(authored.fadeOut, 0)) * sampleRate),
    );
    const buffer = authored.position3d ? applySpatialPanning(sliced, authored.position3d) : sliced;

    const startSample = Math.round(start * sampleRate);
    tracks.push({
      id: `audio-${tracks.length}`,
      name: authored.name,
      sidechainFrom: authored.sidechainFrom,
      buffer,
      startSample,
      endSample: startSample + frameCount,
      volume: authored.volume ?? 1,
      pan: authored.position3d ? 0 : (authored.pan ?? 0),
      muted: (options.trackMuted ?? false) || (authored.muted ?? false),
    });
  }

  return tracks;
}
