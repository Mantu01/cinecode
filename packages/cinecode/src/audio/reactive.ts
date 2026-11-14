import type { AudioBuffer } from "./types.js";
import { fft, magnitude } from "./fft.js";

export const AUDIO_BANDS = {
  subBass: [20, 60],
  bass: [60, 250],
  lowMid: [250, 500],
  mid: [500, 2000],
  upperMid: [2000, 4000],
  presence: [4000, 6000],
  brilliance: [6000, 20000],
} as const;

export type AudioBandName = keyof typeof AUDIO_BANDS;
export type AudioFeatureName = "rms" | "spectralCentroid" | "spectralFlux" | "onset" | "beatConfidence";

export const AUDIO_BAND_NAMES = Object.keys(AUDIO_BANDS) as AudioBandName[];

export interface ReactiveAnalysisFrame {
  readonly timeSeconds: number;
  readonly rms: number;
  readonly bands: Readonly<Record<AudioBandName, number>>;
  readonly spectralCentroid: number;
  readonly spectralFlux: number;
  readonly onset: number;
  readonly beatConfidence: number;
}

export interface AudioReactiveAnalysis {
  readonly sampleRate: number;
  readonly durationSeconds: number;
  readonly frameRate: number;
  readonly frames: readonly ReactiveAnalysisFrame[];
  readonly trackLabels: readonly string[];
}

export interface AnalyzerOptions {
  readonly frameRate?: number;
  readonly windowSize?: number;
  readonly trackLabels?: readonly string[];
}

function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  }
  return window;
}

function bandEnergy(magnitudes: Float32Array, lowHz: number, highHz: number, sampleRate: number): number {
  const nyquist = sampleRate / 2;
  const binWidth = nyquist / magnitudes.length;
  const lowBin = Math.max(0, Math.floor(lowHz / binWidth));
  const highBin = Math.min(magnitudes.length, Math.ceil(highHz / binWidth));
  if (highBin <= lowBin) return 0;
  let sum = 0;
  for (let bin = lowBin; bin < highBin; bin += 1) sum += (magnitudes[bin] ?? 0) ** 2;
  return Math.sqrt(sum / (highBin - lowBin));
}

function normalise(values: readonly number[]): readonly number[] {
  const maximum = values.reduce((highest, value) => Math.max(highest, value), 0);
  if (maximum <= 0) return values.map(() => 0);
  return values.map((value) => value / maximum);
}

export function analyzeAudioReactive(buffer: AudioBuffer, options: AnalyzerOptions = {}): AudioReactiveAnalysis {
  const frameRate = Math.max(1, options.frameRate ?? 60);
  const windowSize = Math.max(64, options.windowSize ?? 2048);
  const hop = Math.max(1, Math.round(buffer.sampleRate / frameRate));
  const window = hannWindow(windowSize);
  const mono = new Float32Array(buffer.length);
  for (let frame = 0; frame < buffer.length; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < buffer.channels; channel += 1) {
      sum += buffer.data[frame * buffer.channels + channel] ?? 0;
    }
    mono[frame] = sum / buffer.channels;
  }

  const rawFrames: {
    timeSeconds: number;
    rms: number;
    bands: Record<AudioBandName, number>;
    spectralCentroid: number;
    spectralFlux: number;
  }[] = [];
  let previousMagnitudes: Float32Array | null = null;

  for (let start = 0; start + windowSize <= mono.length; start += hop) {
    const windowed = new Float32Array(windowSize);
    let sumSquares = 0;
    for (let index = 0; index < windowSize; index += 1) {
      const sample = mono[start + index] ?? 0;
      sumSquares += sample * sample;
      windowed[index] = sample * (window[index] ?? 0);
    }
    const spectrum = magnitude(fft(windowed));
    const bands = {} as Record<AudioBandName, number>;
    for (const name of AUDIO_BAND_NAMES) {
      const [low, high] = AUDIO_BANDS[name];
      bands[name] = bandEnergy(spectrum, low, high, buffer.sampleRate);
    }

    let magnitudeSum = 0;
    let weightedFrequency = 0;
    let flux = 0;
    const binWidth = (buffer.sampleRate / 2) / spectrum.length;
    for (let bin = 0; bin < spectrum.length; bin += 1) {
      const value = spectrum[bin] ?? 0;
      magnitudeSum += value;
      weightedFrequency += value * bin * binWidth;
      if (previousMagnitudes) flux += Math.max(0, value - (previousMagnitudes[bin] ?? 0));
    }
    previousMagnitudes = spectrum;

    rawFrames.push({
      timeSeconds: start / buffer.sampleRate,
      rms: Math.sqrt(sumSquares / windowSize),
      bands,
      spectralCentroid: magnitudeSum > 0 ? weightedFrequency / magnitudeSum : 0,
      spectralFlux: spectrum.length > 0 ? flux / spectrum.length : 0,
    });
  }

  const bandMax: Record<AudioBandName, number> = {} as Record<AudioBandName, number>;
  for (const name of AUDIO_BAND_NAMES) {
    bandMax[name] = rawFrames.reduce((highest, frame) => Math.max(highest, frame.bands[name]), 0) || 1;
  }
  const normalizedRms = normalise(rawFrames.map((frame) => frame.rms));
  const normalizedFlux = normalise(rawFrames.map((frame) => frame.spectralFlux));
  const normalizedCentroid = normalise(rawFrames.map((frame) => frame.spectralCentroid));
  const fluxMean = normalizedFlux.reduce((sum, value) => sum + value, 0) / Math.max(1, normalizedFlux.length);
  const fluxDeviation = Math.sqrt(
    normalizedFlux.reduce((sum, value) => sum + (value - fluxMean) ** 2, 0) / Math.max(1, normalizedFlux.length),
  );
  const onsetThreshold = fluxMean + fluxDeviation;

  const frames: ReactiveAnalysisFrame[] = rawFrames.map((frame, index) => {
    const bands = {} as Record<AudioBandName, number>;
    for (const name of AUDIO_BAND_NAMES) bands[name] = frame.bands[name] / bandMax[name]!;
    const fluxValue = normalizedFlux[index] ?? 0;
    const onset = fluxValue > onsetThreshold ? Math.min(1, fluxValue) : 0;
    return {
      timeSeconds: frame.timeSeconds,
      rms: normalizedRms[index] ?? 0,
      bands,
      spectralCentroid: normalizedCentroid[index] ?? 0,
      spectralFlux: fluxValue,
      onset,
      beatConfidence: Math.min(1, (onset + fluxMean) * 0.75),
    };
  });

  return {
    sampleRate: buffer.sampleRate,
    durationSeconds: buffer.length / buffer.sampleRate,
    frameRate,
    frames,
    trackLabels: options.trackLabels ?? [],
  };
}

