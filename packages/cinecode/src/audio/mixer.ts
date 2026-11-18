import type { AudioTrackState, ChannelConversion, ExcludedTrack, MixResult } from "./types.js";
import { createSilentBuffer } from "./synth/index.js";
import { CHANNEL_LAYOUTS, surroundGainsForAzimuth, type ChannelLayout } from "./channels.js";
import { computeSidechainGain, type SidechainCompressParams } from "./sidechain/compress.js";
import { recordDegradation } from "../errors/degradations.js";

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
const LIMITER_CEILING = 0.95;
const LIMITER_LOOKAHEAD_SECONDS = 0.001;
const LIMITER_RELEASE_SECONDS = 0.1;

interface SidechainPair {
  readonly targetId: string;
  readonly controller: AudioTrackState;
  readonly params: SidechainCompressParams;
  readonly attack: number;
  readonly release: number;
  envelope: number;
}

function trackKey(track: AudioTrackState): string {
  return track.name ?? track.id;
}

function followerCoefficient(ms: number, sampleRate: number): number {
  if (ms <= 0) return 0;
  return Math.exp(-1 / ((ms / 1000) * sampleRate));
}

function buildSidechainPairs(
  tracks: readonly AudioTrackState[],
  configured: readonly SidechainConfig[],
  sampleRate: number,
): SidechainPair[] {
  const requested: SidechainConfig[] = [...configured];
  for (const track of tracks) {
    if (track.sidechainFrom) {
      requested.push({
        targetTrackName: trackKey(track),
        sidechainTrackName: track.sidechainFrom,
      });
    }
  }
  const byTarget = new Map<string, SidechainPair>();
  for (const pair of requested) {
    const target = tracks.find((track) => trackKey(track) === pair.targetTrackName);
    const controller = tracks.find((track) => trackKey(track) === pair.sidechainTrackName);
    if (!target || !controller || target === controller) continue;
    byTarget.set(target.id, {
      targetId: target.id,
      controller,
      params: {
        threshold: pair.threshold ?? -20,
        ratio: pair.ratio ?? 4,
        kneeWidth: pair.kneeWidth ?? 0,
      },
      attack: followerCoefficient(pair.attackMs ?? 10, sampleRate),
      release: followerCoefficient(pair.releaseMs ?? 100, sampleRate),
      envelope: 0,
    });
  }
  return [...byTarget.values()];
}

function fillSidechainGains(
  pair: SidechainPair,
  gains: Float32Array,
  blockStart: number,
  frames: number,
): void {
  const { controller } = pair;
  for (let frame = 0; frame < frames; frame += 1) {
    const sourceFrame = blockStart + frame - controller.startSample;
    let level = 0;
    if (sourceFrame >= 0 && sourceFrame < controller.buffer.length) {
      const base = sourceFrame * controller.buffer.channels;
      for (let channel = 0; channel < controller.buffer.channels; channel += 1) {
        const value = Math.abs(controller.buffer.data[base + channel]!);
        if (value > level) level = value;
      }
      level = Math.min(1, level);
    }
    const coefficient = level > pair.envelope ? pair.attack : pair.release;
    pair.envelope = coefficient * pair.envelope + (1 - coefficient) * level;
    gains[frame] = computeSidechainGain(pair.envelope, pair.params);
  }
}

function hasFiniteSamples(track: AudioTrackState): boolean {
  const { data } = track.buffer;
  for (let i = 0; i < data.length; i += 1) {
    if (!Number.isFinite(data[i])) return false;
  }
  return Number.isFinite(track.volume) && Number.isFinite(track.pan);
}

function mixTrackBlock(
  track: AudioTrackState,
  block: Float32Array,
  blockStart: number,
  frames: number,
  channels: number,
  gainCurve: Float32Array | undefined,
  surroundLayout: ChannelLayout | undefined,
): void {
  const from = Math.max(blockStart, track.startSample);
  const to = Math.min(blockStart + frames, track.endSample);
  if (to <= from) return;
  const trackChannels = track.buffer.channels;
  const data = track.buffer.data;
  const volume = track.volume;
  const pan = track.pan;
  const panL = Math.cos(((pan + 1) * Math.PI) / 4);
  const panR = Math.sin(((pan + 1) * Math.PI) / 4);
  const surroundGains =
    surroundLayout && track.surroundPosition
      ? surroundGainsForAzimuth(
          surroundLayout,
          track.surroundPosition.azimuthDegrees,
          track.surroundPosition.lfeSend ?? 0,
        )
      : null;

  for (let frame = from; frame < to; frame += 1) {
    const offset = frame - blockStart;
    const outIndex = offset * channels;
    const sourceIndex = (frame - track.startSample) * trackChannels;
    const duck = gainCurve ? (gainCurve[offset] ?? 1) : 1;
    const gain = volume * duck;
    if (channels === 1) {
      let sum = 0;
      for (let channel = 0; channel < trackChannels; channel += 1) sum += data[sourceIndex + channel]!;
      block[outIndex]! += (sum / trackChannels) * gain;
      continue;
    }
    if (channels === 2) {
      if (trackChannels === 1) {
        const value = data[sourceIndex]! * gain;
        block[outIndex]! += value * panL;
        block[outIndex + 1]! += value * panR;
      } else {
        block[outIndex]! += data[sourceIndex]! * gain * panL;
        block[outIndex + 1]! += data[sourceIndex + 1]! * gain * panR;
      }
      continue;
    }
    for (let channel = 0; channel < trackChannels; channel += 1) {
      const value = data[sourceIndex + channel]! * gain;
      if (surroundGains) {
        if (trackChannels === 1) {
          for (let target = 0; target < channels; target += 1) {
            block[outIndex + target]! += value * (surroundGains[target] ?? 0);
          }
        } else {
          block[outIndex + Math.min(channels - 1, channel)]! += value;
        }
      } else if (trackChannels === 1) {
        block[outIndex]! += value * 0.707;
        block[outIndex + 1]! += value * 0.707;
      } else {
        block[outIndex + Math.min(channels - 1, channel)]! += value;
      }
    }
  }
}

