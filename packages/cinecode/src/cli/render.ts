import { Command } from "commander";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import type { CinecodeConfig, Composition, QualitySetting, VideoCodec, RenderFormat, PostProcessingConfig, PostProcessEffectConfig } from "../core/types/index.js";
import { clampCrf, resolveVideoEncoding, type VideoEncoding } from "../core/quality.js";
import { fitToPreset, resolvePlatformPreset } from "../encoder/presets.js";
import { getPreset, listPresets, listPresetIds, validatePreset } from "../encoder/platform-presets.js";
import { loadConfig, getDefaultConfig } from "../config/schema.js";
import { assembleTimelineComposition, findEntry, loadManifestProject, type ManifestProject } from "../manifest/index.js";
import { loadComposition, selectComposition, parseTimeInput } from "./still.js";
import {
  ensureDir,
  resolveCacheDir,
  resolveOutputDir,
  resolveOutputPath,
  startCompositionRender,
  OUTPUT_SUBDIRS,
} from "./shared.js";
import { formatTime, type ProgressEvent } from "../pipeline/progress.js";
import type { RenderJob } from "../pipeline/index.js";
import { isCinecodeError, formatError } from "../errors/index.js";

export interface RenderCliOptions {
  composition?: string;
  timeline?: string;
  all: boolean;
  preview: boolean;
  fps?: number;
  resolution?: string;
  out?: string;
  from?: string;
  to?: string;
  props?: string;
  concurrency?: number | "auto";
  noCache: boolean;
  cache?: boolean;
  fresh: boolean;
  resume: boolean;
  overwrite: boolean;
  dryRun: boolean;
  seed: number;
  /** Override render quality; supersedes config and --preview. */
  quality?: QualitySetting;
  codec?: VideoCodec;
  crf?: number;
  /** Output format: mp4, webm, gif, png, pdf. */
  format?: RenderFormat;
  /** GIF quality 1-8 (controls palette size). Default: 8 */
  gifQuality?: number;
  /** GIF dithering mode. Default: floyd-steinberg */
  gifDither?: "floyd-steinberg" | "sierra-2" | "atkinson" | "none";
  /** Maximum frames in GIF output. Default: unlimited */
  gifMaxFrames?: number;
  /** Path to a .cube LUT file for color grading */
  lut?: string;
  /** Disable all effects (fastest render) */
  noEffects: boolean;
  /** Comma-separated list of effects to apply */
  effects?: string;
  /** Named platform preset applied to resolution, fps, codec, CRF and format. */
  preset?: string;
  listPresets?: boolean;
}

const OUTPUT_EXTENSIONS: Readonly<Partial<Record<RenderFormat, string>>> = {
  mp4: ".mp4",
  webm: ".webm",
  "webm-alpha": ".webm",
  prores: ".mov",
  "prores-alpha": ".mov",
  mkv: ".mkv",
  avi: ".avi",
  gif: ".gif",
  apng: ".apng",
  png: ".png",
  jpg: ".jpg",
  webp: ".webp",
  avif: ".avif",
  pdf: ".pdf",
};

function outputExtension(format: RenderFormat | undefined): string {
  return OUTPUT_EXTENSIONS[format ?? "mp4"] ?? ".mp4";
}

function applyPlatformPreset(options: RenderCliOptions): RenderCliOptions {
  if (!options.preset) return options;
  const preset = getPreset(options.preset);
  if (!preset) throw new Error(validatePreset(options.preset) ?? `Unknown platform preset "${options.preset}"`);
  const containerError = validatePreset(options.preset);
  if (containerError) throw new Error(containerError);
  const formatOverridden = options.format !== undefined && options.format !== "mp4";
  return {
    ...options,
    format: formatOverridden ? options.format : preset.format,
    fps: options.fps ?? preset.fps,
    resolution: options.resolution ?? `${preset.width}x${preset.height}`,
    codec: options.codec ?? preset.video.codec,
    crf: options.crf ?? preset.video.crf,
  };
}

