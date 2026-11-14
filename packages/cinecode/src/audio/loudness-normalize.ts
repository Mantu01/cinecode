import type { AudioBuffer } from "./types.js";
import { measureLoudness } from "./loudness.js";
import { applyTruePeakLimiter, measureTruePeakDb } from "./limiter.js";
import { scaleBuffer } from "./metering.js";

export interface LoudnessPreset {
  readonly name: string;
  readonly targetLufs: number;
  readonly maxTruePeakDb: number;
}

export const LOUDNESS_PRESETS: Readonly<Record<string, LoudnessPreset>> = {
  youtube: { name: "youtube", targetLufs: -14, maxTruePeakDb: -1 },
  spotify: { name: "spotify", targetLufs: -14, maxTruePeakDb: -1 },
  "apple-music": { name: "apple-music", targetLufs: -16, maxTruePeakDb: -1 },
  podcast: { name: "podcast", targetLufs: -16, maxTruePeakDb: -1 },
  "ebu-r128": { name: "ebu-r128", targetLufs: -23, maxTruePeakDb: -1 },
  "atsc-a85": { name: "atsc-a85", targetLufs: -24, maxTruePeakDb: -2 },
};

export type LoudnessPresetName = keyof typeof LOUDNESS_PRESETS;

export function resolveLoudnessPreset(
  preset: LoudnessPresetName | LoudnessPreset | undefined,
  overrides: { readonly targetLufs?: number; readonly maxTruePeakDb?: number } = {},
): LoudnessPreset {
  const base: LoudnessPreset = typeof preset === "string"
    ? (LOUDNESS_PRESETS[preset] ?? LOUDNESS_PRESETS.youtube!)
    : preset ?? LOUDNESS_PRESETS.youtube!;
  return {
    name: base.name,
    targetLufs: overrides.targetLufs ?? base.targetLufs,
    maxTruePeakDb: overrides.maxTruePeakDb ?? base.maxTruePeakDb,
  };
}

export interface LoudnessNormalizationOptions {
  readonly preset?: LoudnessPresetName | LoudnessPreset;
  readonly targetLufs?: number;
  readonly maxTruePeakDb?: number;
  readonly limit?: boolean;
}

export interface LoudnessNormalizationResult {
  readonly buffer: AudioBuffer;
  readonly preset: LoudnessPreset;
  readonly measuredLufs: number;
  readonly appliedGainDb: number;
  readonly truePeakDbBefore: number;
  readonly truePeakDbAfter: number;
  readonly limited: boolean;
}

export function requiredGainForTarget(measuredLufs: number, targetLufs: number): number {
  if (!Number.isFinite(measuredLufs)) return 0;
  return targetLufs - measuredLufs;
}

export function normalizeLoudness(
  buffer: AudioBuffer,
  options: LoudnessNormalizationOptions = {},
): LoudnessNormalizationResult {
  const preset = resolveLoudnessPreset(options.preset, options);
  const measurement = measureLoudness(buffer);
  const appliedGainDb = requiredGainForTarget(measurement.integratedLufs, preset.targetLufs);
  const gain = appliedGainDb === 0 ? 1 : 10 ** (appliedGainDb / 20);
  const normalized = scaleBuffer(buffer, gain);
  const truePeakDbBefore = measureTruePeakDb(normalized);

  if (options.limit === false) {
    return {
      buffer: normalized,
      preset,
      measuredLufs: measurement.integratedLufs,
      appliedGainDb,
      truePeakDbBefore,
      truePeakDbAfter: truePeakDbBefore,
      limited: false,
    };
  }

  const limited = applyTruePeakLimiter(normalized, { ceilingDb: preset.maxTruePeakDb });
  return {
    buffer: limited.buffer,
    preset,
    measuredLufs: measurement.integratedLufs,
    appliedGainDb,
    truePeakDbBefore,
    truePeakDbAfter: limited.truePeakDbAfter,
    limited: limited.engaged,
  };
}

export function normalizeLoudnessToPreset(
  buffer: AudioBuffer,
  preset: LoudnessPresetName,
  options: Omit<LoudnessNormalizationOptions, "preset"> = {},
): LoudnessNormalizationResult {
  return normalizeLoudness(buffer, { ...options, preset });
}
