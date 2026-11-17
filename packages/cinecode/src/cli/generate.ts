import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CinecodeConfig, Composition } from "../core/types/index.js";
import type { AudioEntry, ImageEntry, ManifestEntryBase, SceneEntry, TimelineEntry } from "../core/types/manifest.js";
import { loadConfig } from "../config/schema.js";
import {
  assembleTimelineComposition,
  composeSceneComposition,
  loadManifestProject,
  resolveAudioBuffer,
  resolveImageClip,
  type ManifestProject,
} from "../manifest/index.js";
import { renderImageBuffer } from "../renderer/image.js";
import { encodeWavBuffer } from "../audio/muxer.js";
import { multiSelect, type SelectItem } from "./prompt-select.js";
import {
  OUTPUT_SUBDIRS,
  ensureDir,
  resolveOutputDir,
  resolveOutputPath,
  startCompositionRender,
} from "./shared.js";
import { formatTime } from "../pipeline/progress.js";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";

export type GenerateKind = "audio" | "image" | "scene" | "timeline" | "all";

export interface GenerateOptions {
  /** Repeatable `--id` values. */
  id?: string[];
  all?: boolean;
  yes?: boolean;
  config?: string;
  out?: string;
  seed?: number;
  concurrency?: number | "auto";
  overwrite?: boolean;
  silent?: boolean;
  dryRun?: boolean;
}

interface Target {
  readonly kind: Exclude<GenerateKind, "all">;
  readonly entry: ManifestEntryBase;
}

function describe(entry: ManifestEntryBase): string {
  return entry.name ?? entry.id;
}

function detailOf(entry: ManifestEntryBase): string {
  return entry.file ? `(${entry.file})` : entry.id;
}

async function selectTargets(
  kind: GenerateKind,
  project: ManifestProject,
  options: GenerateOptions,
): Promise<Target[]> {
  const { manifest } = project;
  const pools: Array<{ kind: Exclude<GenerateKind, "all">; entries: readonly ManifestEntryBase[] }> = [];
  if (kind === "all" || kind === "image") pools.push({ kind: "image", entries: manifest.images ?? [] });
  if (kind === "all" || kind === "audio") pools.push({ kind: "audio", entries: manifest.audio ?? [] });
  if (kind === "all" || kind === "scene") pools.push({ kind: "scene", entries: manifest.scenes ?? [] });
  if (kind === "all" || kind === "timeline") pools.push({ kind: "timeline", entries: manifest.timelines ?? [] });

  const idFilter = options.id && options.id.length > 0 ? new Set(options.id) : null;

  const selected: Target[] = [];
  for (const pool of pools) {
    let chosen = pool.entries;
    if (idFilter) {
      chosen = pool.entries.filter((entry) => idFilter.has(entry.id));
    } else if (!options.all && !options.yes && process.stdin.isTTY) {
      const items: SelectItem<ManifestEntryBase>[] = pool.entries.map((entry) => ({
        value: entry,
        label: `[${entry.id}] ${describe(entry)}`,
        detail: detailOf(entry),
      }));
      const picks = await multiSelect(`Select ${pool.kind}s to generate:`, items, { preselectAll: false });
      chosen = picks;
    }
    for (const entry of chosen) selected.push({ kind: pool.kind, entry });
  }
  return selected;
}

async function generateImage(
  project: ManifestProject,
  entry: ImageEntry,
  options: GenerateOptions,
): Promise<string> {
  const format = entry.format ?? project.config.images?.defaultFormat ?? "png";
  const safeFormat = format === "svg" ? "png" : format;
  const outDir = options.out ? resolve(options.out) : join(resolveOutputDir(project.config), OUTPUT_SUBDIRS.images);
  await ensureDir(outDir);
  const outputPath = await resolveOutputPath(join(outDir, `${entry.id}.${safeFormat}`), options.overwrite ?? false);
  if (options.dryRun) return outputPath;

  const resolvedImage = await resolveImageClip(project, entry.id);
  const buffer = await renderImageBuffer(resolvedImage.clips, {
    width: resolvedImage.width,
    height: resolvedImage.height,
    background: resolvedImage.background,
    format: safeFormat,
    quality: entry.quality ?? project.config.images?.quality,
    scaleFactor: entry.scaleFactor,
    seed: options.seed ?? 0,
  });
  await writeFile(outputPath, buffer);
  return outputPath;
}

async function generateAudio(
  project: ManifestProject,
  entry: AudioEntry,
  options: GenerateOptions,
): Promise<string> {
  const outDir = options.out ? resolve(options.out) : join(resolveOutputDir(project.config), OUTPUT_SUBDIRS.audio);
  await ensureDir(outDir);
  const outputPath = await resolveOutputPath(join(outDir, `${entry.id}.wav`), options.overwrite ?? false);
  if (options.dryRun) return outputPath;

  const buffer = await resolveAudioBuffer(project, entry.id);
  const wav = encodeWavBuffer(buffer);
  await writeFile(outputPath, wav);
  return outputPath;
}

