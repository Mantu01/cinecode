import type { AudioBuffer } from "./types.js";

export type ChannelLayoutName = "mono" | "stereo" | "quad" | "5.1" | "7.1";
export type ChannelRole = "C" | "FL" | "FR" | "LFE" | "SL" | "SR" | "BL" | "BR";

export interface ChannelLayout {
  readonly name: ChannelLayoutName;
  readonly channels: number;
  readonly roles: readonly ChannelRole[];
  readonly ffmpegLayout: string;
}

export const CHANNEL_LAYOUTS: Readonly<Record<ChannelLayoutName, ChannelLayout>> = {
  mono: { name: "mono", channels: 1, roles: ["C"], ffmpegLayout: "mono" },
  stereo: { name: "stereo", channels: 2, roles: ["FL", "FR"], ffmpegLayout: "stereo" },
  quad: { name: "quad", channels: 4, roles: ["FL", "FR", "SL", "SR"], ffmpegLayout: "quad" },
  "5.1": { name: "5.1", channels: 6, roles: ["FL", "FR", "C", "LFE", "SL", "SR"], ffmpegLayout: "5.1" },
  "7.1": { name: "7.1", channels: 8, roles: ["FL", "FR", "C", "LFE", "SL", "SR", "BL", "BR"], ffmpegLayout: "7.1" },
};

export function getChannelLayout(name: ChannelLayoutName): ChannelLayout {
  return CHANNEL_LAYOUTS[name];
}

export function channelCountForLayout(name: ChannelLayoutName): number {
  return CHANNEL_LAYOUTS[name].channels;
}

export function layoutNameForChannelCount(channels: number): ChannelLayoutName | null {
  const match = Object.values(CHANNEL_LAYOUTS).find((layout) => layout.channels === channels);
  return match?.name ?? null;
}

export function ffmpegLayoutForChannelCount(channels: number): string | undefined {
  const layout = Object.values(CHANNEL_LAYOUTS).find((candidate) => candidate.channels === channels);
  return layout?.ffmpegLayout;
}

export function roleIndex(layout: ChannelLayout, role: ChannelRole): number {
  return layout.roles.indexOf(role);
}

export interface StereoToSurroundOptions {
  readonly crossoverHz?: number;
  readonly surroundGain?: number;
  readonly centreGain?: number;
  readonly lfeGain?: number;
  readonly decorrelationDelayMs?: number;
}

const DEFAULT_UPMIX: Required<StereoToSurroundOptions> = {
  crossoverHz: 80,
  surroundGain: 0.707,
  centreGain: 0.707,
  lfeGain: 0.5,
  decorrelationDelayMs: 12,
};

function lowPassCoefficients(cutoffHz: number, sampleRate: number, q = 0.7071067811865476): {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
} {
  const frequency = Math.max(1, Math.min(sampleRate * 0.49, cutoffHz));
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const alpha = sine / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 - cosine) / 2) / a0,
    b1: (1 - cosine) / a0,
    b2: ((1 - cosine) / 2) / a0,
    a1: (-2 * cosine) / a0,
    a2: (1 - alpha) / a0,
  };
}

function applyLowPass(samples: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  const stages = [
    lowPassCoefficients(cutoffHz, sampleRate, 0.5411961),
    lowPassCoefficients(cutoffHz, sampleRate, 1.306562965),
  ];
  let current = samples;
  for (const coefficients of stages) {
    const output = new Float32Array(current.length);
    let state1 = 0;
    let state2 = 0;
    for (let index = 0; index < current.length; index += 1) {
      const sample = current[index] ?? 0;
      const value = coefficients.b0 * sample + state1;
      state1 = coefficients.b1 * sample - coefficients.a1 * value + state2;
      state2 = coefficients.b2 * sample - coefficients.a2 * value;
      output[index] = value;
    }
    current = output;
  }
  return current;
}

export function upmixBuffer(
  buffer: AudioBuffer,
  target: Exclude<ChannelLayoutName, "mono" | "stereo">,
  options: StereoToSurroundOptions = {},
): AudioBuffer {
  const settings = { ...DEFAULT_UPMIX, ...options };
  const layout = CHANNEL_LAYOUTS[target];
  const { sampleRate, length } = buffer;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    if (buffer.channels === 1) {
      left[index] = buffer.data[index] ?? 0;
      right[index] = buffer.data[index] ?? 0;
    } else {
      left[index] = buffer.data[index * buffer.channels] ?? 0;
      right[index] = buffer.data[index * buffer.channels + 1] ?? 0;
    }
  }

  const mono = new Float32Array(length);
  for (let index = 0; index < length; index += 1) mono[index] = ((left[index] ?? 0) + (right[index] ?? 0)) * 0.5;
  const centre = new Float32Array(length);
  const lfe = applyLowPass(mono, settings.crossoverHz, sampleRate);
  const difference = new Float32Array(length);
  for (let index = 0; index < length; index += 1) difference[index] = ((left[index] ?? 0) - (right[index] ?? 0)) * 0.5;

  const delaySamples = Math.max(1, Math.round((settings.decorrelationDelayMs / 1000) * sampleRate));
  const surroundLeft = new Float32Array(length);
  const surroundRight = new Float32Array(length);
  const backLeft = new Float32Array(length);
  const backRight = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const delayedIndex = index - delaySamples;
    const surroundSample = delayedIndex >= 0 ? difference[delayedIndex] ?? 0 : 0;
    const backIndex = index - delaySamples * 2;
    const backSample = backIndex >= 0 ? difference[backIndex] ?? 0 : 0;
    centre[index] = mono[index]! * settings.centreGain;
    surroundLeft[index] = surroundSample * settings.surroundGain;
    surroundRight[index] = -surroundSample * settings.surroundGain;
    backLeft[index] = backSample * settings.surroundGain;
    backRight[index] = -backSample * settings.surroundGain;
  }

  const data = new Float32Array(length * layout.channels);
  const write = (role: ChannelRole, samples: Float32Array): void => {
    const channel = roleIndex(layout, role);
    if (channel < 0) return;
    for (let index = 0; index < length; index += 1) {
      data[index * layout.channels + channel] = samples[index] ?? 0;
    }
  };

  write("FL", left);
  write("FR", right);
  write("C", centre);
  write("LFE", lfe.map((sample) => sample * settings.lfeGain) as Float32Array);
  write("SL", surroundLeft);
  write("SR", surroundRight);
  write("BL", backLeft);
  write("BR", backRight);
  return { sampleRate, channels: layout.channels, length, data };
}

