import { Command, Option } from "commander";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import type { AudioPlacement, CinecodeConfig, Composition, QualitySetting, VideoCodec, RenderFormat, PostProcessingConfig, PostProcessEffectConfig } from "../core/types/index.js";
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
import { runReport } from "./run-report.js";
import { resolveRenderParameters, formatExplainReport, describeExplainReport } from "./precedence.js";
import { outputPlanFor } from "../core/output-plan.js";
import { TIME_GRAMMAR } from "../core/time-input.js";
import { assertRenderableFormat } from "./format-preflight.js";
import type { ProjectResolution } from "./project-resolver.js";

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
  /** Render memory budget in MiB (frames queued + chunks in flight). */
  memoryBudgetMb?: number;
  /** Commander's camelCase name for --memory-budget. */
  memoryBudget?: number;
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
  options: Pick<RenderCliOptions, "gifQuality" | "gifDither" | "gifMaxFrames" | "twoPass">,
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

async function renderTimelines(
  resolution: ProjectResolution,
  timelineIds: readonly string[],
  options: RenderCliOptions,
): Promise<void> {
  const { config, root, configPath, manifestPath, mode } = resolution;
  const project = resolution.manifest!;
  const timelines = project.manifest.timelines ?? [];
  const selected = timelineIds.map((id) => findEntry(timelines, id, "timeline"));

  const cacheDir = resolution.context.roots.cache;
  const outputDir = resolution.context.roots.output;
  const entryContent = readFileSync(manifestPath);
  const audioPlacements: AudioPlacement[] = [];

  for (const entry of selected) {
    console.log(`\n▶ Timeline: ${entry.id} — ${entry.name ?? entry.id}`);
    const composition = await assembleTimelineComposition(project, entry.id);
    audioPlacements.push(...(composition.audioPlacements ?? []));
    const { parameters, explain, preset } = resolveRenderParameters({
      flags: options,
      selection: {
        id: entry.id,
        name: entry.name,
        width: entry.width,
        height: entry.height,
        fps: entry.fps,
        format: entry.format,
        codec: entry.codec,
        quality: entry.quality,
        duration: entry.duration ?? composition.duration,
      },
      project: { root, configPath, manifestPath, mode, selection: `timeline ${entry.id}`, config, roots: resolution.context.roots },
      explicit: resolution.context.explicit,
    });

    runReport.result({ explain: describeExplainReport(explain) });
    runReport.result({ chunkSize: parameters.chunkSize.value, hardwareAcceleration: parameters.hardwareAcceleration.value });
    assertRenderableFormat({
      command: "render",
      format: parameters.format.value,
      fromFrame: parameters.frameWindow.value.from,
      toFrame: parameters.frameWindow.value.to,
      preset: preset?.id,
    });
    assertFormatFlags(parameters.format.value, options);

    if (options.dryRun || options.explain) {
      console.log(formatExplainReport(explain));
      continue;
    }

    await ensureDir(cacheDir);
    await ensureDir(outputDir);
    const outputPath = await resolveOutputPath(parameters.outputPath.value, options.overwrite);
    await ensureDir(dirname(outputPath));

    const resolved: Composition = {
      ...composition,
      width: parameters.width.value,
      height: parameters.height.value,
      fps: parameters.fps.value,
      postProcessing: applyPostProcessingOverrides(composition.postProcessing, options),
    };

    const job = startCompositionRender({
      composition: resolved,
      outputPath,
      config,
      seed: options.seed,
      concurrency: parameters.concurrency.value,
      chunkSize: parameters.chunkSize.value,
      memoryBudgetMb: parameters.memoryBudgetMb.value,
      overwrite: options.overwrite,
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
    runReport.artifact({ kind: "video", path: result.outputPath, units: Math.max(1, Math.round(result.duration * parameters.fps.value)), unit: "frames" });
    if (result.budgetStats) {
      runReport.result({ budget: result.budgetStats });
    }
  }
  runReport.result({ audioPlacements });
}

async function renderCompositions(
  resolution: ProjectResolution,
  compositions: readonly Composition[],
  options: RenderCliOptions,
): Promise<void> {
  const { config, root, configPath, manifestPath, mode } = resolution;
  const cacheDir = resolution.context.roots.cache;
  const outputDir = resolution.context.roots.output;
  const entryContent = readFileSync(manifestPath);
  const audioPlacements: AudioPlacement[] = [];

  for (const composition of compositions) {
    audioPlacements.push(...(composition.audioPlacements ?? []));
    const { parameters, explain, preset } = resolveRenderParameters({
      flags: options,
      selection: {
        name: composition.name,
        width: composition.width,
        height: composition.height,
        fps: composition.fps,
        duration: composition.duration,
      },
      project: { root, configPath, manifestPath, mode, selection: `composition ${composition.name}`, config, roots: resolution.context.roots },
      explicit: resolution.context.explicit,
    });

    runReport.result({ explain: describeExplainReport(explain) });
    runReport.result({ chunkSize: parameters.chunkSize.value, hardwareAcceleration: parameters.hardwareAcceleration.value });
    assertRenderableFormat({
      command: "render",
      format: parameters.format.value,
      fromFrame: parameters.frameWindow.value.from,
      toFrame: parameters.frameWindow.value.to,
      preset: preset?.id,
    });
    assertFormatFlags(parameters.format.value, options);

    if (options.dryRun || options.explain) {
      console.log(formatExplainReport(explain));
      continue;
    }

    await ensureDir(cacheDir);
    await ensureDir(outputDir);
    const outputPath = await resolveOutputPath(parameters.outputPath.value, options.overwrite);
    await ensureDir(dirname(outputPath));

    const resolved: Composition = {
      ...composition,
      width: parameters.width.value,
      height: parameters.height.value,
      fps: parameters.fps.value,
      postProcessing: applyPostProcessingOverrides(composition.postProcessing, options),
    };

    const job = startCompositionRender({
      composition: resolved,
      outputPath,
      config,
      seed: options.seed,
      concurrency: parameters.concurrency.value,
      chunkSize: parameters.chunkSize.value,
      memoryBudgetMb: parameters.memoryBudgetMb.value,
      overwrite: options.overwrite,
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
    runReport.artifact({ kind: "video", path: result.outputPath, units: Math.max(1, Math.round(result.duration * parameters.fps.value)), unit: "frames" });
    if (result.budgetStats) {
      runReport.result({ budget: result.budgetStats });
    }
  }
  runReport.result({ audioPlacements });
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
    requireSelection: true,
    allowAll: true,
  });
  const resolved = await resolver.resolve();
  reportResolution(resolved, (options as { verbose?: boolean }).verbose === true);

  if (!options.dryRun && !options.explain) runReport.expectArtifact("video");

  try {
    if (resolved.mode === "project" && resolved.selection.kind === "scene") {
      await renderCompositions(resolved, await resolver.selected(), options);
    } else if (resolved.mode === "project") {
      await renderTimelines(resolved, resolved.selection.ids, options);
    } else {
      await renderCompositions(resolved, await resolver.selected(), options);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Render cancelled") {
      throw createError(ErrorCode.CC4003, {}, { cause: error });
    }
    throw error;
  }
  if (options.dryRun || options.explain) {
    runReport.note(options.explain ? "parameters explained" : "dry run: plan printed");
  }
  runReport.result({ rendered: runReport.artifactCount() });
}

/** Negated flag with its own key, so --effects and --no-effects are mutually exclusive. */
function noEffectsOption(): Option {
  const option = new Option("--no-effects", "Disable all effects (fastest render)").conflicts("effects");
  option.attributeName = () => "noEffects";
  option.preset(true);
  return option;
}

export function createRenderCommand(): Command {
  const cmd = new Command("render")
    .description("Render timelines (main.ts) or a standalone composition file to MP4")
    .option("--file <path>", "Standalone composition file (file mode)")
    .option("-c, --composition <name>", "Composition name (requires --file)")
    .option("-T, --timeline <id>", "Render a single timeline from main.ts")
    .option("-s, --scene <id>", "Render a single scene from main.ts")
    .option("--all", "Render every timeline", false)
    .option("--preview", "Render preview quality (faster)", false)
    .option("--quality <level>", `Quality: ${QUALITY_SETTINGS.join(" | ")}`, undefined)
    .option("--codec <codec>", `Video codec: ${VIDEO_CODECS.join(" | ")}`)
    .option("--crf <number>", "Override CRF (0 = lossless)", (v) => parseInt(v, 10))
    .option("--fps <number>", "Override FPS", (v) => parseInt(v, 10))
    .option("--resolution <WIDTHxHEIGHT>", "Override resolution")
    .option("-o, --out <path>", "Output file path")
    .option("--from <time>", `Start time (${TIME_GRAMMAR})`)
    .option("--to <time>", `End time (${TIME_GRAMMAR})`)
    .option("--concurrency <number|auto>", "Number of worker threads", parseConcurrency)
    .option("--memory-budget <mb>", "Render memory budget in MiB (frames queued + chunks in flight)", parseIntOption)
    .option("--chunk-size <frames>", "Frames per worker chunk (overrides the heuristic)", parseIntOption)
    .option("--hardware-acceleration <mode>", `Encoder backend: ${HARDWARE_ACCELERATION.join(" | ")}`, parseHardwareAcceleration)
    .option("--no-cache", "Disable render cache")
    .option("--fresh", "Ignore resume state, start fresh", false)
    .option("--resume", "Resume from the last durable render checkpoint", false)
    .option("--overwrite", "Overwrite existing output file", false)
    .option("--allow-invalid", "Render even when timeline validation reports fatal issues (recorded as a degradation)", false)
    .option("--strict", "Fail when text glyphs fall back to another font family", false)
    .option("--dry-run", "Print render plan without rendering", false)
    .option("--seed <number>", "Random seed", (v) => parseInt(v, 10))
    .option("--format <format>", `Output format: ${RENDER_FORMATS.join(", ")}`)
    .option("--preset <name>", `Platform preset (${listPresetIds().join(", ")})`, parsePresetId)
    .option("--list-presets", "List available platform presets", false)
    .option("--gif-quality <n>", "GIF quality 1-8 (controls palette size)", (v) => parseInt(v, 10))
    .option("--gif-dither <mode>", "GIF dithering: floyd-steinberg, sierra-2, atkinson, none")
    .option("--gif-max-frames <n>", "Maximum frames in GIF output", (v) => parseInt(v, 10))
    .option("--lut <path>", "Path to a .cube LUT file for color grading", undefined)
    .option("--effects <list>", "Comma-separated list of effects to apply (blur,bloom,chromatic-aberration)", undefined)
    .option("--alpha", "Render with alpha channel (transparent background)")
    .option("--two-pass", "Enable two-pass video encoding")
    .option("--bitrate <rate>", "Video bitrate target (e.g. 5000k)")
    .option("--with-audio", "Keep an audio stream even when the mix is silent", false)
    .option("--audio-codec <codec>", "Audio codec: aac, opus, ac3, eac3, flac, pcm_s24le")
    .option("--audio-bitrate <kbps>", "Audio bitrate in kbps for lossy codecs", (v) => parseInt(v, 10))
    .option("--color-management <space>", "Color management mode: srgb or linear")
    .option("--explain", "Print resolved parameters and their origins without rendering", false)
    .addOption(noEffectsOption())
    .action(async (options: RenderCliOptions) => {
      await renderCommand({ ...options, memoryBudgetMb: options.memoryBudget ?? options.memoryBudgetMb });
    });

  return cmd;
}
