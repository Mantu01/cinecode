import type { AudioBuffer } from "./types.js";

export type EqFilterType = "low-cut" | "low-shelf" | "peaking" | "notch" | "high-shelf" | "high-cut";

export interface EqBand {
  readonly type: EqFilterType;
  readonly frequency: number;
  readonly gainDb?: number;
  readonly q?: number;
  readonly slope?: number;
  readonly enabled?: boolean;
}

export interface EqCoefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

export interface EqState {
  s1: number;
  s2: number;
}

export const MAX_EQ_BANDS = 8;

export function eqBandCoefficients(band: EqBand, sampleRate: number): EqCoefficients {
  const frequency = Math.max(10, Math.min(sampleRate * 0.49, band.frequency));
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const q = Math.max(0.1, Math.min(18, band.q ?? 0.7071067811865476));
  const gainDb = Math.max(-24, Math.min(24, band.gainDb ?? 0));
  const amplitude = 10 ** (gainDb / 40);
  const alpha = sine / (2 * q);
  const shelfAlpha = (sine / 2) * Math.sqrt(Math.max(0.001, (amplitude + 1 / amplitude) * (1 / (band.slope ?? 1) - 1) + 2));

  switch (band.type) {
    case "low-cut": {
      const a0 = 1 + alpha;
      return {
        b0: ((1 + cosine) / 2) / a0,
        b1: (-(1 + cosine)) / a0,
        b2: ((1 + cosine) / 2) / a0,
        a1: (-2 * cosine) / a0,
        a2: (1 - alpha) / a0,
      };
    }
    case "high-cut": {
      const a0 = 1 + alpha;
      return {
        b0: ((1 - cosine) / 2) / a0,
        b1: (1 - cosine) / a0,
        b2: ((1 - cosine) / 2) / a0,
        a1: (-2 * cosine) / a0,
        a2: (1 - alpha) / a0,
      };
    }
    case "notch": {
      const a0 = 1 + alpha;
      return {
        b0: 1 / a0,
        b1: (-2 * cosine) / a0,
        b2: 1 / a0,
        a1: (-2 * cosine) / a0,
        a2: (1 - alpha) / a0,
      };
    }
    case "low-shelf": {
      const a0 = (amplitude + 1) + (amplitude - 1) * cosine + 2 * Math.sqrt(amplitude) * shelfAlpha;
      return {
        b0: (amplitude * ((amplitude + 1) - (amplitude - 1) * cosine + 2 * Math.sqrt(amplitude) * shelfAlpha)) / a0,
        b1: (2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosine)) / a0,
        b2: (amplitude * ((amplitude + 1) - (amplitude - 1) * cosine - 2 * Math.sqrt(amplitude) * shelfAlpha)) / a0,
        a1: (-2 * ((amplitude - 1) + (amplitude + 1) * cosine)) / a0,
        a2: ((amplitude + 1) + (amplitude - 1) * cosine - 2 * Math.sqrt(amplitude) * shelfAlpha) / a0,
      };
    }
    case "high-shelf": {
      const a0 = (amplitude + 1) - (amplitude - 1) * cosine + 2 * Math.sqrt(amplitude) * shelfAlpha;
      return {
        b0: (amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + 2 * Math.sqrt(amplitude) * shelfAlpha)) / a0,
        b1: (-2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine)) / a0,
        b2: (amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - 2 * Math.sqrt(amplitude) * shelfAlpha)) / a0,
        a1: (2 * ((amplitude - 1) - (amplitude + 1) * cosine)) / a0,
        a2: ((amplitude + 1) - (amplitude - 1) * cosine - 2 * Math.sqrt(amplitude) * shelfAlpha) / a0,
      };
    }
    default: {
      const a0 = 1 + alpha / amplitude;
      return {
        b0: (1 + alpha * amplitude) / a0,
        b1: (-2 * cosine) / a0,
        b2: (1 - alpha * amplitude) / a0,
        a1: (-2 * cosine) / a0,
        a2: (1 - alpha / amplitude) / a0,
      };
    }
  }
}

