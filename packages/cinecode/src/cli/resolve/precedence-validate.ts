import { ALPHA_FORMATS, OUTPUT_PLANS, formatCapability } from "../../core/output-plan.js";
import { createError, ErrorCode } from "../../errors/index.js";
import type { FullPlatformPreset } from "../../encoder/platform-presets.js";
import type { ResolvedRenderParameters } from "./precedence-types.js";

export function validatePrecedenceConflicts(params: ResolvedRenderParameters, preset?: FullPlatformPreset): void {
  const caps = formatCapability(params.format.value);
  // Format vs Alpha
  if (params.alpha.value && !caps.alpha) {
    throw createError(ErrorCode.CC1012, {
      reason: `Conflicting parameters: format '${params.format.value}' (from ${params.format.source}) does not support alpha channel (requested by ${params.alpha.source}); alpha formats are ${ALPHA_FORMATS.join(", ")}`,
    });
  }

  // Codec vs Format
  const formatPlan = OUTPUT_PLANS[params.format.value];
  if (params.codec.origin === "flag" && !caps.codecAllowed(params.codec.value)) {
    throw createError(ErrorCode.CC1012, {
      reason: `Conflicting parameters: codec '${params.codec.value}' (from ${params.codec.source}) is not compatible with format '${params.format.value}' (from ${params.format.source}); supported codecs for ${params.format.value} are ${formatPlan.codecs.join(", ") || "none"}`,
    });
  }

  // Resolution vs Preset Aspect
  if (preset) {
    const [wStr, hStr] = preset.aspectRatio.split(":");
    const pw = Number(wStr);
    const ph = Number(hStr);
    if (pw && ph) {
      const targetAspect = pw / ph;
      const actualAspect = params.width.value / params.height.value;
      if (Math.abs(actualAspect - targetAspect) > 0.02) {
        throw createError(ErrorCode.CC1012, {
          reason: `Conflicting parameters: resolution ${params.width.value}x${params.height.value} (from ${params.width.source}) does not match preset '${preset.id}' aspect ratio ${preset.aspectRatio} (from ${preset.id})`,
        });
      }
    }
  }

  // Frame window start <= end
  if (params.frameWindow.value.from > params.frameWindow.value.to) {
    throw createError(ErrorCode.CC1012, {
      reason: `Conflicting parameters: start frame ${params.frameWindow.value.from} (from ${params.frameWindow.source}) cannot be greater than end frame ${params.frameWindow.value.to} (from ${params.frameWindow.source})`,
    });
  }
}
