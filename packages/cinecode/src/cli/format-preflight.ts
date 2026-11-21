import { outputPlanFor, STILL_FORMATS, type RenderFormat } from "../core/output-plan.js";
import { getPreset, listPresetIds } from "../encoder/platform-presets.js";
import { UsageError } from "./usage-error.js";

export type RenderCommand = "render" | "still";

export interface FormatPreflightInput {
  readonly command: RenderCommand;
  readonly format: RenderFormat;
  readonly fromFrame: number;
  readonly toFrame: number;
  /** Preset that contributed resolution, fps, format or codec, if any. */
  readonly preset?: string;
}

/**
 * Runs before any encoder, worker or cache is created. A strategy that cannot
 * produce the requested window is a usage error naming the frame count and the
 * command that can produce it; nothing is clamped or substituted.
 */
export function assertRenderableFormat(input: FormatPreflightInput): void {
  const plan = outputPlanFor(input.format);
  const frames = Math.max(0, input.toFrame - input.fromFrame);

  if (input.preset) {
    const preset = getPreset(input.preset);
    if (!preset) {
      throw new UsageError(`Unknown platform preset "${input.preset}". Available: ${listPresetIds().join(", ")}.`);
    }
    const strategy = outputPlanFor(preset.format).strategy;
    if (input.command === "still" && strategy !== "still") {
      throw new UsageError(
        `Platform preset "${preset.id}" renders ${preset.format} (${strategy} strategy); the still command needs one of ${STILL_FORMATS.join(", ")}. Use \`cinecode render --preset ${preset.id}\` instead.`,
      );
    }
    if (strategy === "still" && frames > 1) {
      throw new UsageError(
        `Platform preset "${preset.id}" renders a single still frame (${preset.format}), but the requested window is ${frames} frames (${input.fromFrame}..${input.toFrame}). Use \`cinecode still --frame ${input.fromFrame}\` for one frame.`,
      );
    }
  }

  if (input.command === "still") {
    if (!STILL_FORMATS.includes(input.format)) {
      throw new UsageError(
        `The still command writes one image; format '${input.format}' uses the ${plan.strategy} strategy. Use one of ${STILL_FORMATS.join(", ")}, or \`cinecode render --format ${input.format}\` for a video.`,
      );
    }
    if (frames > 1) {
      throw new UsageError(
        `The still command writes one frame, but the requested window is ${frames} frames (${input.fromFrame}..${input.toFrame}). Use \`cinecode render\` for an animation.`,
      );
    }
    return;
  }

  if (plan.strategy === "still" && frames > 1) {
    throw new UsageError(
      `Format '${input.format}' writes a single frame, but the requested window is ${frames} frames (${input.fromFrame}..${input.toFrame}). Use \`cinecode still --frame ${input.fromFrame}\` for one frame, or \`cinecode render --format gif\` for an animation.`,
    );
  }
}
