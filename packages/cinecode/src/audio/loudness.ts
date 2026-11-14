import type { AudioBuffer } from "./types.js";

export interface KWeightingBiquad {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

export interface KWeightingCoefficients {
  readonly shelf: KWeightingBiquad;
  readonly highPass: KWeightingBiquad;
}

const SHELF_FREQUENCY = 1681.974450955533;
const SHELF_GAIN_DB = 3.999843853973347;
const SHELF_Q = 0.7071752369554196;
const HIGH_PASS_FREQUENCY = 38.13547087602444;
const HIGH_PASS_Q = 0.5003270373238773;

export function kWeightingCoefficients(sampleRate: number): KWeightingCoefficients {
  if (!(sampleRate > 0)) throw new Error("CC5101: Sample rate must be positive for K-weighting");

  const shelfK = Math.tan((Math.PI * SHELF_FREQUENCY) / sampleRate);
  const shelfVh = 10 ** (SHELF_GAIN_DB / 20);
  const shelfVb = shelfVh ** 0.4996667741545416;
  const shelfDenominator = 1 + shelfK / SHELF_Q + shelfK * shelfK;
  const shelf: KWeightingBiquad = {
    b0: (shelfVh + (shelfVb * shelfK) / SHELF_Q + shelfK * shelfK) / shelfDenominator,
    b1: (2 * (shelfK * shelfK - shelfVh)) / shelfDenominator,
    b2: (shelfVh - (shelfVb * shelfK) / SHELF_Q + shelfK * shelfK) / shelfDenominator,
    a1: (2 * (shelfK * shelfK - 1)) / shelfDenominator,
    a2: (1 - shelfK / SHELF_Q + shelfK * shelfK) / shelfDenominator,
  };

  const highPassK = Math.tan((Math.PI * HIGH_PASS_FREQUENCY) / sampleRate);
  const highPassDenominator = 1 + highPassK / HIGH_PASS_Q + highPassK * highPassK;
  const highPass: KWeightingBiquad = {
    b0: 1 / highPassDenominator,
    b1: -2 / highPassDenominator,
    b2: 1 / highPassDenominator,
    a1: (2 * (highPassK * highPassK - 1)) / highPassDenominator,
    a2: (1 - highPassK / HIGH_PASS_Q + highPassK * highPassK) / highPassDenominator,
  };

  return { shelf, highPass };
}

function processBiquad(input: Float32Array, coefficients: KWeightingBiquad): Float32Array {
  const { b0, b1, b2, a1, a2 } = coefficients;
  const output = new Float32Array(input.length);
  let state1 = 0;
  let state2 = 0;
  for (let index = 0; index < input.length; index += 1) {
    const sample = input[index] ?? 0;
    const value = b0 * sample + state1;
    state1 = b1 * sample - a1 * value + state2;
    state2 = b2 * sample - a2 * value;
    output[index] = value;
  }
  return output;
}

export function applyKWeighting(samples: Float32Array, sampleRate: number): Float32Array {
  const coefficients = kWeightingCoefficients(sampleRate);
  return processBiquad(processBiquad(samples, coefficients.shelf), coefficients.highPass);
}

export function defaultChannelWeights(channels: number): readonly number[] {
  if (channels === 6) return [1, 1, 1, 0, 1.41, 1.41];
  if (channels === 8) return [1, 1, 1, 0, 1.41, 1.41, 1.41, 1.41];
  return Array.from({ length: channels }, () => 1);
}

export interface LoudnessOptions {
  readonly channelWeights?: readonly number[];
  readonly blockDurationSeconds?: number;
  readonly hopSeconds?: number;
  readonly absoluteGateLufs?: number;
  readonly relativeGateLu?: number;
}

export interface LoudnessBlock {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly lufs: number;
  readonly channelEnergies: readonly number[];
}

export interface LoudnessMeasurement {
  readonly integratedLufs: number;
  readonly blockLufs: readonly LoudnessBlock[];
  readonly gatedBlockCount: number;
  readonly blockCount: number;
  readonly momentaryLufs: readonly { readonly timeSeconds: number; readonly lufs: number }[];
  readonly shortTermLufs: readonly { readonly timeSeconds: number; readonly lufs: number }[];
}

const LOUDNESS_OFFSET = -0.691;
const DEFAULT_BLOCK_SECONDS = 0.4;
const DEFAULT_HOP_SECONDS = 0.1;
const DEFAULT_ABSOLUTE_GATE = -70;
const DEFAULT_RELATIVE_GATE_LU = 10;

function weightsFor(buffer: AudioBuffer, options: LoudnessOptions): readonly number[] {
  const weights = options.channelWeights ?? defaultChannelWeights(buffer.channels);
  if (weights.length < buffer.channels) {
    return Array.from({ length: buffer.channels }, (_, index) => weights[index] ?? 1);
  }
  return weights;
}

function weightedEnergy(channelEnergies: readonly number[], weights: readonly number[]): number {
  let total = 0;
  for (let channel = 0; channel < channelEnergies.length; channel += 1) {
    total += (weights[channel] ?? 1) * (channelEnergies[channel] ?? 0);
  }
  return total;
}

function energyToLufs(energy: number): number {
  return energy > 0 ? LOUDNESS_OFFSET + 10 * Math.log10(energy) : -Infinity;
}

export function measureLoudness(buffer: AudioBuffer, options: LoudnessOptions = {}): LoudnessMeasurement {
  const { sampleRate, channels, length, data } = buffer;
  const weights = weightsFor(buffer, options);
  const weightedChannels: Float32Array[] = [];
  for (let channel = 0; channel < channels; channel += 1) {
    const extracted = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      extracted[index] = data[index * channels + channel] ?? 0;
    }
    weightedChannels.push(applyKWeighting(extracted, sampleRate));
  }

