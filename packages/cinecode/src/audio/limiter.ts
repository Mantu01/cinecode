import type { AudioBuffer } from "./types.js";

export interface LimiterResult {
  readonly buffer: AudioBuffer;
  readonly engaged: boolean;
  readonly peakLevel: number;
  readonly limiterGain: number;
  readonly limiterDuration: number;
  readonly warningCode: string | null;
  readonly warningMessage: string | null;
}

export interface LimiterOptions {
  readonly threshold: number;
  readonly attackTime: number;
  readonly releaseTime: number;
  readonly lookaheadTime: number;
  readonly sampleRate: number;
}

const DEFAULT_OPTIONS: LimiterOptions = {
  threshold: 0.95,
  attackTime: 0.003,
  releaseTime: 0.1,
  lookaheadTime: 0.001,
  sampleRate: 48000,
};

export function createLimiter(options: Partial<LimiterOptions> = {}): {
  process: (buffer: AudioBuffer) => LimiterResult;
  setThreshold: (threshold: number) => void;
  setAttackTime: (time: number) => void;
  setReleaseTime: (time: number) => void;
} {
  let opts = { ...DEFAULT_OPTIONS, ...options };

  function calculateEnvelope(buffer: AudioBuffer): Float32Array {
    const { data, sampleRate, channels } = buffer;
    const length = data.length / channels;
    const envelope = new Float32Array(length);

    const lookaheadSamples = Math.floor(opts.lookaheadTime * sampleRate);
    const attackRate = 1 / (opts.attackTime * sampleRate);
    const releaseRate = 1 / (opts.releaseTime * sampleRate);

    let envValue = 1;

    for (let i = 0; i < length; i++) {
      let maxAhead = 0;
      const lookaheadEnd = Math.min(i + lookaheadSamples, length - 1);

      for (let j = i; j <= lookaheadEnd; j++) {
        for (let c = 0; c < channels; c++) {
          const abs = Math.abs(data[j * channels + c]!);
          if (abs > maxAhead) maxAhead = abs;
        }
      }

      const targetGain = maxAhead > opts.threshold ? opts.threshold / maxAhead : 1;

      if (targetGain < envValue) {
        envValue = Math.max(targetGain, envValue - attackRate);
      } else {
        envValue = Math.min(1, envValue + releaseRate);
      }

      envelope[i] = envValue;
    }

    return envelope;
  }

  return {
    process(buffer: AudioBuffer): LimiterResult {
      const { data, sampleRate, channels, length } = buffer;
      const envelope = calculateEnvelope(buffer);

      let engaged = false;
      let limiterGain = 1;
      let limiterDuration = 0;
      let inLimiter = false;
      let limiterStartSample = 0;
      let peakLevel = 0;

      for (let i = 0; i < length; i++) {
        for (let c = 0; c < channels; c++) {
          const abs = Math.abs(data[i * channels + c]!);
          if (abs > peakLevel) peakLevel = abs;
        }

        const gain = envelope[i]!;
        if (gain < 1 && !inLimiter) {
          inLimiter = true;
          engaged = true;
          limiterStartSample = i;
        } else if (gain >= 1 && inLimiter) {
          inLimiter = false;
          limiterDuration += (i - limiterStartSample) / sampleRate;
        }

        if (gain < limiterGain) limiterGain = gain;

        for (let c = 0; c < channels; c++) {
          data[i * channels + c]! *= gain;
        }
      }

      if (inLimiter) {
        limiterDuration += (length - limiterStartSample) / sampleRate;
      }

      let warningCode: string | null = null;
      let warningMessage: string | null = null;

      if (engaged) {
        warningCode = "CC5001";
        warningMessage = `Limiter engaged: peak=${peakLevel.toFixed(3)}, gain reduction=${(20 * Math.log10(limiterGain)).toFixed(1)}dB, duration=${limiterDuration.toFixed(3)}s`;
      }

      return {
        buffer,
        engaged,
        peakLevel,
        limiterGain,
        limiterDuration,
        warningCode,
        warningMessage,
      };
    },

    setThreshold(threshold: number): void {
      opts = { ...opts, threshold };
    },

    setAttackTime(attackTime: number): void {
      opts = { ...opts, attackTime };
    },

    setReleaseTime(releaseTime: number): void {
      opts = { ...opts, releaseTime };
    },
  };
}

export function applyLimiter(buffer: AudioBuffer, options: Partial<LimiterOptions> = {}): LimiterResult {
  const limiter = createLimiter(options);
  return limiter.process(buffer);
}

