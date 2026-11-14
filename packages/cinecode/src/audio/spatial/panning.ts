import type { AudioBuffer } from "../types.js";
import { onePoleCoefficient, spatialAttenuation, type SpatialPosition } from "./attenuation.js";

export interface StereoGains {
  readonly left: number;
  readonly right: number;
  readonly gain: number;
}

export function computeStereoSpan(position: SpatialPosition): StereoGains {
  const x = position.x ?? 0;
  const z = position.z ?? 0;
  const azimuth = Math.atan2(x, z === 0 ? 1 : z);
  const left = Math.max(0, Math.min(1, Math.cos((azimuth + Math.PI / 2) / 2)));
  const right = Math.max(0, Math.min(1, Math.sin((azimuth + Math.PI / 2) / 2)));
  const attenuation = spatialAttenuation(position);
  return { left: left * attenuation.gain, right: right * attenuation.gain, gain: attenuation.gain };
}

export function applySpatialPanning(source: AudioBuffer, position: SpatialPosition): AudioBuffer {
  const gains = computeStereoSpan(position);
  const channels = 2;
  const data = new Float32Array(source.length * channels);
  const sourceChannels = source.channels;
  const attenuation = spatialAttenuation(position);
  const coefficient = onePoleCoefficient(2200 * attenuation.lowPass, source.sampleRate);
  let lowLeft = 0;
  let lowRight = 0;

  for (let i = 0; i < source.length; i += 1) {
    const leftSample = sourceChannels === 1 ? source.data[i]! : source.data[i * sourceChannels]!;
    const rightSample = sourceChannels === 1 ? source.data[i]! : source.data[i * sourceChannels + 1]!;
    lowLeft = coefficient * lowLeft + (1 - coefficient) * leftSample;
    lowRight = coefficient * lowRight + (1 - coefficient) * rightSample;
    data[i * 2] = lowLeft * gains.left;
    data[i * 2 + 1] = lowRight * gains.right;
  }

  return { sampleRate: source.sampleRate, channels, length: source.length, data };
}

export function spatialPanBuffer(
  buffer: AudioBuffer,
  position: SpatialPosition,
  channelCount: 1 | 2 = 2,
): AudioBuffer {
  if (channelCount === 1) {
    const attenuation = spatialAttenuation(position);
    const data = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i += 1) {
      data[i] = (buffer.data[i * buffer.channels] ?? 0) * attenuation.gain;
    }
    return { sampleRate: buffer.sampleRate, channels: 1, length: buffer.length, data };
  }
  return applySpatialPanning(buffer, position);
}

export function applyDopplerShift(
  source: AudioBuffer,
  radialVelocity: number,
  speedOfSound = 343,
): AudioBuffer {
  if (Math.abs(radialVelocity) < 0.1) return source;
  const ratio = Math.max(0.5, Math.min(2, speedOfSound / (speedOfSound + radialVelocity)));
  const length = Math.max(1, Math.round(source.length / ratio));
  const data = new Float32Array(length * source.channels);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    for (let channel = 0; channel < source.channels; channel += 1) {
      const current = source.data[index * source.channels + channel] ?? 0;
      const next = source.data[(index + 1) * source.channels + channel] ?? current;
      data[i * source.channels + channel] = current + (next - current) * fraction;
    }
  }
  return { sampleRate: source.sampleRate, channels: source.channels, length, data };
}
