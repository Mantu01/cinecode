import { Command, Option } from "commander";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, isAbsolute, extname } from "node:path";
import type { AudioPlacement, CinecodeConfig, Composition, QualitySetting, VideoCodec, RenderFormat, PostProcessingConfig, PostProcessEffectConfig } from "../core/types/index.js";
import type { ManifestEntryBase } from "../core/types/manifest.js";
import { resolveVideoEncoding, type VideoEncoding } from "../core/quality.js";
import type { AudioMuxCodec } from "../audio/muxer.js";
import { getPreset, listPresets, listPresetIds, validatePreset } from "../encoder/platform-presets.js";
import { HARDWARE_ACCELERATION, QUALITY_SETTINGS, RENDER_FORMATS, VIDEO_CODECS } from "../config/zod-schema.js";
import { assembleTimelineComposition, findEntry, type ManifestProject } from "../manifest/index.js";
import { selectComposition } from "./composition-loader.js";
import { createProjectResolver, reportResolution } from "./project-resolver.js";
import {
  ensureDir,
  resolveOutputPath,
  startCompositionRender,
  OUTPUT_SUBDIRS,
} from "./shared.js";
import { formatTime, type ProgressEvent } from "../pipeline/progress.js";
import type { RenderJob } from "../pipeline/index.js";
import { createError, ErrorCode } from "../errors/index.js";
import { assertAlphaFormat, UsageError } from "./usage-error.js";
import { isCancellation } from "./exit-codes.js";
import { runReport } from "./run-report.js";
import { resolveRenderParameters, formatExplainReport, describeExplainReport } from "./precedence.js";
import { outputPlanFor, STREAM_FORMATS, OUTPUT_PLANS } from "../core/output-plan.js";
import { TIME_GRAMMAR } from "../core/time-input.js";
import { assertRenderableFormat } from "./format-preflight.js";
import type { ProjectResolution } from "./project-resolver.js";
import { runValidation } from "./validation-engine.js";
import { recordDegradation } from "../errors/degradations.js";

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
  hardwareAcceleration?: import("../core/types/index.js").HardwareAcceleration;
  listPresets?: boolean;
}

function applyPostProcessingOverrides(
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

/** Flags that only make sense for one output family must not be silently ignored. */
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

function parseResolution(input: string): { width: number; height: number } {
  const match = input.match(/^(\d+)x(\d+)$/i);
  if (!match) throw createError(ErrorCode.CC1012, { reason: `Invalid resolution format: ${input}. Use WIDTHxHEIGHT (e.g., 1920x1080)` });
  return { width: parseInt(match[1]!, 10), height: parseInt(match[2]!, 10) };
}

function parseIntOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new UsageError(`Invalid number: ${value}. Expected a positive integer.`);
  return parsed;
}

function parseHardwareAcceleration(value: string): import("../core/types/index.js").HardwareAcceleration {
  if (!(HARDWARE_ACCELERATION as readonly string[]).includes(value)) {
    throw new UsageError(`Invalid hardware acceleration: ${value}. Expected one of ${HARDWARE_ACCELERATION.join(", ")}.`);
  }
  return value as import("../core/types/index.js").HardwareAcceleration;
}

function parsePresetId(value: string): string {
  if (!getPreset(value)) throw new UsageError(`Unknown platform preset "${value}". Available: ${listPresetIds().join(", ")}.`);
  return value;
}

function parseConcurrency(input: string): number | "auto" {
  if (input === "auto") return "auto";
  const num = parseInt(input, 10);
  if (isNaN(num) || num < 1) throw createError(ErrorCode.CC1012, { reason: `Invalid concurrency: ${input}` });
  return num;
}

function attachProgress(job: RenderJob): void {
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
  }

  const sampleRate = config.audio?.sampleRate ?? 48000;
  const channels = config.audio?.channels ?? 2;
  runReport.result({ audioPlacements, audio: { sampleRate, channels } });
}