export const TRUE_PEAK_OVERSAMPLING = 4;

const SINC_HALF_TAPS = 8;

function sinc(value: number): number {
  if (Math.abs(value) < 1e-9) return 1;
  const angle = Math.PI * value;
  return Math.sin(angle) / angle;
}

const PHASE_KERNELS: readonly Float64Array[] = (() => {
  const kernels: Float64Array[] = [];
  for (let phase = 0; phase < TRUE_PEAK_OVERSAMPLING; phase += 1) {
    if (phase === 0) {
      const identity = new Float64Array(SINC_HALF_TAPS * 2);
      identity[SINC_HALF_TAPS] = 1;
      kernels.push(identity);
      continue;
    }
    const fraction = phase / TRUE_PEAK_OVERSAMPLING;
    const kernel = new Float64Array(SINC_HALF_TAPS * 2);
    let sum = 0;
    for (let tap = 0; tap < kernel.length; tap += 1) {
      const offset = SINC_HALF_TAPS - tap - 1 + fraction;
      const window = 0.5 + 0.5 * Math.cos((Math.PI * offset) / SINC_HALF_TAPS);
      const weight = sinc(offset) * (Math.abs(offset) < SINC_HALF_TAPS ? window : 0);
      kernel[tap] = weight;
      sum += weight;
    }
    if (sum !== 0) for (let tap = 0; tap < kernel.length; tap += 1) kernel[tap] = kernel[tap]! / sum;
    kernels.push(kernel);
  }
  return kernels;
})();

