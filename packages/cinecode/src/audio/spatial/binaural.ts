import type { AudioBuffer } from "../types.js";
import { applyDopplerShift } from "./panning.js";
import type { SphericalPosition } from "./ambisonics.js";

export interface BinauralOptions {
  readonly headRadiusM?: number;
  readonly speedOfSound?: number;
  readonly listenerYawDegrees?: number;
  readonly airAbsorption?: boolean;
  readonly radialVelocity?: number;
  readonly impulseLength?: number;
  readonly sampleRate?: number;
}

export interface BinauralImpulseResponse {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly itdSeconds: number;
  readonly ildDb: number;
}

const DEFAULT_HEAD_RADIUS_M = 0.0875;
const DEFAULT_SPEED_OF_SOUND = 343;
const DEFAULT_IMPULSE_LENGTH = 96;

function woodworthDelay(azimuthRadians: number, headRadius: number, speedOfSound: number): number {
  const angle = Math.min(Math.PI / 2, Math.abs(azimuthRadians));
  return (headRadius / speedOfSound) * (angle + Math.sin(angle));
}

export function interauralTimeDifference(
  azimuthDegrees: number,
  options: Pick<BinauralOptions, "headRadiusM" | "speedOfSound"> = {},
): { readonly leftSeconds: number; readonly rightSeconds: number; readonly differenceSeconds: number } {
  const azimuth = (Math.max(-180, Math.min(180, azimuthDegrees)) * Math.PI) / 180;
  const headRadius = options.headRadiusM ?? DEFAULT_HEAD_RADIUS_M;
  const speedOfSound = options.speedOfSound ?? DEFAULT_SPEED_OF_SOUND;
  const magnitude = woodworthDelay(azimuth, headRadius, speedOfSound);
  const side = Math.sign(azimuth);
  return {
    leftSeconds: side >= 0 ? magnitude : 0,
    rightSeconds: side >= 0 ? 0 : magnitude,
    differenceSeconds: magnitude * side,
  };
}

export function interauralLevelDifference(azimuthDegrees: number): number {
  const azimuth = Math.max(-90, Math.min(90, azimuthDegrees));
  return -6 * Math.sin((azimuth * Math.PI) / 180);
}

function softClip(value: number): number {
  return Math.tanh(value);
}

function onePoleLowPassCutoff(distance: number): number {
  const clamped = Math.max(0, distance);
  return 20000 * Math.exp(-clamped * 0.015);
}

function applyAirAbsorption(buffer: AudioBuffer, distance: number): AudioBuffer {
  if (distance <= 1) return buffer;
  const cutoff = Math.max(1200, onePoleLowPassCutoff(distance));
  const coefficient = Math.exp((-2 * Math.PI * cutoff) / buffer.sampleRate);
  const gain = 1 / (1 + distance * 0.15);
  const data = new Float32Array(buffer.data.length);
  const states = new Float64Array(buffer.channels);
  for (let frame = 0; frame < buffer.length; frame += 1) {
    for (let channel = 0; channel < buffer.channels; channel += 1) {
      const index = frame * buffer.channels + channel;
      const previous = states[channel] ?? 0;
      const filtered = previous * coefficient + (buffer.data[index] ?? 0) * (1 - coefficient);
      states[channel] = filtered;
      data[index] = filtered * gain;
    }
  }
  return { ...buffer, data };
}

function pinnaNotchDelay(elevationDegrees: number, sampleRate: number): number {
  const elevation = Math.max(-90, Math.min(90, elevationDegrees));
  const notchFrequency = 6000 + elevation * 35;
  return Math.max(1, Math.round(sampleRate / Math.max(2000, notchFrequency)));
}

export function designBinauralImpulseResponse(
  position: SphericalPosition,
  options: BinauralOptions = {},
): BinauralImpulseResponse {
  const sampleRate = options.sampleRate ?? 48000;
  const azimuth = position.azimuthDegrees - (options.listenerYawDegrees ?? 0);
  const itd = interauralTimeDifference(azimuth, options);
  const ild = interauralLevelDifference(azimuth);
  const length = Math.max(16, options.impulseLength ?? DEFAULT_IMPULSE_LENGTH);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const notchDelay = pinnaNotchDelay(position.elevationDegrees ?? 0, sampleRate);
  const shadowCoefficient = Math.min(0.95, Math.max(0.2, 0.75 - Math.abs(ild) / 24));

  const buildEar = (delaySeconds: number, gainDb: number, ear: Float32Array): void => {
    const delaySamples = Math.min(length - 2, Math.max(0, delaySeconds * sampleRate));
    const delayInteger = Math.floor(delaySamples);
    const fraction = delaySamples - delayInteger;
    const gain = 10 ** (gainDb / 20);
    ear[delayInteger] = (ear[delayInteger] ?? 0) + (1 - fraction) * gain;
    ear[delayInteger + 1] = (ear[delayInteger + 1] ?? 0) + fraction * gain;
    let state = 0;
    for (let index = 0; index < length; index += 1) {
      state = shadowCoefficient * state + (ear[index] ?? 0) * (1 - shadowCoefficient);
      ear[index] = state;
    }
    const notchIndex = delayInteger + notchDelay;
    if (notchIndex < length) ear[notchIndex] = (ear[notchIndex] ?? 0) - gain * 0.3;
    let energy = 0;
    for (let index = 0; index < length; index += 1) energy += (ear[index] ?? 0) ** 2;
    const normalisation = energy > 0 ? 1 / Math.sqrt(energy) : 1;
    for (let index = 0; index < length; index += 1) ear[index] = (ear[index] ?? 0) * normalisation;
  };

  buildEar(itd.leftSeconds, ild / 2, left);
  buildEar(itd.rightSeconds, -ild / 2, right);

  return { left, right, itdSeconds: itd.differenceSeconds, ildDb: ild };
}

function convolve(signal: Float32Array, impulse: Float32Array): Float32Array {
  const output = new Float32Array(signal.length);
  for (let frame = 0; frame < signal.length; frame += 1) {
    let sum = 0;
    for (let tap = 0; tap <= Math.min(frame, impulse.length - 1); tap += 1) {
      sum += (signal[frame - tap] ?? 0) * (impulse[tap] ?? 0);
    }
    output[frame] = sum;
  }
  return output;
}

export function binauralRender(
  buffer: AudioBuffer,
  position: SphericalPosition,
  options: BinauralOptions = {},
): AudioBuffer {
  const source = options.radialVelocity ? applyDopplerShift(buffer, options.radialVelocity) : buffer;
  const prepared = options.airAbsorption === false
    ? source
    : applyAirAbsorption(source, position.distance ?? 0);
  const response = designBinauralImpulseResponse(position, { ...options, sampleRate: prepared.sampleRate });
  const length = prepared.length;
  const mono = new Float32Array(length);
  for (let frame = 0; frame < length; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < prepared.channels; channel += 1) {
      sum += prepared.data[frame * prepared.channels + channel] ?? 0;
    }
    mono[frame] = sum / prepared.channels;
  }

  const left = convolve(mono, response.left);
  const right = convolve(mono, response.right);
  const data = new Float32Array(length * 2);
  for (let frame = 0; frame < length; frame += 1) {
    data[frame * 2] = softClip(left[frame] ?? 0);
    data[frame * 2 + 1] = softClip(right[frame] ?? 0);
  }
  return { sampleRate: prepared.sampleRate, channels: 2, length, data };
}
