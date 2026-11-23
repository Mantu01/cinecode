import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, isAbsolute, extname } from "node:path";
import type { AudioPlacement, Composition, QualitySetting, VideoCodec, RenderFormat, PostProcessingConfig, PostProcessEffectConfig } from "../../core/types/index.js";
import type { ManifestEntryBase } from "../../core/types/manifest.js";
import { resolveVideoEncoding } from "../../core/quality.js";
import type { AudioMuxCodec } from "../../audio/muxer.js";
import { ensureDir, resolveOutputPath, startCompositionRender } from "../shared/shared.js";
import { formatTime, type ProgressEvent } from "../../pipeline/progress.js";
import type { RenderJob } from "../../pipeline/index.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { runReport } from "../output/run-report.js";
import { resolveRenderParameters } from "../resolve/precedence.js";
import { describeExplainReport, formatExplainReport } from "../resolve/explain.js";
import { outputPlanFor, STREAM_FORMATS, OUTPUT_PLANS } from "../../core/output-plan.js";
import { assertRenderableFormat } from "../gate/format-preflight.js";
import type { ProjectResolution } from "../resolve/project-resolver.js";
import { runValidation } from "../gate/validation-engine.js";
import { pendingDegradations, recordDegradation } from "../../errors/degradations.js";

export interface RenderCliOptions {
  file?: string;
  composition?: string;
  timeline?: string;
  scene?: string;
  all: boolean;
  preview: boolean;
  fps?: number;
  resolution?: string;
  out?: string;
  from?: string;
  to?: string;
  config?: string;
  root?: string;
  concurrency?: number | "auto";
  noCache: boolean;
  cache?: boolean;
  fresh: boolean;
  resume: boolean;
  overwrite: boolean;
  dryRun: boolean;
  explain?: boolean;
  seed?: number;
  /** Override render quality; supersedes config and --preview. */
  quality?: QualitySetting;
  codec?: VideoCodec;
  crf?: number;
  /** Output format: mp4, webm, gif, png, pdf. */
  format?: RenderFormat;
  alpha?: boolean;
  twoPass?: boolean;
  bitrate?: string;
  /** Keep an audio stream even when the mix is silent. */
  withAudio?: boolean;
  /** Audio codec for the muxed stream. */
  audioCodec?: AudioMuxCodec;
  /** Audio bitrate in kbps for lossy codecs. */
  audioBitrate?: number;
  colorManagement?: "srgb" | "linear";
  /** Render memory budget (e.g. "1GB", "512MB" or numeric MB). */
  memoryBudget?: string | number;
  /** Print budget, worker and transport diagnostics to stderr. */
  verbose?: boolean;
  /** Continue with fatal timeline validation issues, recording a degradation. */
  allowInvalid?: boolean;
  /** Fail when a glyph falls back to another font family. */
  strict?: boolean;
  /** GIF quality 1-8 (controls palette size). Default: 8 */
  gifQuality?: number;
  /** GIF dithering mode. Default: floyd-steinberg */
  gifDither?: "floyd-steinberg" | "sierra-2" | "atkinson" | "none";
  /** Maximum frames in GIF output. Default: unlimited */
  gifMaxFrames?: number;
  /** Path to a .cube LUT file for color grading */
  lut?: string;
  /** Disable all effects (fastest render) */
  noEffects?: boolean;
  /** Comma-separated list of effects to apply */
  effects?: string;
  /** Named platform preset applied to resolution, fps, codec, CRF and format. */
  preset?: string;
  /** Frames per worker chunk; overrides the heuristic. */
  chunkSize?: number;
  /** Encoder backend: auto, nvenc, videotoolbox, qsv or off. */
  hardwareAcceleration?: import("../../core/types/index.js").HardwareAcceleration;
  listPresets?: boolean;
}

import {
  applyPostProcessingOverrides,
  assertFormatFlags,
  attachProgress,
  type RenderTargetItem,
} from "./render-run-aux.js";
import { normalizeColorManagement } from "../shared/color-management.js";

export type { RenderTargetItem };