function interpolatedPeakAt(
  data: Float32Array,
  frameIndex: number,
  channelCount: number,
  channel: number,
  frameCount: number,
): number {
  let peak = Math.abs(data[frameIndex * channelCount + channel] ?? 0);
  for (let phase = 1; phase < TRUE_PEAK_OVERSAMPLING; phase += 1) {
    const kernel = PHASE_KERNELS[phase]!;
    let value = 0;
    for (let tap = 0; tap < kernel.length; tap += 1) {
      const sourceFrame = frameIndex + tap - SINC_HALF_TAPS + 1;
      if (sourceFrame < 0 || sourceFrame >= frameCount) continue;
      value += (data[sourceFrame * channelCount + channel] ?? 0) * kernel[tap]!;
    }
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

export function measureTruePeak(buffer: AudioBuffer): { readonly peak: number; readonly peakDb: number } {
  const { channels, length, data } = buffer;
  let peak = 0;
  for (let frame = 0; frame < length; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = interpolatedPeakAt(data, frame, channels, channel, length);
      if (value > peak) peak = value;
    }
  }
  return { peak, peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity };
}

export function measureTruePeakDb(buffer: AudioBuffer): number {
  return measureTruePeak(buffer).peakDb;
}

export interface TruePeakLimiterOptions {
  readonly ceilingDb?: number;
  readonly lookaheadMs?: number;
  readonly attackMs?: number;
  readonly releaseMs?: number;
  readonly minimumReleaseMs?: number;
  readonly maximumReleaseMs?: number;
}

export interface TruePeakLimiterResult {
  readonly buffer: AudioBuffer;
  readonly engaged: boolean;
  readonly truePeakDbBefore: number;
  readonly truePeakDbAfter: number;
  readonly appliedGainDb: number;
  readonly limiterDuration: number;
  readonly warningCode: string | null;
  readonly warningMessage: string | null;
}

export function applyTruePeakLimiter(
  buffer: AudioBuffer,
  options: TruePeakLimiterOptions = {},
): TruePeakLimiterResult {
  const { sampleRate, channels, length, data } = buffer;
  const ceilingDb = options.ceilingDb ?? -1;
  const ceiling = 10 ** (ceilingDb / 20);
  const hardCeiling = ceiling * 0.98;
  const lookaheadSamples = Math.max(1, Math.round(((options.lookaheadMs ?? 5) / 1000) * sampleRate));
  const attackTime = Math.max(0.00005, (options.attackMs ?? 0.1) / 1000);
  const minimumRelease = Math.max(0.005, (options.minimumReleaseMs ?? 50) / 1000);
  const maximumRelease = Math.max(minimumRelease, (options.maximumReleaseMs ?? 250) / 1000);

  const framePeaks = new Float32Array(length);
  for (let frame = 0; frame < length; frame += 1) {
    let peak = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const value = interpolatedPeakAt(data, frame, channels, channel, length);
      if (value > peak) peak = value;
    }
    framePeaks[frame] = peak;
  }

  const initialPeak = framePeaks.reduce((maximum, value) => Math.max(maximum, value), 0);
  const output = new Float32Array(data.length);
  output.set(data);

  if (initialPeak <= ceiling) {
    return {
      buffer,
      engaged: false,
      truePeakDbBefore: initialPeak > 0 ? 20 * Math.log10(initialPeak) : -Infinity,
      truePeakDbAfter: initialPeak > 0 ? 20 * Math.log10(initialPeak) : -Infinity,
      appliedGainDb: 0,
      limiterDuration: 0,
      warningCode: null,
      warningMessage: null,
    };
  }

  const attackCoefficient = Math.exp(-1 / (attackTime * sampleRate));
  const minimumReleaseCoefficient = Math.exp(-1 / (minimumRelease * sampleRate));
  const maximumReleaseCoefficient = Math.exp(-1 / (maximumRelease * sampleRate));
  const envelope = new Float32Array(length);
  let gain = 1;
  let engaged = false;
  let lowestGain = 1;
  let limitedFrames = 0;

  for (let frame = 0; frame < length; frame += 1) {
    let requiredGain = 1;
    const lookaheadEnd = Math.min(length - 1, frame + lookaheadSamples);
    for (let ahead = frame; ahead <= lookaheadEnd; ahead += 1) {
      const peak = framePeaks[ahead] ?? 0;
      if (peak > ceiling) {
        const candidate = ceiling / peak;
        if (candidate < requiredGain) requiredGain = candidate;
      }
    }

    if (requiredGain < gain) {
      gain = attackCoefficient * gain + (1 - attackCoefficient) * requiredGain;
      limitedFrames += 1;
      engaged = true;
    } else {
      const reduction = Math.min(1, Math.max(0, 1 - requiredGain));
      const releaseSeconds = minimumRelease + (maximumRelease - minimumRelease) * reduction;
      const releaseCoefficient = Math.min(
        maximumReleaseCoefficient,
        Math.max(minimumReleaseCoefficient, Math.exp(-1 / (releaseSeconds * sampleRate))),
      );
      gain = releaseCoefficient * gain + (1 - releaseCoefficient) * 1;
    }

    if (gain < requiredGain) gain = requiredGain;
    if (gain > 1) gain = 1;
    if (gain < lowestGain) lowestGain = gain;
    envelope[frame] = gain;
  }

  for (let frame = 0; frame < length; frame += 1) {
    const delayedFrame = frame - lookaheadSamples;
    if (delayedFrame < 0) {
      const headGain = Math.min(envelope[frame] ?? 1, envelope[0] ?? 1);
      for (let channel = 0; channel < channels; channel += 1) {
        const index = frame * channels + channel;
        const headValue = (output[index] ?? 0) * headGain;
        output[index] = headValue > hardCeiling ? hardCeiling : headValue < -hardCeiling ? -hardCeiling : headValue;
      }
      continue;
    }
    const gainValue = envelope[frame] ?? 1;
    for (let channel = 0; channel < channels; channel += 1) {
      const index = delayedFrame * channels + channel;
      const value = (output[index] ?? 0) * gainValue;
      output[index] = value > hardCeiling ? hardCeiling : value < -hardCeiling ? -hardCeiling : value;
    }
  }

  const tailGain = envelope[length - 1] ?? 1;
  for (let frame = Math.max(0, length - lookaheadSamples); frame < length; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const index = frame * channels + channel;
      const value = (output[index] ?? 0) * tailGain;
      output[index] = value > hardCeiling ? hardCeiling : value < -hardCeiling ? -hardCeiling : value;
    }
  }

  const limited: AudioBuffer = { sampleRate, channels, length, data: output };
  const after = measureTruePeak(limited).peak;
  const warningMessage = engaged
    ? `True-peak limiter engaged: gain reduction=${(20 * Math.log10(lowestGain)).toFixed(1)}dB, limited frames=${limitedFrames}`
    : null;

  return {
    buffer: limited,
    engaged,
    truePeakDbBefore: 20 * Math.log10(initialPeak),
    truePeakDbAfter: after > 0 ? 20 * Math.log10(after) : -Infinity,
    appliedGainDb: 20 * Math.log10(lowestGain),
    limiterDuration: limitedFrames / sampleRate,
    warningCode: engaged ? "CC5002" : null,
    warningMessage,
  };
}
