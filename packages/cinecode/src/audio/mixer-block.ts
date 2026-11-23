import type { AudioTrackState } from "./types.js";
import { surroundGainsForAzimuth, type ChannelLayout } from "./channels.js";
import { computeSidechainGain, type SidechainCompressParams } from "./sidechain/compress.js";
import type { SidechainConfig } from "./mixer.js";

export interface SidechainPair {
  readonly targetId: string;
  readonly controller: AudioTrackState;
  readonly params: SidechainCompressParams;
  readonly attack: number;
  readonly release: number;
  envelope: number;
}

export function trackKey(track: AudioTrackState): string {
  return track.name ?? track.id;
}

export function followerCoefficient(ms: number, sampleRate: number): number {
  if (ms <= 0) return 0;
  return Math.exp(-1 / ((ms / 1000) * sampleRate));
}

export function buildSidechainPairs(
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

export function fillSidechainGains(
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
    }
    const coeff = level > pair.envelope ? pair.attack : pair.release;
    pair.envelope = coeff * pair.envelope + (1 - coeff) * level;
    gains[frame] = computeSidechainGain(pair.envelope, pair.params);
  }
}

export function hasFiniteSamples(track: AudioTrackState): boolean {
  const { data } = track.buffer;
  for (let i = 0; i < data.length; i += 1) {
    if (!Number.isFinite(data[i])) return false;
  }
  return true;
}

export function mixTrackBlock(
  track: AudioTrackState,
  block: Float32Array,
  blockStart: number,
  frames: number,
  channels: number,
  duckCurve: Float32Array | undefined,
  surroundLayout: ChannelLayout | undefined,
): void {
  const trackChannels = track.buffer.channels;
  const { data } = track.buffer;
  const volume = track.volume;
  const pan = Math.max(-1, Math.min(1, track.pan));
  const panAngle = ((pan + 1) * Math.PI) / 4;
  const panL = Math.cos(panAngle);
  const panR = Math.sin(panAngle);
  const surroundGains =
    track.surroundPosition && surroundLayout
      ? surroundGainsForAzimuth(
          surroundLayout,
          track.surroundPosition.azimuthDegrees,
          track.surroundPosition.lfeSend ?? 0,
        )
      : undefined;

  for (let frame = 0; frame < frames; frame += 1) {
    const timelineFrame = blockStart + frame;
    if (timelineFrame < track.startSample || timelineFrame >= track.endSample) continue;
    const sourceFrame = timelineFrame - track.startSample;
    if (sourceFrame < 0 || sourceFrame >= track.buffer.length) continue;
    const sourceIndex = sourceFrame * trackChannels;
    const outIndex = frame * channels;
    const duck = duckCurve ? (duckCurve[frame] ?? 1) : 1;
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
