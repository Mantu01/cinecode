import type { AudioBuffer } from "../types.js";

export interface SphericalPosition {
  readonly azimuthDegrees: number;
  readonly elevationDegrees?: number;
  readonly distance?: number;
}

export interface FirstOrderAmbisonics {
  readonly sampleRate: number;
  readonly length: number;
  readonly w: Float32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
}

export interface AmbisonicEncodeOptions {
  readonly gain?: number;
  readonly normalisation?: "sn3d" | "n3d";
}

function distanceGain(distance: number | undefined): number {
  if (distance === undefined || distance <= 1) return 1;
  return 1 / distance;
}

export function sphericalToUnitVector(position: SphericalPosition): readonly [number, number, number] {
  const azimuth = (position.azimuthDegrees * Math.PI) / 180;
  const elevation = ((position.elevationDegrees ?? 0) * Math.PI) / 180;
  const cosineElevation = Math.cos(elevation);
  return [
    cosineElevation * Math.cos(azimuth),
    cosineElevation * Math.sin(azimuth),
    Math.sin(elevation),
  ];
}

export function encodeToFirstOrder(
  buffer: AudioBuffer,
  position: SphericalPosition,
  options: AmbisonicEncodeOptions = {},
): FirstOrderAmbisonics {
  const [forward, left, up] = sphericalToUnitVector(position);
  const normalisation = options.normalisation ?? "sn3d";
  const wScale = normalisation === "n3d" ? 1 : Math.SQRT1_2;
  const gain = (options.gain ?? 1) * distanceGain(position.distance);
  const { sampleRate, channels, length, data } = buffer;

  const w = new Float32Array(length);
  const x = new Float32Array(length);
  const y = new Float32Array(length);
  const z = new Float32Array(length);

  for (let frame = 0; frame < length; frame += 1) {
    let monoSample = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      monoSample += data[frame * channels + channel] ?? 0;
    }
    monoSample = (monoSample / channels) * gain;
    w[frame] = monoSample * wScale;
    x[frame] = monoSample * forward;
    y[frame] = monoSample * left;
    z[frame] = monoSample * up;
  }

  return { sampleRate, length, w, x, y, z };
}

export function rotateFirstOrder(
  foa: FirstOrderAmbisonics,
  yawDegrees: number,
  pitchDegrees = 0,
): FirstOrderAmbisonics {
  const yaw = (yawDegrees * Math.PI) / 180;
  const pitch = (pitchDegrees * Math.PI) / 180;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const { w, x, y, z } = foa;
  const rotatedX = new Float32Array(x.length);
  const rotatedY = new Float32Array(x.length);
  const rotatedZ = new Float32Array(x.length);

  for (let index = 0; index < x.length; index += 1) {
    const sampleX = x[index] ?? 0;
    const sampleY = y[index] ?? 0;
    const sampleZ = z[index] ?? 0;
    const yawX = sampleX * cosYaw + sampleY * sinYaw;
    const yawY = -sampleX * sinYaw + sampleY * cosYaw;
    rotatedX[index] = yawX * cosPitch + sampleZ * sinPitch;
    rotatedY[index] = yawY;
    rotatedZ[index] = -yawX * sinPitch + sampleZ * cosPitch;
  }

  return { sampleRate: foa.sampleRate, length: foa.length, w, x: rotatedX, y: rotatedY, z: rotatedZ };
}

export function decodeFirstOrderToStereo(
  foa: FirstOrderAmbisonics,
  options: { readonly headYawDegrees?: number } = {},
): AudioBuffer {
  const rotated = options.headYawDegrees ? rotateFirstOrder(foa, options.headYawDegrees) : foa;
  const data = new Float32Array(rotated.length * 2);
  for (let index = 0; index < rotated.length; index += 1) {
    const w = rotated.w[index] ?? 0;
    const x = rotated.x[index] ?? 0;
    const y = rotated.y[index] ?? 0;
    const z = rotated.z[index] ?? 0;
    data[index * 2] = Math.SQRT1_2 * w + 0.5 * y + 0.25 * x + 0.25 * z;
    data[index * 2 + 1] = Math.SQRT1_2 * w - 0.5 * y + 0.25 * x + 0.25 * z;
  }
  return { sampleRate: rotated.sampleRate, channels: 2, length: rotated.length, data };
}

export function bFormatChannels(foa: FirstOrderAmbisonics): readonly Float32Array[] {
  return [foa.w, foa.x, foa.y, foa.z];
}