  const blockSamples = Math.max(1, Math.round((options.blockDurationSeconds ?? DEFAULT_BLOCK_SECONDS) * sampleRate));
  const hopSamples = Math.max(1, Math.round((options.hopSeconds ?? DEFAULT_HOP_SECONDS) * sampleRate));
  const absoluteGate = options.absoluteGateLufs ?? DEFAULT_ABSOLUTE_GATE;
  const relativeGate = options.relativeGateLu ?? DEFAULT_RELATIVE_GATE_LU;

  const blocks: LoudnessBlock[] = [];
  for (let start = 0; start + blockSamples <= length; start += hopSamples) {
    const channelEnergies: number[] = [];
    for (let channel = 0; channel < channels; channel += 1) {
      const samples = weightedChannels[channel]!;
      let sum = 0;
      for (let index = start; index < start + blockSamples; index += 1) {
        const value = samples[index] ?? 0;
        sum += value * value;
      }
      channelEnergies.push(sum / blockSamples);
    }
    const lufs = energyToLufs(weightedEnergy(channelEnergies, weights));
    blocks.push({
      startSeconds: start / sampleRate,
      endSeconds: (start + blockSamples) / sampleRate,
      lufs,
      channelEnergies,
    });
  }

  const absoluteGated = blocks.filter((block) => block.lufs > absoluteGate);
  let integratedLufs = -Infinity;
  let gatedBlockCount = 0;
  if (absoluteGated.length > 0) {
    const absoluteMean = absoluteGated.reduce(
      (total, block) => total + weightedEnergy(block.channelEnergies, weights),
      0,
    ) / absoluteGated.length;
    const relativeThreshold = energyToLufs(absoluteMean) - relativeGate;
    const finalGated = absoluteGated.filter((block) => block.lufs > relativeThreshold);
    gatedBlockCount = finalGated.length;
    if (finalGated.length > 0) {
      const finalMean = finalGated.reduce(
        (total, block) => total + weightedEnergy(block.channelEnergies, weights),
        0,
      ) / finalGated.length;
      integratedLufs = energyToLufs(finalMean);
    }
  }

  return {
    integratedLufs,
    blockLufs: blocks,
    gatedBlockCount,
    blockCount: blocks.length,
    momentaryLufs: slidingLoudness(weightedChannels, weights, sampleRate, 0.4, 0.1, length),
    shortTermLufs: slidingLoudness(weightedChannels, weights, sampleRate, 3, 0.1, length),
  };
}

function slidingLoudness(
  weightedChannels: readonly Float32Array[],
  weights: readonly number[],
  sampleRate: number,
  windowSeconds: number,
  hopSeconds: number,
  length: number,
): { readonly timeSeconds: number; readonly lufs: number }[] {
  const windowSamples = Math.max(1, Math.round(windowSeconds * sampleRate));
  const hopSamples = Math.max(1, Math.round(hopSeconds * sampleRate));
  const result: { timeSeconds: number; lufs: number }[] = [];
  if (length < windowSamples) return result;

  const prefixSums = weightedChannels.map((samples) => {
    const sums = new Float64Array(length + 1);
    for (let index = 0; index < length; index += 1) {
      const value = samples[index] ?? 0;
      sums[index + 1] = (sums[index] ?? 0) + value * value;
    }
    return sums;
  });

  for (let start = 0; start + windowSamples <= length; start += hopSamples) {
    let energy = 0;
    for (let channel = 0; channel < weightedChannels.length; channel += 1) {
      const sums = prefixSums[channel]!;
      const sum = (sums[start + windowSamples] ?? 0) - (sums[start] ?? 0);
      energy += (weights[channel] ?? 1) * (sum / windowSamples);
    }
    result.push({ timeSeconds: start / sampleRate, lufs: energyToLufs(energy) });
  }
  return result;
}

export function measureIntegratedLoudness(buffer: AudioBuffer, options: LoudnessOptions = {}): number {
  return measureLoudness(buffer, options).integratedLufs;
}

export function measureMomentaryLoudness(
  buffer: AudioBuffer,
  options: LoudnessOptions = {},
): readonly { readonly timeSeconds: number; readonly lufs: number }[] {
  return measureLoudness(buffer, options).momentaryLufs;
}

export function measureShortTermLoudness(
  buffer: AudioBuffer,
  options: LoudnessOptions = {},
): readonly { readonly timeSeconds: number; readonly lufs: number }[] {
  return measureLoudness(buffer, options).shortTermLufs;
}