async function composeScene(
  project: ManifestProject,
  sceneEntry: SceneEntry,
): Promise<Composition> {
  return composeSceneComposition(project, sceneEntry.id);
}

async function generateVideoTarget(
  project: ManifestProject,
  target: { kind: "scene" | "timeline"; entry: ManifestEntryBase },
  options: GenerateOptions,
): Promise<string> {
  const config = project.config;
  const composition = target.kind === "scene"
    ? await composeScene(project, target.entry as SceneEntry)
    : await assembleTimelineComposition(project, target.entry.id);

  const subdir = target.kind === "scene" ? OUTPUT_SUBDIRS.scenes : OUTPUT_SUBDIRS.videos;
  const format = (target.entry as TimelineEntry).format ?? config.render?.format ?? "mp4";
  const outDir = options.out ? resolve(options.out) : join(resolveOutputDir(config), subdir);
  await ensureDir(outDir);
  const outputPath = await resolveOutputPath(join(outDir, `${target.entry.id}.${format}`), options.overwrite ?? false);

  if (options.dryRun) return outputPath;

  const job = startCompositionRender({
    composition,
    outputPath,
    config,
    seed: options.seed ?? 0,
    concurrency: options.concurrency,
    quality: (target.entry as TimelineEntry).quality,
    silent: options.silent ?? false,
  });

  await job.promise;
  return outputPath;
}

export async function generateCommand(kind: GenerateKind, options: GenerateOptions): Promise<void> {
  const configPath = options.config ?? "cinecode.config.js";
  const config: CinecodeConfig = await loadConfig(resolve(configPath));
  const project = await loadManifestProject(config);

  if (!project.hasManifest) {
    throw createError(ErrorCode.CC1009, { path: project.entryPath }, { location: { file: project.entryPath }, fixHint: "Create a main.ts manifest with defineMain({...})." });
  }
  runReport.setProject({ root: process.cwd(), config: resolve(configPath), manifest: project.entryPath });

  const targets = await selectTargets(kind, project, options);
  if (targets.length === 0) {
    throw createError(ErrorCode.CC4004, { path: `generate ${kind}` }, { fixHint: "Select at least one id or register entries in main.ts." });
  }
  if (!options.dryRun) runReport.expectArtifact(`generate ${kind}`);

  const startTime = Date.now();
  const results: Array<{ id: string; kind: string; path: string }> = [];

  for (const target of targets) {
    process.stdout.write(`\n▶ ${target.kind}: ${target.entry.id}\n`);
    let outputPath: string;
    if (target.kind === "image") {
      outputPath = await generateImage(project, target.entry as ImageEntry, options);
    } else if (target.kind === "audio") {
      outputPath = await generateAudio(project, target.entry as AudioEntry, options);
    } else {
      outputPath = await generateVideoTarget(project, target as { kind: "scene" | "timeline"; entry: ManifestEntryBase }, options);
    }
    results.push({ id: target.entry.id, kind: target.kind, path: outputPath });
    if (!options.dryRun) runReport.artifact({ kind: target.kind, path: resolve(outputPath), units: 1, unit: "file" });
    if (!options.silent) {
      console.log(`✓ ${target.kind} → ${outputPath}`);
    }
  }
  runReport.result({ generated: results });

  if (!options.silent) {
    console.log(`\nGenerated ${results.length} asset(s) in ${formatTime(Date.now() - startTime)}`);
  }
}

export function createGenerateCommand(): Command {
  return new Command("generate")
    .description("Generate images, audio, scenes, or timelines from main.ts")
    .argument("[kind]", "audio | image | scene | timeline | all", "all")
    .option("--id <id...>", "Only generate the given ids")
    .option("--all", "Generate everything without prompting", false)
    .option("-y, --yes", "Skip prompts and generate everything", false)
    .option("--out <dir>", "Output directory override")
    .option("--seed <number>", "Random seed", (v) => parseInt(v, 10))
    .option("--concurrency <number|auto>", "Number of worker threads", (v) => (v === "auto" ? "auto" : parseInt(v, 10)))
    .option("--overwrite", "Overwrite existing files", false)
    .option("--silent", "Suppress progress output", false)
    .option("--dry-run", "Resolve targets without writing", false)
    .action(async (kind: string, options: GenerateOptions, command: Command) => {
      const valid: GenerateKind[] = ["audio", "image", "scene", "timeline", "all"];
      if (!valid.includes(kind as GenerateKind)) {
        throw createError(ErrorCode.CC1014, { kind: "target", name: kind, available: valid.join(", ") });
      }
      await generateCommand(kind as GenerateKind, { ...command.optsWithGlobals(), ...options });
    });
}