export async function renderCommand(options: RenderCliOptions): Promise<void> {
  if (options.resume && (options.noCache || options.cache === false)) {
    throw new UsageError("--resume requires the frame cache. Remove --no-cache or use --fresh.");
  }
  if (options.listPresets) {
    const presets = listPresets();
    for (const preset of presets) {
      console.log(`${preset.id.padEnd(26)} ${preset.width}x${preset.height}@${preset.fps} ${preset.format}/${preset.video.codec} CRF ${preset.video.crf} — ${preset.description}`);
    }
    runReport.result({ presets });
    runReport.note(`${presets.length} preset(s) listed`);
    return;
  }
  const resolver = createProjectResolver({
    root: options.root,
    config: options.config,
    file: options.file,
    composition: options.composition,
    timeline: options.timeline,
    scene: options.scene,
    all: options.all,
    requireSelection: false,
    allowAll: true,
  });
  const resolved = await resolver.resolve();
  reportResolution(resolved, (options as { verbose?: boolean }).verbose === true);

  if (!options.dryRun && !options.explain) runReport.expectArtifact("video");

  try {
    const targets: RenderTargetItem[] = [];
    if (resolved.mode === "file") {
      const comps = await resolver.selected();
      for (const comp of comps) {
        targets.push({
          id: comp.name,
          name: comp.name,
          kind: "composition",
          composition: comp,
          width: comp.width,
          height: comp.height,
          fps: comp.fps,
          duration: comp.duration,
        });
      }
    } else if (resolved.selection.kind === "scene") {
      const scenes = resolved.manifest!.manifest.scenes ?? [];
      const entry = findEntry(scenes, resolved.selection.id!, "scene");
      const comp = (await resolver.selected())[0]!;
      const sceneRecord = entry as ManifestEntryBase & { width?: number; height?: number; fps?: number; format?: RenderFormat; codec?: VideoCodec; quality?: QualitySetting; duration?: number };
      targets.push({
        id: entry.id,
        name: entry.name,
        kind: "scene",
        composition: comp,
        entry,
        width: sceneRecord.width,
        height: sceneRecord.height,
        fps: sceneRecord.fps,
        format: sceneRecord.format,
        codec: sceneRecord.codec,
        quality: sceneRecord.quality,
        duration: sceneRecord.duration ?? comp.duration,
      });
    } else {
      const timelines = resolved.manifest!.manifest.timelines ?? [];
      for (const id of resolved.selection.ids) {
        const entry = findEntry(timelines, id, "timeline");
        const comp = await assembleTimelineComposition(resolved.manifest!, entry.id);
        const timelineRecord = entry as ManifestEntryBase & { width?: number; height?: number; fps?: number; format?: RenderFormat; codec?: VideoCodec; quality?: QualitySetting; duration?: number };
        targets.push({
          id: entry.id,
          name: entry.name,
          kind: "timeline",
          composition: comp,
          entry,
          width: timelineRecord.width,
          height: timelineRecord.height,
          fps: timelineRecord.fps,
          format: timelineRecord.format,
          codec: timelineRecord.codec,
          quality: timelineRecord.quality,
          duration: timelineRecord.duration ?? comp.duration,
        });
      }
    }

    await orchestrateRender(resolved, targets, options);
  } catch (error) {
    if (isCancellation(error)) {
      throw createError(ErrorCode.CC4003, {}, { cause: error });
    }
    throw error;
  }
  if (options.dryRun || options.explain) {
    runReport.note(options.explain ? "parameters explained" : "dry run: plan printed");
  }
  runReport.result({ rendered: runReport.artifactCount() });
}

import { findCommand, buildCommanderCommand } from "./command-registry.js";

export function createRenderCommand(): Command {
  const spec = findCommand("render");
  if (!spec) throw new Error("Command 'render' not found in registry");
  return buildCommanderCommand(spec);
}
