import type {
  AudioBlockConsumer,
  AudioStreamSource,
  AudioTrackState,
  ChannelConversion,
  ExcludedTrack,
  MixReport,
  MixResult,
} from "./types.js";
import { createSilentBuffer } from "./synth/index.js";
import { CHANNEL_LAYOUTS, type ChannelLayout } from "./channels.js";
import { recordDegradation } from "../errors/degradations.js";
import { createBlockLimiter } from "./mixer-limiter.js";
import {
  trackKey,
  buildSidechainPairs,
  fillSidechainGains,
  hasFiniteSamples,
  mixTrackBlock,
} from "./mixer-block.js";

export { createBlockLimiter } from "./mixer-limiter.js";
export { trackKey, mixTrackBlock } from "./mixer-block.js";

export interface SidechainConfig {
  readonly targetTrackName: string;
  readonly sidechainTrackName: string;
  readonly threshold?: number;
  readonly ratio?: number;
  readonly attackMs?: number;
  readonly releaseMs?: number;
  readonly kneeWidth?: number;
}

export interface MixerOptions {
  readonly sampleRate: number;
  readonly channels: number;
  readonly masterVolume: number;
  readonly duration: number;
  readonly sidechains?: readonly SidechainConfig[];
  readonly blockSize?: number;
}

const DEFAULT_BLOCK_FRAMES = 4096;
/** Peaks below -60 dBFS count as silence for the mux decision. */
export const AUDIBLE_PEAK_THRESHOLD = 0.001;

export function createAudioStreamMixer(
  tracks: readonly AudioTrackState[],
  options: MixerOptions,
): AudioStreamSource & {
  readonly report: MixReport;
  streamBlocksSync(consumer: (block: Float32Array, frames: number) => void): { peak: number; limited: boolean };
} {
  const { sampleRate, channels, duration } = options;
  const masterVolume = Number.isFinite(options.masterVolume) ? options.masterVolume : 1;
  const blockFrames = Math.max(1, Math.floor(options.blockSize ?? DEFAULT_BLOCK_FRAMES));
  const totalFrames = Math.max(0, Math.round(duration * sampleRate));

  const mutedTracks: string[] = [];
  const excludedTracks: ExcludedTrack[] = [];
  const audible: AudioTrackState[] = [];
  for (const track of tracks) {
    if (track.muted) {
      mutedTracks.push(trackKey(track));
      continue;
    }
    if (!hasFiniteSamples(track)) {
      excludedTracks.push({ id: track.id, name: track.name, reason: "non-finite samples" });
      recordDegradation({
        code: "CC5001",
        what: "audio track excluded from the mix",
        reason: `track "${trackKey(track)}" contains non-finite samples`,
        input: trackKey(track),
        instead: "the remaining tracks are mixed",
      });
      continue;
    }
    audible.push(track);
  }

  const surroundLayout: ChannelLayout | undefined =
    channels > 2
      ? Object.values(CHANNEL_LAYOUTS).find((layout) => layout.channels === channels)
      : undefined;
  const channelConversions: ChannelConversion[] = [];
  for (const track of audible) {
    const from = track.buffer.channels;
    if (from === channels) continue;
    const kind = from < channels ? "upmix" : "downmix";
    channelConversions.push({ id: track.id, name: track.name, from, to: channels, kind });
    if (kind === "downmix") {
      recordDegradation({
        code: "CC5001",
        what: "audio channel downmix",
        reason: `track "${trackKey(track)}" has ${from} channels, the output has ${channels}`,
        input: trackKey(track),
        instead: "channels are averaged into the output layout",
      });
    }
  }

  const pairs = buildSidechainPairs(audible, options.sidechains ?? [], sampleRate);
  const pairGains = pairs.map(() => new Float32Array(blockFrames));
  const pairLookup = new Map<string, number>();
  pairs.forEach((pair, index) => pairLookup.set(pair.targetId, index));

  let peakEstimate = 0;
  for (const track of audible) {
    const bLen = track.buffer.data.length;
    for (let i = 0; i < Math.min(bLen, 50000); i += 100) {
      const v = Math.abs(track.buffer.data[i]!);
      if (v > peakEstimate) peakEstimate = v;
    }
  }

  const report: MixReport = {
    durationSeconds: duration,
    tracksMixed: audible.length,
    mutedTracks,
    excludedTracks,
    channelConversions,
    peakBeforeLimit: peakEstimate,
    peakAfterLimit: Math.min(1, peakEstimate),
    limiterEngaged: peakEstimate > 0.95,
    silent: audible.length === 0,
    allocation: {
      blockFrames,
      scratchBytes: blockFrames * channels * 4 + pairGains.reduce((sum, curve) => sum + curve.byteLength, 0),
      outputBytes: 0,
    },
  };

  return {
    sampleRate,
    channels,
    duration,
    totalFrames,
    report,
    streamBlocksSync(consumer: (block: Float32Array, frames: number) => void): { peak: number; limited: boolean } {
      const scratch = new Float32Array(blockFrames * channels);
      const limiter = createBlockLimiter(sampleRate, channels, totalFrames);
      let localPeak = 0;
      for (let blockStart = 0; blockStart < totalFrames; blockStart += blockFrames) {
        const frames = Math.min(blockFrames, totalFrames - blockStart);
        const span = frames * channels;
        scratch.fill(0, 0, span);
        for (let index = 0; index < pairs.length; index += 1) {
          fillSidechainGains(pairs[index]!, pairGains[index]!, blockStart, frames);
        }
        for (const track of audible) {
          const curveIndex = pairLookup.get(track.id);
          mixTrackBlock(
            track,
            scratch,
            blockStart,
            frames,
            channels,
            curveIndex === undefined ? undefined : pairGains[curveIndex],
            surroundLayout,
          );
        }
        for (let i = 0; i < span; i += 1) {
          const mixed = scratch[i]! * masterVolume;
          const value = Number.isFinite(mixed) ? (Math.abs(mixed) < 1e-25 ? 0 : mixed) : 0;
          scratch[i] = value;
          const abs = Math.abs(value);
          if (abs > localPeak) localPeak = abs;
        }
        limiter.processBlock(scratch, 0, frames);
        consumer(scratch, frames);
      }
      return { peak: limiter.peakAfter, limited: limiter.engaged };
    },
    async streamBlocks(consumer: AudioBlockConsumer, signal?: AbortSignal): Promise<{ peak: number; limited: boolean }> {
      const scratch = new Float32Array(blockFrames * channels);
      const limiter = createBlockLimiter(sampleRate, channels, totalFrames);
      let localPeak = 0;

      for (let blockStart = 0; blockStart < totalFrames; blockStart += blockFrames) {
        if (signal?.aborted) throw new Error("Audio mixing cancelled");
        const frames = Math.min(blockFrames, totalFrames - blockStart);
        const span = frames * channels;
        scratch.fill(0, 0, span);

        for (let index = 0; index < pairs.length; index += 1) {
          fillSidechainGains(pairs[index]!, pairGains[index]!, blockStart, frames);
        }
        for (const track of audible) {
          const curveIndex = pairLookup.get(track.id);
          mixTrackBlock(
            track,
            scratch,
            blockStart,
            frames,
            channels,
            curveIndex === undefined ? undefined : pairGains[curveIndex],
            surroundLayout,
          );
        }
        for (let i = 0; i < span; i += 1) {
          const mixed = scratch[i]! * masterVolume;
          const value = Number.isFinite(mixed) ? (Math.abs(mixed) < 1e-25 ? 0 : mixed) : 0;
          scratch[i] = value;
          const abs = Math.abs(value);
          if (abs > localPeak) localPeak = abs;
        }

        limiter.processBlock(scratch, 0, frames);
        await consumer(scratch, frames);
      }

      return { peak: limiter.peakAfter, limited: limiter.engaged };
    },
  };
}