export class AudioReactiveAnalyzer {
  private readonly options: AnalyzerOptions;
  private cached: { readonly buffer: AudioBuffer; readonly analysis: AudioReactiveAnalysis } | null = null;

  constructor(options: AnalyzerOptions = {}) {
    this.options = options;
  }

  analyze(buffer: AudioBuffer): AudioReactiveAnalysis {
    if (this.cached && this.cached.buffer === buffer) return this.cached.analysis;
    const analysis = analyzeAudioReactive(buffer, this.options);
    this.cached = { buffer, analysis };
    return analysis;
  }
}

export interface AudioReactiveBinding {
  readonly track?: string;
  readonly band?: AudioBandName;
  readonly feature?: AudioFeatureName;
  readonly min: number;
  readonly max: number;
  readonly smoothing?: number;
  readonly trigger?: "flash" | "none";
  readonly threshold?: number;
  readonly decay?: number;
}

export function audioBinding(options: AudioReactiveBinding): AudioReactiveBinding {
  return { trigger: "none", smoothing: 0.15, threshold: 0, ...options };
}

export function sampleAnalysisFrame(
  analysis: AudioReactiveAnalysis,
  timeSeconds: number,
): ReactiveAnalysisFrame | null {
  if (analysis.frames.length === 0) return null;
  const index = Math.max(0, Math.min(analysis.frames.length - 1, Math.round(timeSeconds * analysis.frameRate)));
  return analysis.frames[index] ?? null;
}

export function featureValue(frame: ReactiveAnalysisFrame, binding: AudioReactiveBinding): number {
  if (binding.band) return frame.bands[binding.band];
  return frame[binding.feature ?? "rms"];
}

export interface AudioReactiveState {
  readonly value: number;
  readonly triggerActive: boolean;
}

export function evaluateAudioBinding(
  binding: AudioReactiveBinding,
  analysis: AudioReactiveAnalysis,
  timeSeconds: number,
  previous?: AudioReactiveState,
): AudioReactiveState {
  const frame = sampleAnalysisFrame(analysis, timeSeconds);
  if (!frame) return { value: binding.min, triggerActive: false };
  const raw = Math.max(0, Math.min(1, featureValue(frame, binding)));
  const smoothing = Math.max(0, Math.min(0.99, binding.smoothing ?? 0.15));
  const span = Math.max(1e-6, binding.max - binding.min);
  const previousNormalized = Math.max(0, Math.min(1, ((previous?.value ?? binding.min) - binding.min) / span));
  const smoothed = previousNormalized + (raw - previousNormalized) * (1 - smoothing);
  const mapped = binding.min + Math.max(0, Math.min(1, smoothed)) * span;

  if ((binding.trigger ?? "none") === "flash") {
    const threshold = binding.threshold ?? 0.5;
    const decay = binding.decay ?? 0.85;
    const active = frame.onset >= threshold;
    const value = active ? 1 : (previous?.value ?? 0) * decay;
    return { value: binding.min + value * (binding.max - binding.min), triggerActive: active };
  }

  return { value: mapped, triggerActive: raw >= (binding.threshold ?? 0) };
}

export function resolveAudioReactiveProperties(
  bindings: Readonly<Record<string, AudioReactiveBinding>>,
  analysis: AudioReactiveAnalysis,
  timeSeconds: number,
  previous?: Readonly<Record<string, AudioReactiveState>>,
): Readonly<Record<string, AudioReactiveState>> {
  const resolved: Record<string, AudioReactiveState> = {};
  for (const [property, binding] of Object.entries(bindings)) {
    resolved[property] = evaluateAudioBinding(binding, analysis, timeSeconds, previous?.[property]);
  }
  return resolved;
}