function processBinary(input: Float32Array, coefficients: EqCoefficients, state: EqState): Float32Array {
  const output = new Float32Array(input.length);
  let s1 = state.s1;
  let s2 = state.s2;
  for (let index = 0; index < input.length; index += 1) {
    const sample = input[index] ?? 0;
    const value = coefficients.b0 * sample + s1;
    s1 = coefficients.b1 * sample - coefficients.a1 * value + s2;
    s2 = coefficients.b2 * sample - coefficients.a2 * value;
    output[index] = value;
  }
  state.s1 = s1;
  state.s2 = s2;
  return output;
}

function cascadeCount(type: EqFilterType): number {
  return type === "low-cut" || type === "high-cut" ? 2 : 1;
}

export class ParametricEq {
  private bands: EqBand[];
  private readonly sampleRate: number;
  private readonly states: EqState[];

  constructor(bands: readonly EqBand[], sampleRate: number) {
    if (bands.length > MAX_EQ_BANDS) throw new Error(`CC5301: EQ supports at most ${MAX_EQ_BANDS} bands`);
    this.bands = [...bands];
    this.sampleRate = sampleRate;
    this.states = this.bands.map(() => ({ s1: 0, s2: 0 }));
  }

  getBands(): readonly EqBand[] {
    return this.bands;
  }

  setBand(index: number, band: EqBand): void {
    if (index < 0 || index >= this.bands.length) return;
    this.bands[index] = band;
  }

  setBands(bands: readonly EqBand[]): void {
    if (bands.length > MAX_EQ_BANDS) throw new Error(`CC5301: EQ supports at most ${MAX_EQ_BANDS} bands`);
    this.bands = [...bands];
    while (this.states.length < this.bands.length) this.states.push({ s1: 0, s2: 0 });
  }

  reset(): void {
    for (const state of this.states) {
      state.s1 = 0;
      state.s2 = 0;
    }
  }

  process(buffer: AudioBuffer): AudioBuffer {
    const { sampleRate, channels, length, data } = buffer;
    const output = new Float32Array(data);
    for (let bandIndex = 0; bandIndex < this.bands.length; bandIndex += 1) {
      const band = this.bands[bandIndex]!;
      if (band.enabled === false) continue;
      const state = this.states[bandIndex]!;
      const coefficients = eqBandCoefficients(band, this.sampleRate);
      for (let channel = 0; channel < channels; channel += 1) {
        const extracted = new Float32Array(length);
        for (let frame = 0; frame < length; frame += 1) extracted[frame] = output[frame * channels + channel] ?? 0;
        let processed: Float32Array = extracted;
        for (let pass = 0; pass < cascadeCount(band.type); pass += 1) {
          processed = processBinary(processed, coefficients, state);
        }
        for (let frame = 0; frame < length; frame += 1) output[frame * channels + channel] = processed[frame] ?? 0;
      }
    }
    return { sampleRate, channels, length, data: output };
  }

  magnitudeAt(frequency: number): number {
    let magnitude = 1;
    for (const band of this.bands) {
      if (band.enabled === false) continue;
      const coefficients = eqBandCoefficients(band, this.sampleRate);
      magnitude *= biquadMagnitude(coefficients, frequency, this.sampleRate) ** cascadeCount(band.type);
    }
    return magnitude;
  }
}

export function biquadMagnitude(coefficients: EqCoefficients, frequency: number, sampleRate: number): number {
  const omega = (2 * Math.PI) / sampleRate * frequency;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const cosine2 = Math.cos(2 * omega);
  const sine2 = Math.sin(2 * omega);
  const numeratorReal = coefficients.b0 + coefficients.b1 * cosine + coefficients.b2 * cosine2;
  const numeratorImaginary = -(coefficients.b1 * sine + coefficients.b2 * sine2);
  const denominatorReal = 1 + coefficients.a1 * cosine + coefficients.a2 * cosine2;
  const denominatorImaginary = -(coefficients.a1 * sine + coefficients.a2 * sine2);
  return Math.hypot(numeratorReal, numeratorImaginary) / Math.max(1e-12, Math.hypot(denominatorReal, denominatorImaginary));
}

