import type {
  Composition,
  PostProcessEffectConfig,
  PostProcessingConfig,
  QualitySetting,
  RenderFormat,
  VideoCodec,
} from "../../core/types/index.js";
import type { ManifestEntryBase } from "../../core/types/manifest.js";
import { outputPlanFor, OUTPUT_PLANS, STREAM_FORMATS } from "../../core/output-plan.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { formatTime, type ProgressEvent } from "../../pipeline/progress.js";
import type { RenderJob } from "../../pipeline/index.js";
import type { RenderCliOptions } from "./render-run.js";

export interface RenderTargetItem {
  readonly id: string;
  readonly name?: string;
  readonly kind: "timeline" | "scene" | "composition";
  readonly composition: Composition;
  readonly entry?: ManifestEntryBase;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly format?: RenderFormat;
  readonly codec?: VideoCodec;
  readonly quality?: QualitySetting;
  readonly duration?: number | string;
}

export function applyPostProcessingOverrides(
  postProcessing: PostProcessingConfig | undefined,
  options: RenderCliOptions,
): PostProcessingConfig | undefined {
  if (options.noEffects) {
    return { ...postProcessing, effects: [] };
  }
  let effects: PostProcessEffectConfig[] = [...(postProcessing?.effects ?? [])];
  if (typeof options.effects === "string" && options.effects !== "") {
    const allowed = new Set(options.effects.split(",").map((s) => s.trim().toLowerCase()));
    effects = effects.filter((e) => allowed.has(e.name.toLowerCase()));
  }
  if (options.lut) {
    effects.push({
      name: "lut",
      params: { file: options.lut, path: options.lut },
      enabled: true,
    });
  }
  return {
    ...postProcessing,
    effects,
  };
}

export function assertFormatFlags(
  format: RenderFormat,
  options: Pick<RenderCliOptions, "gifQuality" | "gifDither" | "gifMaxFrames" | "twoPass" | "withAudio" | "audioCodec">,
): void {
  const gifFlags = [
    ["--gif-quality", options.gifQuality !== undefined],
    ["--gif-dither", options.gifDither !== undefined],
    ["--gif-max-frames", options.gifMaxFrames !== undefined],
  ] as const;
  const used = gifFlags.filter(([, set]) => set).map(([flag]) => flag);
  if (format !== "gif" && used.length > 0) {
    throw createError(ErrorCode.CC1012, {
      reason: `Conflicting parameters: ${used.join(", ")} only apply to GIF output, but the resolved format is '${format}'. Add --format gif`,
    });
  }
  if (options.twoPass === true && outputPlanFor(format).strategy !== "stream") {
    throw createError(ErrorCode.CC1012, {
      reason: `Conflicting parameters: --two-pass needs a streamed video format, but the resolved format is '${format}'`,
    });
  }
  if ((options.withAudio === true || options.audioCodec !== undefined) && !outputPlanFor(format).audio) {
    throw createError(ErrorCode.CC1008, {
      format,
      supported: STREAM_FORMATS.filter((f) => OUTPUT_PLANS[f].audio !== undefined).join(", "),
      reason: `format "${format}" does not support audio`,
    });
  }
}

export function attachProgress(job: RenderJob): void {
  const onProgress = (event: ProgressEvent) => {
    const elapsed = formatTime(event.elapsedMs ?? 0);
    const remaining = formatTime(event.remainingMs ?? 0);
    const fps = event.fps !== undefined ? ` | ${event.fps.toFixed(1)} fps` : "";
    const frame = event.totalFrames !== undefined ? ` | frame ${event.frame}/${event.totalFrames}` : "";
    console.log(`[${event.stage.toUpperCase()}] ${event.percent}%${frame}${fps} | ${elapsed} elapsed | ~${remaining} remaining`);
  };
  job.on("progress", onProgress);
  job.on("audio-start", () => console.log("[AUDIO] Mixing tracks..."));
  job.on("audio-done", () => console.log("[AUDIO] Mixing complete"));
  job.on("encoding", () => console.log("[ENCODING] Starting video encode..."));
  job.on("done", (event) => console.log(`✓ ${event.message}`));
  job.on("error", (event) => console.error(`✗ Error: ${event.message}`));
  job.on("warning", (event) => console.warn(`⚠ Warning: ${event.message}`));
}