function applyPostProcessingOverrides(
  postProcessing: PostProcessingConfig | undefined,
  options: RenderCliOptions,
): PostProcessingConfig | undefined {
  if (options.noEffects) {
    return { ...postProcessing, effects: [] };
  }
  let effects: PostProcessEffectConfig[] = [...(postProcessing?.effects ?? [])];
  if (options.effects) {
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

function parseResolution(input: string): { width: number; height: number } {
  const match = input.match(/^(\d+)x(\d+)$/i);
  if (!match) throw new Error(`Invalid resolution format: ${input}. Use WIDTHxHEIGHT (e.g., 1920x1080)`);
  return { width: parseInt(match[1]!, 10), height: parseInt(match[2]!, 10) };
}

function parseConcurrency(input: string): number | "auto" {
  if (input === "auto") return "auto";
  const num = parseInt(input, 10);
  if (isNaN(num) || num < 1) throw new Error(`Invalid concurrency: ${input}`);
  return num;
}

export function getDefaultCacheDir(): string {
  return process.env.CINECODE_CACHE_DIR || resolve(".cinecode/cache");
}

function resolveCliEncoding(config: CinecodeConfig, options: RenderCliOptions): VideoEncoding {
  const platform = resolvePlatformPreset(config.render?.platformPreset);
  const renderConfig = platform
    ? {
        ...config.render,
        codec: config.render?.codec ?? platform.codec,
        crf: config.render?.crf ?? platform.crf,
        preset: config.render?.preset ?? platform.preset,
      }
    : config.render;
  const base = resolveVideoEncoding({
    render: renderConfig,
    quality: options.quality ?? (options.preview ? "preview" : undefined),
  });
  const codec = options.codec ?? base.codec;
  const crf = options.crf !== undefined ? clampCrf(options.crf, codec) : base.crf;
  return { ...base, codec, crf };
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
  config: CinecodeConfig,
  project: ManifestProject,
  options: RenderCliOptions,
): Promise<void> {
  const timelines = project.manifest.timelines ?? [];
  const selected = options.timeline
    ? [findEntry(timelines, options.timeline, "timeline")]
    : timelines;

  if (selected.length === 0) {
    console.log("No timelines registered in main.ts");
    return;
  }

  const cacheDir = resolveCacheDir(config);
  const outputDir = resolveOutputDir(config);
  await ensureDir(cacheDir);
  await ensureDir(outputDir);

  for (const entry of selected) {
    console.log(`\n▶ Timeline: ${entry.id} — ${entry.name ?? entry.id}`);
    const composition = await assembleTimelineComposition(project, entry.id);
    const fps = options.fps ?? composition.fps;
    const resolution = options.resolution
      ? parseResolution(options.resolution)
      : { width: composition.width, height: composition.height };

    const outputName = `${entry.id}${options.preview ? ".preview" : ""}`;
    const unresolvedPath = options.out && selected.length === 1
      ? options.out
      : join(outputDir, OUTPUT_SUBDIRS.videos, `${outputName}${outputExtension(options.format ?? entry.format ?? config.render?.format)}`);
    const outputPath = await resolveOutputPath(unresolvedPath, options.overwrite);

    if (options.dryRun) {
      console.log(`  resolution: ${resolution.width}x${resolution.height} @ ${fps}fps`);
      console.log(`  output:     ${outputPath}`);
      continue;
    }

    await ensureDir(dirname(outputPath));

    const resolved: Composition = {
      ...composition,
      width: resolution.width,
      height: resolution.height,
      fps,
      postProcessing: applyPostProcessingOverrides(composition.postProcessing, options),
    };

    const job = startCompositionRender({
      composition: resolved,
      outputPath,
      config,
      seed: options.seed,
      concurrency: options.concurrency,
      overwrite: options.overwrite,
      fresh: options.fresh,
      resume: options.resume,
      noCache: options.noCache || options.cache === false,
      encoding: resolveCliEncoding(config, options),
      format: options.format ?? entry.format,
      fromFrame: options.from ? parseTimeInput(options.from, fps) : 0,
      toFrame: options.to ? parseTimeInput(options.to, fps) : undefined,
      onProgress: undefined,
    });
    attachProgress(job);
    await job.promise;
  }
}

async function renderLegacyCompositions(
  config: CinecodeConfig,
  options: RenderCliOptions,
): Promise<void> {
  const configPath = options.props ?? "cinecode.config.js";
  const compositions = await loadComposition(configPath, options.composition);

  if (options.dryRun) {
    const composition = selectComposition(compositions, options.composition);
    const fps = options.fps ?? composition.fps;
    const resolution = options.resolution ? parseResolution(options.resolution) : { width: composition.width, height: composition.height };
    console.log(`Composition: ${composition.name}`);
    console.log(`Resolution:  ${resolution.width}x${resolution.height}`);
    console.log(`FPS:         ${fps}`);
    console.log(`Output:      ${options.out ?? join(resolveOutputDir(config), OUTPUT_SUBDIRS.videos, `${composition.name}${options.preview ? ".preview" : ""}${outputExtension(options.format ?? config.render?.format)}`)}`);
    return;
  }

  const cacheDir = resolveCacheDir(config);
  const outputDir = resolveOutputDir(config);
  await ensureDir(cacheDir);
  await ensureDir(outputDir);

  const compositionsToRender = options.composition
    ? [selectComposition(compositions, options.composition)]
    : compositions;

  for (const composition of compositionsToRender) {
    const fps = options.fps ?? (config.render?.fps ?? composition.fps);
    const platformPreset = resolvePlatformPreset(config.render?.platformPreset);
    const resolution = options.resolution
      ? parseResolution(options.resolution)
      : config.render?.resolution
        ? parseResolution(config.render.resolution)
        : platformPreset
          ? fitToPreset(composition.width, composition.height, platformPreset)
          : { width: composition.width, height: composition.height };

    let fromFrame = 0;
    let toFrame: number | undefined;
    if (composition.duration) {
      const dur = typeof composition.duration === "number" ? composition.duration : parseFloat(composition.duration as string);
      toFrame = Math.ceil(dur * fps);
    }
    if (options.from) fromFrame = parseTimeInput(options.from, fps);
    if (options.to) toFrame = parseTimeInput(options.to, fps);

    const outputName = `${composition.name}${options.preview ? ".preview" : ""}`;
    const unresolvedPath = options.out ?? join(outputDir, OUTPUT_SUBDIRS.videos, `${outputName}${outputExtension(options.format ?? config.render?.format)}`);
    const outputPath = await resolveOutputPath(unresolvedPath, options.overwrite);
    await ensureDir(dirname(outputPath));

    const job = startCompositionRender({
      composition: {
        ...composition,
        width: resolution.width,
        height: resolution.height,
        fps,
        postProcessing: applyPostProcessingOverrides(composition.postProcessing, options),
      },
      outputPath,
      config,
      seed: options.seed,
      concurrency: options.concurrency,
      overwrite: options.overwrite,
      fresh: options.fresh,
      resume: options.resume,
      noCache: options.noCache || options.cache === false,
      encoding: resolveCliEncoding(config, options),
      format: options.format,
      fromFrame,
      toFrame,
    });
    attachProgress(job);
    await job.promise;
  }
}

export async function renderCommand(options: RenderCliOptions): Promise<void> {
  if (options.listPresets) {
    for (const preset of listPresets()) {
      console.log(`${preset.id.padEnd(26)} ${preset.width}x${preset.height}@${preset.fps} ${preset.format}/${preset.video.codec} CRF ${preset.video.crf} — ${preset.description}`);
    }
    return;
  }
  const configPath = options.props ?? "cinecode.config.js";
  let config: CinecodeConfig;
  let configResolved: string;
  try {
    configResolved = resolve(configPath);
    config = await loadConfig(configPath);
  } catch {
    config = getDefaultConfig();
    configResolved = resolve("cinecode.config.js");
  }

  const projectRoot = dirname(configResolved);
  const project = await loadManifestProject(config, projectRoot);
  options = applyPlatformPreset(options);
  const useManifest = project.hasManifest && (project.manifest.timelines?.length ?? 0) > 0 && !options.composition;

  try {
    if (useManifest) {
      await renderTimelines(config, project, options);
    } else {
      await renderLegacyCompositions(config, options);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Render cancelled") {
      console.log("Render cancelled");
      process.exit(130);
    }
    if (isCinecodeError(error)) {
      console.error(formatError(error));
    } else {
      console.error(`Render failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  }
}

export function createRenderCommand(): Command {
  const cmd = new Command("render")
    .description("Render timelines (main.ts) or a composition to MP4")
    .option("-c, --composition <name>", "Legacy composition name")
    .option("-t, --timeline <id>", "Render a single timeline from main.ts")
    .option("--all", "Render every timeline", false)
    .option("-p, --preview", "Render preview quality (faster)", false)
    .option("--quality <level>", "Quality: draft | preview | final | lossless (or legacy high/medium/low)", undefined)
    .option("--codec <codec>", "Video codec: h264 | h265 | av1 | prores | vp9")
    .option("--crf <number>", "Override CRF (0 = lossless)", (v) => parseInt(v, 10))
    .option("--fps <number>", "Override FPS", (v) => parseInt(v, 10))
    .option("--resolution <WIDTHxHEIGHT>", "Override resolution")
    .option("-o, --out <path>", "Output file path")
    .option("--from <timecode|seconds|frames>", "Start time (HH:MM:SS:FF, seconds, or frames(N))")
    .option("--to <timecode|seconds|frames>", "End time (HH:MM:SS:FF, seconds, or frames(N))")
    .option("--props <path>", "Path to config or legacy composition file", "cinecode.config.js")
    .option("--concurrency <number|auto>", "Number of worker threads", parseConcurrency, "auto")
    .option("--no-cache", "Disable render cache", false)
    .option("--fresh", "Ignore resume state, start fresh", false)
    .option("--resume", "Resume from the last durable render checkpoint", false)
    .option("--overwrite", "Overwrite existing output file", false)
    .option("--dry-run", "Print render plan without rendering", false)
    .option("--seed <number>", "Random seed", (v) => parseInt(v, 10), 0)
    .option("--format <format>", "Output format: mp4, webm, mkv, avi, gif, apng, webp, avif, png, pdf, frames, spritesheet", "mp4")
    .option("--preset <name>", `Platform preset (${listPresetIds().join(", ")})`)
    .option("--list-presets", "List available platform presets", false)
    .option("--gif-quality <n>", "GIF quality 1-8 (controls palette size). Default: 8", (v) => parseInt(v, 10), 8)
    .option("--gif-dither <mode>", "GIF dithering: floyd-steinberg, sierra-2, atkinson, none. Default: floyd-steinberg", "floyd-steinberg")
    .option("--gif-max-frames <n>", "Maximum frames in GIF output. Default: unlimited", (v) => parseInt(v, 10))
    .option("--lut <path>", "Path to a .cube LUT file for color grading", undefined)
    .option("--no-effects", "Disable all effects (fastest render)", false)
    .option("--effects <list>", "Comma-separated list of effects to apply (blur,bloom,chromatic-aberration)", undefined)
    .action(async (options: RenderCliOptions) => {
      await renderCommand(options);
    });

  return cmd;
}