export const EQ_PRESETS: Readonly<Record<string, readonly EqBand[]>> = {
  "dialogue-clarity": [
    { type: "low-cut", frequency: 80, q: 0.707 },
    { type: "peaking", frequency: 400, gainDb: -2.5, q: 1.1 },
    { type: "peaking", frequency: 3000, gainDb: 3, q: 1.0 },
  ],
  "warm-voice": [
    { type: "low-cut", frequency: 75, q: 0.707 },
    { type: "low-shelf", frequency: 200, gainDb: 2.5, slope: 1 },
  ],
  "podcast-master": [
    { type: "low-cut", frequency: 70, q: 0.707 },
    { type: "peaking", frequency: 300, gainDb: -2, q: 1.2 },
    { type: "peaking", frequency: 2500, gainDb: 2.5, q: 1.0 },
    { type: "high-shelf", frequency: 12000, gainDb: 2, slope: 1 },
  ],
  telephone: [
    { type: "low-cut", frequency: 400, q: 1.2 },
    { type: "high-cut", frequency: 3500, q: 1.2 },
    { type: "peaking", frequency: 1800, gainDb: 4, q: 2 },
  ],
};

export function eqPresetBands(name: keyof typeof EQ_PRESETS): readonly EqBand[] {
  return EQ_PRESETS[name] ?? [];
}

export function applyEq(
  buffer: AudioBuffer,
  bandsOrPreset: readonly EqBand[] | keyof typeof EQ_PRESETS,
  sampleRate = buffer.sampleRate,
): AudioBuffer {
  const bands = typeof bandsOrPreset === "string" ? eqPresetBands(bandsOrPreset) : bandsOrPreset;
  const eq = new ParametricEq(bands, sampleRate);
  return eq.process(buffer);
}

export interface EqAutomationKeyframe {
  readonly timeSeconds: number;
  readonly bands: readonly EqBand[];
}

function interpolateBand(from: EqBand, to: EqBand, progress: number): EqBand {
  const lerp = (a: number | undefined, b: number | undefined, fallback: number): number =>
    (a ?? fallback) + ((b ?? a ?? fallback) - (a ?? fallback)) * progress;
  return {
    type: from.type,
    frequency: lerp(from.frequency, to.frequency, from.frequency),
    gainDb: lerp(from.gainDb, to.gainDb, 0),
    q: lerp(from.q, to.q, 0.7071067811865476),
    slope: lerp(from.slope, to.slope, 1),
    enabled: from.enabled,
  };
}

export function applyAutomatedEq(
  buffer: AudioBuffer,
  keyframes: readonly EqAutomationKeyframe[],
  options: { readonly blockSeconds?: number } = {},
): AudioBuffer {
  if (keyframes.length === 0) return buffer;
  const sorted = [...keyframes].sort((left, right) => left.timeSeconds - right.timeSeconds);
  const sampleRate = buffer.sampleRate;
  const channels = buffer.channels;
  const blockFrames = Math.max(1, Math.round((options.blockSeconds ?? 0.05) * sampleRate));
  const output = new Float32Array(buffer.data.length);
  const eq = new ParametricEq(sorted[0]!.bands, sampleRate);

  for (let start = 0; start < buffer.length; start += blockFrames) {
    const end = Math.min(buffer.length, start + blockFrames);
    const timeSeconds = start / sampleRate;
    let previous = sorted[0]!;
    let next = sorted[sorted.length - 1]!;
    for (let index = 0; index < sorted.length; index += 1) {
      const candidate = sorted[index]!;
      if (candidate.timeSeconds >= timeSeconds) {
        next = candidate;
        previous = sorted[Math.max(0, index - 1)]!;
        break;
      }
    }
    const span = next.timeSeconds - previous.timeSeconds;
    const progress = span <= 0 ? 1 : Math.max(0, Math.min(1, (timeSeconds - previous.timeSeconds) / span));
    const bandCount = Math.max(previous.bands.length, next.bands.length);
    const bands: EqBand[] = [];
    for (let index = 0; index < bandCount; index += 1) {
      const from = previous.bands[index] ?? next.bands[index]!;
      const to = next.bands[index] ?? previous.bands[index]!;
      bands.push(interpolateBand(from, to, progress));
    }
    eq.setBands(bands);
    const blockLength = end - start;
    const blockData = new Float32Array(blockLength * channels);
    for (let frame = 0; frame < blockLength; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        blockData[frame * channels + channel] = buffer.data[(start + frame) * channels + channel] ?? 0;
      }
    }
    const processed = eq.process({ sampleRate, channels, length: blockLength, data: blockData });
    output.set(processed.data, start * channels);
  }
  return { sampleRate, channels, length: buffer.length, data: output };
}