export async function orchestrateRender(
  resolution: ProjectResolution,
  targets: readonly RenderTargetItem[],
  options: RenderCliOptions,
): Promise<void> {
  const { config, root, configPath, manifestPath, mode } = resolution;
  const cacheDir = resolution.context.roots.cache;
  const outputDir = resolution.context.roots.output;
  const entryContent = existsSync(manifestPath) ? readFileSync(manifestPath) : "";
  const audioPlacements: AudioPlacement[] = [];
  const overwrite = options.overwrite ?? config.render?.overwrite ?? config.overwrite ?? false;

  let explicitOutDir: string | undefined;
  let singleOutFile: string | undefined;

  if (options.out) {
    const rawOut = isAbsolute(options.out) ? options.out : resolve(root, options.out);
    if (targets.length > 1) {
      if (existsSync(rawOut) && statSync(rawOut).isFile()) {
        throw createError(ErrorCode.CC1003, {
          key: "out",
          path: rawOut,
          reason: "a directory path must not be an existing file",
        });
      }
      explicitOutDir = rawOut;
      await ensureDir(explicitOutDir);
    } else if (targets.length === 1) {
      if (existsSync(rawOut) && statSync(rawOut).isDirectory()) {
        throw createError(ErrorCode.CC1003, {
          key: "out",
          path: rawOut,
          reason: "a file path must not be an existing directory",
        });
      }
      singleOutFile = rawOut;
    }
  }

  if ("all" in resolution && typeof (resolution as { all?: unknown }).all === "function") {
    const validationReport = await runValidation(resolution, { mode: "all" });
    if (!validationReport.ok) {
      if (options.allowInvalid) {
        recordDegradation({
          code: ErrorCode.CC4001,
          what: "rendering with validation errors",
          reason: `${validationReport.errors.length} validation error(s) reported`,
          input: resolution.configPath,
          instead: "render proceeding because --allow-invalid was set",
        });
      } else {
        throw createError(
          ErrorCode.CC1013,
          { count: validationReport.errors.length },
          {
            location: { file: resolution.configPath },
            fixHint: `Fix reported validation errors: ${validationReport.errors.map(e => `[${e.code}] ${e.message}`).join("; ")}`,
          },
        );
      }
    }
  }

  for (const target of targets) {
    console.log(`\n▶ ${target.kind === "scene" ? "Scene" : target.kind === "timeline" ? "Timeline" : "Composition"}: ${target.id} — ${target.name ?? target.id}`);
    audioPlacements.push(...(target.composition.audioPlacements ?? []));

    const { parameters, explain, preset } = resolveRenderParameters({
      flags: options,
      selection: {
        id: target.id,
        name: target.name,
        width: target.width,
        height: target.height,
        fps: target.fps,
        format: target.format,
        codec: target.codec,
        quality: target.quality,
        duration: target.duration ?? target.composition.duration,
      },
      project: { root, configPath, manifestPath, mode, selection: `${target.kind} ${target.id}`, config, roots: resolution.context.roots },
      explicit: resolution.context.explicit,
    });

    const explained = describeExplainReport(explain);
    runReport.result({ explain: explained });
    runReport.explain(explained);
    runReport.result({ chunkSize: parameters.chunkSize.value, hardwareAcceleration: parameters.hardwareAcceleration.value });
    assertRenderableFormat({
      command: "render",
      format: parameters.format.value,
      fromFrame: parameters.frameWindow.value.from,
      toFrame: parameters.frameWindow.value.to,
      preset: preset?.id,
    });
    assertFormatFlags(parameters.format.value, options);

    const plan = outputPlanFor(parameters.format.value);
    const previewSuffix = options.preview || parameters.quality.value === "preview" ? ".preview" : "";
    let targetOutputPath: string;

    if (explicitOutDir) {
      const filename = `${target.id}${previewSuffix}${plan.extension}`;
      targetOutputPath = join(explicitOutDir, filename);
    } else if (singleOutFile) {
      const givenExt = extname(singleOutFile);
      if (plan.extension && givenExt.toLowerCase() !== plan.extension.toLowerCase()) {
        runReport.warn(
          ErrorCode.CC1012,
          `Output extension for format '${parameters.format.value}' should be '${plan.extension}'; corrected '${givenExt}' to '${plan.extension}'`,
          singleOutFile,
        );
        targetOutputPath = singleOutFile.slice(0, singleOutFile.length - givenExt.length) + plan.extension;
      } else {
        targetOutputPath = singleOutFile;
      }
    } else {
      targetOutputPath = parameters.outputPath.value;
    }

    if (options.dryRun || options.explain) {
      console.log(formatExplainReport(explain));
      continue;
    }

    await ensureDir(cacheDir);
    await ensureDir(outputDir);

    const outputPath = await resolveOutputPath(targetOutputPath, overwrite);
    await ensureDir(dirname(outputPath));

    const resolved: Composition = {
      ...target.composition,
      width: parameters.width.value,
      height: parameters.height.value,
      fps: parameters.fps.value,
      postProcessing: applyPostProcessingOverrides(target.composition.postProcessing, options),
    };

    const job = startCompositionRender({
      composition: resolved,
      outputPath,
      config,
      seed: options.seed,
      concurrency: parameters.concurrency.value,
      chunkSize: parameters.chunkSize.value,
      memoryBudgetMb: parameters.memoryBudgetMb.value,
      overwrite,
      fresh: options.fresh,
      resume: options.resume,
      noCache: options.cache === false || options.noCache === true,
      encoding: {
        ...resolveVideoEncoding({
          render: {
            ...config.render,
            codec: parameters.codec.value,
            crf: parameters.crf.value,
            hardwareAcceleration: parameters.hardwareAcceleration.value,
          },
          quality: parameters.quality.value,
        }),
      },
      format: parameters.format.value,
      fromFrame: parameters.frameWindow.value.from,
      toFrame: parameters.frameWindow.value.to,
      twoPass: parameters.twoPass.value,
      alpha: parameters.alpha.value,
      bitrateKbps: parameters.bitrate.value ? parseInt(parameters.bitrate.value, 10) : undefined,
      forceAudio: options.withAudio === true,
      audioCodec: options.audioCodec,
      audioBitrateKbps: options.audioBitrate,
      colorManagement: parameters.colorManagement.value,
      allowInvalidTimeline: options.allowInvalid === true,
      fonts: config.fonts,
      projectRoot: root,
      mediaDir: config.mediaDir ?? "media",
      strictFonts: options.strict === true,
      gifQuality: options.gifQuality,
      gifDither: options.gifDither,
      gifMaxFrames: options.gifMaxFrames,
      verbose: options.verbose === true,
      entryContent,
    });
    attachProgress(job);
    const result = await job.promise;
    runReport.artifact({
      kind: plan.strategy === "sequence" ? "sequence" : "video",
      path: result.outputPath,
      units: Math.max(1, Math.round(result.duration * parameters.fps.value)),
      unit: "frames",
    });
    if (result.budgetStats) {
      runReport.result({ budget: result.budgetStats });
    }
    const cmNormalized = normalizeColorManagement(parameters.colorManagement.value);
    runReport.result({
      colorManagement: {
        workingColorSpace: cmNormalized?.workingColorSpace ?? "srgb",
        outputColorSpace: cmNormalized?.outputColorSpace ?? "srgb",
        enabled: cmNormalized?.enabled ?? false,
      },
      alpha: {
        enabled: parameters.alpha.value === true,
        mode: parameters.alpha.value === true ? "straight" : "none",
      },
    });
    if (result.audioStats) {
      runReport.result({ audioStats: result.audioStats });
    }
    if (result.containerVerification) {
      runReport.result({ containerVerification: result.containerVerification });
    }
  }

  const sampleRate = config.audio?.sampleRate ?? 48000;
  const channels = config.audio?.channels ?? 2;
  runReport.result({ audioPlacements, audio: { sampleRate, channels } });

  if (options.strict === true && pendingDegradations().length > 0) {
    const degs = pendingDegradations();
    const count = degs.length;
    const first = degs[0]!;
    throw createError(ErrorCode.CC1013, {
      count,
      reason: `Strict mode failed with ${count} degradation(s): [${first.code}] ${first.what} - ${first.reason}`,
    });
  }
}
