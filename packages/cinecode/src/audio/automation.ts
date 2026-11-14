import type { AudioBuffer } from "./types.js";
import { detectSilence, removeSilence, normalizePeak, normalizeRms, measurePeaks, type SilenceRegion } from "./metering.js";
import { compressAudio, type CompressorOptions } from "./compressor.js";
import { applyFade, type FadeShape } from "./processing.js";

/**
 * Deterministic automation policies for audio.
 *
 * An `AutomationPolicy` is a declarative, code/config-expressible description
 * of "auto" behavior: silence handling, leveling, loudness targeting, and
 * dynamic-range control. Applying a policy to the same source with the same
 * settings always yields the same result — no hidden or volatile state.
 */

export interface SilencePolicy {
  readonly thresholdDb?: number;
  readonly minDuration?: number;
  /** Bridge non-silent gaps shorter than this (seconds). */
  readonly collapseGaps?: number;
  readonly windowSize?: number;
}

export interface LevelingPolicy {
  readonly mode?: "peak" | "rms";
  readonly targetDb?: number;
}

export interface Fades {
  readonly fadeIn?: number;
  readonly fadeOut?: number;
  readonly shape?: FadeShape;
}

export interface AutomationPolicy {
  readonly silence?: SilencePolicy;
  readonly leveling?: LevelingPolicy;
  readonly compressor?: CompressorOptions;
  readonly fades?: Fades;
}

export interface AutomationReport {
  readonly buffer: AudioBuffer;
  readonly silenceRegions: readonly SilenceRegion[];
  readonly removedSeconds: number;
  readonly peakBeforeDb: number;
  readonly peakAfterDb: number;
  readonly gainReductionDb: number;
}

const DEFAULT_POLICY: AutomationPolicy = {
  leveling: { mode: "peak", targetDb: -1 },
};

/**
 * Apply an automation policy to a buffer. Stages run in a fixed, deterministic
 * order: silence handling → compressor → leveling → fades. The returned report
 * exposes the measurable before/after values so callers (and CI) can verify the
 * automation behaved as configured.
 */
export function applyAutomation(buffer: AudioBuffer, policy: AutomationPolicy = DEFAULT_POLICY): AutomationReport {
  let current = buffer;
  let regions: readonly SilenceRegion[] = [];
  let removedSeconds = 0;
  let gainReductionDb = 0;

  const peakBeforeDb = measurePeaks(current).peakDb;

  if (policy.silence) {
    const result = removeSilence(current, {
      thresholdDb: policy.silence.thresholdDb,
      minDuration: policy.silence.minDuration,
      collapseGaps: policy.silence.collapseGaps,
      windowSize: policy.silence.windowSize,
    });
    current = result.buffer;
    regions = result.regions;
    removedSeconds = result.removedSeconds;
  }

  if (policy.compressor) {
    const compressed = compressAudio(current, policy.compressor);
    current = compressed.buffer;
    gainReductionDb = compressed.gainReductionDb;
  }

  if (policy.leveling) {
    current = policy.leveling.mode === "rms"
      ? normalizeRms(current, { targetDb: policy.leveling.targetDb })
      : normalizePeak(current, { targetDb: policy.leveling.targetDb });
  }

  if (policy.fades) {
    current = applyFade(current, policy.fades.fadeIn ?? 0, policy.fades.fadeOut ?? 0, policy.fades.shape);
  }

  return {
    buffer: current,
    silenceRegions: regions,
    removedSeconds,
    peakBeforeDb,
    peakAfterDb: measurePeaks(current).peakDb,
    gainReductionDb,
  };
}

/** Convenience: detect only, without mutating. Re-exports for policy authoring. */
export { detectSilence };