export interface SurroundDownmixOptions {
  readonly surroundGain?: number;
  readonly centreGain?: number;
  readonly lfeGain?: number;
  readonly normalize?: boolean;
}

const DEFAULT_DOWNMIX: Required<SurroundDownmixOptions> = {
  surroundGain: 0.707,
  centreGain: 0.707,
  lfeGain: 0.5,
  normalize: true,
};

export function downmixToStereo(buffer: AudioBuffer, options: SurroundDownmixOptions = {}): AudioBuffer {
  if (buffer.channels <= 2) return buffer;
  const settings = { ...DEFAULT_DOWNMIX, ...options };
  const layout = Object.values(CHANNEL_LAYOUTS).find((candidate) => candidate.channels === buffer.channels);
  const { sampleRate, length, channels, data } = buffer;
  const output = new Float32Array(length * 2);
  const hasLayout = layout !== undefined;
  const role = (name: ChannelRole): number => (hasLayout ? roleIndex(layout, name) : -1);

  const leftIndex = hasLayout ? role("FL") : 0;
  const rightIndex = hasLayout ? role("FR") : 1;
  const centreIndex = role("C");
  const lfeIndex = role("LFE");
  const surroundLeftIndex = role("SL");
  const surroundRightIndex = role("SR");
  const backLeftIndex = role("BL");
  const backRightIndex = role("BR");

  const read = (frame: number, channelIndex: number): number =>
    channelIndex >= 0 && channelIndex < channels ? data[frame * channels + channelIndex] ?? 0 : 0;

  const gainSum = 1 + settings.centreGain + settings.surroundGain * (hasLayout && layout.channels >= 8 ? 2 : 1);
  const normalization = settings.normalize ? 1 / gainSum : 1;

  for (let frame = 0; frame < length; frame += 1) {
    const left = read(frame, leftIndex)
      + read(frame, centreIndex) * settings.centreGain
      + read(frame, surroundLeftIndex) * settings.surroundGain
      + read(frame, backLeftIndex) * settings.surroundGain
      + read(frame, lfeIndex) * settings.lfeGain;
    const right = read(frame, rightIndex)
      + read(frame, centreIndex) * settings.centreGain
      + read(frame, surroundRightIndex) * settings.surroundGain
      + read(frame, backRightIndex) * settings.surroundGain
      + read(frame, lfeIndex) * settings.lfeGain;
    output[frame * 2] = left * normalization;
    output[frame * 2 + 1] = right * normalization;
  }

  return { sampleRate, channels: 2, length, data: output };
}

export function surroundGainsForAzimuth(layout: ChannelLayout, azimuthDegrees: number, lfeSend = 0): readonly number[] {
  const azimuth = ((azimuthDegrees % 360) + 360) % 360;
  const speakers: readonly { role: ChannelRole; angle: number }[] = [
    { role: "FL", angle: 330 },
    { role: "FR", angle: 30 },
    { role: "C", angle: 0 },
    { role: "SL", angle: 270 },
    { role: "SR", angle: 90 },
    { role: "BL", angle: 210 },
    { role: "BR", angle: 150 },
  ];
  const gains = layout.roles.map(() => 0);
  let total = 0;
  for (const speaker of speakers) {
    const index = roleIndex(layout, speaker.role);
    if (index < 0) continue;
    const distance = Math.abs(((azimuth - speaker.angle + 540) % 360) - 180);
    const weight = Math.max(0, 1 - distance / 90);
    const gain = weight * weight;
    gains[index] = gain;
    total += gain;
  }
  if (total > 0) {
    for (let index = 0; index < gains.length; index += 1) gains[index] = gains[index]! / total;
  } else {
    const left = roleIndex(layout, "FL");
    const right = roleIndex(layout, "FR");
    if (left >= 0) gains[left] = 0.5;
    if (right >= 0) gains[right] = 0.5;
  }
  const lfeIndex = roleIndex(layout, "LFE");
  if (lfeIndex >= 0) gains[lfeIndex] = Math.max(0, Math.min(1, lfeSend));
  return gains;
}

export function convertChannelLayout(buffer: AudioBuffer, target: ChannelLayoutName): AudioBuffer {
  const targetLayout = CHANNEL_LAYOUTS[target];
  if (buffer.channels === targetLayout.channels) return buffer;
  if (target === "mono") {
    const data = new Float32Array(buffer.length);
    for (let frame = 0; frame < buffer.length; frame += 1) {
      let sum = 0;
      for (let channel = 0; channel < buffer.channels; channel += 1) sum += buffer.data[frame * buffer.channels + channel] ?? 0;
      data[frame] = sum / buffer.channels;
    }
    return { sampleRate: buffer.sampleRate, channels: 1, length: buffer.length, data };
  }
  if (target === "stereo") return downmixToStereo(buffer);
  if (buffer.channels > targetLayout.channels) return downmixToStereo(buffer);
  return upmixBuffer(buffer, target);
}