function runMix(tracks: readonly AudioTrackState[], options: MixerOptions): MixResult {
  const { sampleRate, channels, duration } = options;
  const streamSource = createAudioStreamMixer(tracks, options);
  const totalFrames = streamSource.totalFrames;
  const isLongTimeline = duration > 30;
  const output = isLongTimeline
    ? { sampleRate, channels, length: totalFrames, data: new Float32Array(0) }
    : createSilentBuffer(sampleRate, duration, channels);

  if (isLongTimeline) {
    return {
      buffer: output,
      peakLevel: streamSource.report.peakBeforeLimit,
      limiterEngaged: streamSource.report.limiterEngaged,
      limiterDuration: 0,
      limiterPeak: streamSource.report.peakAfterLimit,
      report: streamSource.report,
      streamSource,
    };
  }

  let offset = 0;
  const result = streamSource.streamBlocksSync((block, frames) => {
    output.data.set(block.subarray(0, frames * channels), offset);
    offset += frames * channels;
  });

  return {
    buffer: output,
    peakLevel: streamSource.report.peakBeforeLimit,
    limiterEngaged: result.limited,
    limiterDuration: 0,
    limiterPeak: result.peak,
    report: {
      ...streamSource.report,
      peakAfterLimit: result.peak,
      limiterEngaged: result.limited,
      silent: tracks.length === 0 || streamSource.report.peakBeforeLimit < AUDIBLE_PEAK_THRESHOLD,
    },
    streamSource,
  };
}

export function createMixer(options: MixerOptions): {
  addTrack: (track: AudioTrackState) => void;
  mix: () => MixResult;
} {
  const tracks: AudioTrackState[] = [];
  return {
    addTrack(track: AudioTrackState): void {
      tracks.push(track);
    },
    mix(): MixResult {
      return runMix(tracks, options);
    },
  };
}

export function mixAudioTracks(tracks: AudioTrackState[], options: MixerOptions): MixResult {
  return runMix(tracks, options);
}
