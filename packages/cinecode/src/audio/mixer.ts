import type { AudioTrackState, MixResult } from "./types.js";
import { createSilentBuffer } from "./synth/index.js";
import { CHANNEL_LAYOUTS, surroundGainsForAzimuth, type ChannelLayout } from "./channels.js";
import { computeTimelineEnvelope } from "./sidechain/detect.js";
import { sidechainGainCurve } from "./sidechain/compress.js";

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
}

export function createMixer(options: MixerOptions): {
  addTrack: (track: AudioTrackState) => void;
  mix: () => MixResult;
} {
  const { sampleRate, channels, masterVolume, duration } = options;
  const totalSamples = Math.ceil(duration * sampleRate);
  const tracks: AudioTrackState[] = [];

  return {
    addTrack(track: AudioTrackState): void {
      tracks.push(track);
    },

    mix(): MixResult {
      const output = createSilentBuffer(sampleRate, duration, channels);
      const outputData = output.data;
      const gainCurves = resolveSidechainGains(tracks, options.sidechains ?? [], totalSamples, sampleRate);
      let peakLevel = 0;
      let limiterEngaged = false;
      let limiterDuration = 0;
      let limiterPeak = 0;
      let inLimiter = false;
      let limiterStartSample = 0;

      const surroundLayout: ChannelLayout | undefined = channels > 2
        ? Object.values(CHANNEL_LAYOUTS).find((layout) => layout.channels === channels)
        : undefined;

      for (const track of tracks) {
        if (track.muted) continue;
        
        const trackData = track.buffer.data;
        const trackChannels = track.buffer.channels;
        const startSample = track.startSample;
        const endSample = Math.min(track.endSample, totalSamples);
        const trackLength = endSample - startSample;
        
        if (trackLength <= 0) continue;

        const trackVolume = track.volume;
        const gainCurve = gainCurves.get(track.id);
        const pan = track.pan;
        const panL = Math.cos((pan + 1) * Math.PI / 4);
        const panR = Math.sin((pan + 1) * Math.PI / 4);
        const surroundGains = surroundLayout && track.surroundPosition
          ? surroundGainsForAzimuth(
              surroundLayout,
              track.surroundPosition.azimuthDegrees,
              track.surroundPosition.lfeSend ?? 0,
            )
          : null;

        for (let i = 0; i < trackLength; i++) {
          const outIndex = (startSample + i) * channels;
          if (outIndex + (channels - 1) >= outputData.length) break;

          for (let c = 0; c < trackChannels; c++) {
            const sourceIndex = i * trackChannels + c;
            const duck = gainCurve ? (gainCurve[startSample + i] ?? 1) : 1;
            const value = trackData[sourceIndex]! * trackVolume * duck;

            if (channels > 2) {
              if (surroundGains) {
                if (trackChannels === 1) {
                  for (let target = 0; target < channels; target += 1) outputData[outIndex + target]! += value * (surroundGains[target] ?? 0);
                } else {
                  const target = Math.min(channels - 1, c);
                  outputData[outIndex + target]! += value;
                }
              } else if (trackChannels === 1) {
                outputData[outIndex]! += value * 0.707;
                outputData[outIndex + 1]! += value * 0.707;
              } else {
                const target = Math.min(channels - 1, c);
                outputData[outIndex + target]! += value;
              }
            } else if (channels === 2) {
              if (c === 0) {
                outputData[outIndex]! += value * panL;
              } else {
                outputData[outIndex + 1]! += value * panR;
              }
            } else {
              outputData[outIndex]! += value;
            }
          }
        }
      }

      if (masterVolume !== 1) {
        const gain = masterVolume;
        for (let i = 0; i < outputData.length; i++) {
          outputData[i]! *= gain;
        }
      }

      for (let i = 0; i < outputData.length; i++) {
        const abs = Math.abs(outputData[i]!);
        if (abs > peakLevel) peakLevel = abs;
      }

      const limiterThreshold = 0.95;
      const lookahead = Math.floor(0.001 * sampleRate);
      const attackTime = 0.003;
      const releaseTime = 0.1;

      const envelope = new Float32Array(outputData.length);
      let envValue = 1;

      for (let i = 0; i < outputData.length; i++) {
        const lookaheadIndex = Math.min(i + lookahead, outputData.length - 1);
        let maxAhead = 0;
        for (let j = i; j <= lookaheadIndex; j++) {
          const abs = Math.abs(outputData[j]!);
          if (abs > maxAhead) maxAhead = abs;
        }

        const targetGain = maxAhead > limiterThreshold ? limiterThreshold / maxAhead : 1;
        
        if (targetGain < envValue) {
          const attackRate = 1 / (attackTime * sampleRate);
          envValue = Math.max(targetGain, envValue - attackRate);
        } else {
          const releaseRate = 1 / (releaseTime * sampleRate);
          envValue = Math.min(1, envValue + releaseRate);
        }

        envelope[i] = envValue;

        if (envValue < 1 && !inLimiter) {
          inLimiter = true;
          limiterEngaged = true;
          limiterStartSample = i;
        } else if (envValue >= 1 && inLimiter) {
          inLimiter = false;
          limiterDuration += i - limiterStartSample;
          const segmentPeak = Math.max(...outputData.slice(limiterStartSample, i).map(v => Math.abs(v!)));
          if (segmentPeak > limiterPeak) limiterPeak = segmentPeak;
        }
      }

      if (inLimiter) {
        limiterDuration += outputData.length - limiterStartSample;
        const segmentPeak = Math.max(...outputData.slice(limiterStartSample).map(v => Math.abs(v!)));
        if (segmentPeak > limiterPeak) limiterPeak = segmentPeak;
      }

      for (let i = 0; i < outputData.length; i++) {
        outputData[i]! *= envelope[i]!;
      }

      return {
        buffer: output,
        peakLevel,
        limiterEngaged,
        limiterDuration: limiterDuration / sampleRate,
        limiterPeak,
      };
    },
  };
}

function resolveSidechainGains(
  tracks: readonly AudioTrackState[],
  configured: readonly SidechainConfig[],
  totalSamples: number,
  sampleRate: number,
): Map<string, Float32Array> {
  const gains = new Map<string, Float32Array>();
  const pairs: SidechainConfig[] = [...configured];
  for (const track of tracks) {
    if (track.sidechainFrom) {
      pairs.push({
        targetTrackName: track.name ?? track.id,
        sidechainTrackName: track.sidechainFrom,
      });
    }
  }
  for (const pair of pairs) {
    const target = tracks.find((track) => (track.name ?? track.id) === pair.targetTrackName);
    const controller = tracks.find((track) => (track.name ?? track.id) === pair.sidechainTrackName);
    if (!target || !controller || target === controller) continue;
    const envelope = computeTimelineEnvelope(
      controller.buffer,
      controller.startSample,
      totalSamples,
      sampleRate,
      { attackMs: pair.attackMs ?? 10, releaseMs: pair.releaseMs ?? 100 },
    );
    gains.set(target.id, sidechainGainCurve(envelope, {
      threshold: pair.threshold ?? -20,
      ratio: pair.ratio ?? 4,
      kneeWidth: pair.kneeWidth ?? 0,
    }));
  }
  return gains;
}

export function mixAudioTracks(
  tracks: AudioTrackState[],
  options: MixerOptions
): MixResult {
  const mixer = createMixer(options);
  for (const track of tracks) {
    mixer.addTrack(track);
  }
  return mixer.mix();
}