interface BlockLimiter {
  processBlock(data: Float32Array, blockStart: number, frames: number): void;
  readonly peakAfter: number;
  readonly engaged: boolean;
  readonly limitedFrames: number;
}

function createBlockLimiter(
  sampleRate: number,
  channels: number,
  totalFrames: number,
): BlockLimiter {
  const lookahead = Math.max(0, Math.min(Math.round(sampleRate * LIMITER_LOOKAHEAD_SECONDS), totalFrames - 1));
  if (lookahead === 0) {
    return {
      processBlock(): void {},
      peakAfter: 0,
      engaged: false,
      limitedFrames: 0,
    };
  }
  const delay = new Float32Array(lookahead * channels);
  const queueSize = lookahead + 1;
  const queue = new Float32Array(queueSize);
  const release = 1 - Math.exp(-1 / (LIMITER_RELEASE_SECONDS * sampleRate));
  let write = 0;
  let head = 0;
  let count = 0;
  let gain = 1;
  let rampStep = 0;
  let engaged = false;
  let limitedFrames = 0;
  let peakAfter = 0;

  return {
    processBlock(data: Float32Array, blockStart: number, frames: number): void {
      for (let frame = 0; frame < frames; frame += 1) {
        const base = (blockStart + frame) * channels;
        let peak = 0;
        for (let channel = 0; channel < channels; channel += 1) {
          const value = Math.abs(data[base + channel] ?? 0);
          if (value > peak) peak = value;
        }
        const required = peak > LIMITER_CEILING ? LIMITER_CEILING / peak : 1;

        while (count > 0 && queue[(head + count - 1) % queueSize]! >= required) count -= 1;
        queue[(head + count) % queueSize] = required;
        count += 1;
        if (count > queueSize) {
          head = (head + 1) % queueSize;
          count -= 1;
        }
        const windowMin = queue[head]!;

        if (windowMin < gain) {
          if (rampStep === 0) rampStep = (gain - windowMin) / lookahead;
          gain = Math.max(windowMin, gain - rampStep);
        } else {
          rampStep = 0;
          gain += (windowMin - gain) * release;
          if (gain > windowMin) gain = windowMin;
        }

        const ringBase = write * channels;
        for (let channel = 0; channel < channels; channel += 1) {
          const delayed = delay[ringBase + channel]!;
          delay[ringBase + channel] = data[base + channel] ?? 0;
          let value = delayed * gain;
          if (value > LIMITER_CEILING) value = LIMITER_CEILING;
          else if (value < -LIMITER_CEILING) value = -LIMITER_CEILING;
          data[base + channel] = value;
          const abs = Math.abs(value);
          if (abs > peakAfter) peakAfter = abs;
        }
        write = (write + 1) % lookahead;

        if (gain < 0.9999) {
          engaged = true;
          limitedFrames += 1;
        }
      }
    },
    get peakAfter(): number {
      return peakAfter;
    },
    get engaged(): boolean {
      return engaged;
    },
    get limitedFrames(): number {
      return limitedFrames;
    },
  };
}

function runMix(tracks: readonly AudioTrackState[], options: MixerOptions): MixResult {
  const { sampleRate, channels, duration } = options;
  const masterVolume = Number.isFinite(options.masterVolume) ? options.masterVolume : 1;
  const blockFrames = Math.max(1, Math.floor(options.blockSize ?? DEFAULT_BLOCK_FRAMES));
  const output = createSilentBuffer(sampleRate, duration, channels);
  const totalFrames = output.length;

  const mutedTracks: string[] = [];
  const excludedTracks: ExcludedTrack[] = [];
  const audible: AudioTrackState[] = [];
  for (const track of tracks) {
    if (track.muted) {
      mutedTracks.push(trackKey(track));
      continue;
    }
    if (!hasFiniteSamples(track)) {
      excludedTracks.push({
        id: track.id,
        name: track.name,
        reason: "non-finite samples",
      });
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

  const scratch = new Float32Array(blockFrames * channels);
  let peakBefore = 0;

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
      output.data[blockStart * channels + i] = value;
      const abs = Math.abs(value);
      if (abs > peakBefore) peakBefore = abs;
    }
  }

  if (peakBefore > 1) {
    const normalization = 1 / peakBefore;
    for (let i = 0; i < output.data.length; i += 1) output.data[i]! *= normalization;
  }

  const limiter = createBlockLimiter(sampleRate, channels, totalFrames);
  for (let blockStart = 0; blockStart < totalFrames; blockStart += blockFrames) {
    limiter.processBlock(output.data, blockStart, Math.min(blockFrames, totalFrames - blockStart));
  }

  return {
    buffer: output,
    peakLevel: peakBefore,
    limiterEngaged: limiter.engaged,
    limiterDuration: limiter.limitedFrames / sampleRate,
    limiterPeak: limiter.peakAfter,
    report: {
      durationSeconds: duration,
      tracksMixed: audible.length,
      mutedTracks,
      excludedTracks,
      channelConversions,
      peakBeforeLimit: peakBefore,
      peakAfterLimit: limiter.peakAfter,
      limiterEngaged: limiter.engaged,
      silent: audible.length === 0 || peakBefore < AUDIBLE_PEAK_THRESHOLD,
      allocation: {
        blockFrames,
        scratchBytes: scratch.byteLength + pairGains.reduce((sum, curve) => sum + curve.byteLength, 0),
        outputBytes: output.data.byteLength,
      },
    },
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
