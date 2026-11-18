import type { SeededRandom } from "../core/random/index.js";

export interface AudioBuffer {
  readonly sampleRate: number;
  readonly channels: number;
  readonly length: number;
  readonly data: Float32Array;
}

export interface AudioClipSource {
  readonly type: "file" | "synthesis";
  readonly src?: string;
  readonly soundRef?: string;
  readonly params?: Record<string, unknown>;
  readonly trimStart: number;
  readonly trimEnd: number;
  readonly speed: number;
  readonly reverse: boolean;
  readonly volume: number;
  readonly fadeIn: number;
  readonly fadeOut: number;
  readonly pan: number;
  readonly muted: boolean;
}

export interface SoundDefinition {
  readonly name: string;
  readonly parameters: readonly SoundParameter[];
  readonly render: (ctx: SoundRenderContext) => AudioBuffer;
}

export interface SoundParameter {
  readonly name: string;
  readonly type: "number" | "boolean" | "string";
  readonly default: unknown;
  readonly min?: number;
  readonly max?: number;
  readonly description?: string;
}

export interface SoundRenderContext {
  readonly sampleRate: number;
  readonly duration: number;
  readonly params: Record<string, unknown>;
  readonly rng: SeededRandom;
}

export interface OscillatorOptions {
  readonly type: "sine" | "square" | "sawtooth" | "triangle" | "white-noise" | "pink-noise";
  readonly frequency: number;
  readonly detune: number;
  readonly unison: UnisonOptions;
  readonly phase: number;
}

export interface UnisonOptions {
  readonly voices: number;
  readonly detune: number;
  readonly stereoWidth: number;
}

export interface EnvelopeOptions {
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
  readonly curve: "linear" | "exponential";
}

export interface FilterOptions {
  readonly type: "low-pass" | "high-pass" | "band-pass" | "notch";
  readonly cutoff: number;
  readonly resonance: number;
}

export interface LFOOptions {
  readonly shape: "sine" | "square" | "triangle" | "sawtooth";
  readonly rate: number;
  readonly depth: number;
  readonly phase: number;
  readonly target: "pitch" | "volume" | "filter-cutoff" | "pan";
}

export interface NoteEvent {
  readonly start: number;
  readonly length: number;
  readonly pitch: number | string;
  readonly velocity: number;
}

export interface SoundNotePattern {
  readonly notes: readonly NoteEvent[];
  readonly envelope: EnvelopeOptions;
  readonly oscillators: readonly OscillatorOptions[];
  readonly filter?: FilterOptions;
  readonly lfo?: LFOOptions;
}

export interface SurroundPosition {
  readonly azimuthDegrees: number;
  readonly elevationDegrees?: number;
  readonly distance?: number;
  readonly lfeSend?: number;
}

export interface AudioTrackState {
  readonly id: string;
  readonly name?: string;
  readonly sidechainFrom?: string;
  readonly surroundPosition?: SurroundPosition;
  readonly buffer: AudioBuffer;
  readonly startSample: number;
  readonly endSample: number;
  readonly volume: number;
  readonly pan: number;
  readonly muted: boolean;
}

export interface ExcludedTrack {
  readonly id: string;
  readonly name?: string;
  readonly reason: string;
}

export interface MixAllocation {
  readonly blockFrames: number;
  readonly scratchBytes: number;
  readonly outputBytes: number;
}

export interface ChannelConversion {
  readonly id: string;
  readonly name?: string;
  readonly from: number;
  readonly to: number;
  readonly kind: "upmix" | "downmix";
}

export interface MixReport {
  readonly durationSeconds: number;
  readonly tracksMixed: number;
  readonly mutedTracks: readonly string[];
  readonly excludedTracks: readonly ExcludedTrack[];
  readonly channelConversions: readonly ChannelConversion[];
  readonly peakBeforeLimit: number;
  readonly peakAfterLimit: number;
  readonly limiterEngaged: boolean;
  readonly silent: boolean;
  readonly allocation: MixAllocation;
}

export interface MixResult {
  readonly buffer: AudioBuffer;
  readonly peakLevel: number;
  readonly limiterEngaged: boolean;
  readonly limiterDuration: number;
  readonly limiterPeak: number;
  readonly report: MixReport;
}