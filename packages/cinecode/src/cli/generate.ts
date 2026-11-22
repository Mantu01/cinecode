import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CinecodeConfig, Composition } from "../core/types/index.js";
import type { AudioEntry, ImageEntry, ManifestEntryBase, SceneEntry, TimelineEntry } from "../core/types/manifest.js";
import {
  assembleTimelineComposition,
  assertSelectorId,
  composeSceneComposition,
  resolveAudioBuffer,
  resolveImageClip,
  type ManifestProject,
} from "../manifest/index.js";
import { createProjectResolver, reportResolution } from "./project-resolver.js";
import { renderImageBuffer } from "../renderer/image.js";
import { encodeWavBuffer } from "../audio/muxer.js";
import { multiSelect, type SelectItem } from "./prompt-select.js";
import { OUTPUT_SUBDIRS, ensureDir, resolveOutputPath } from "./shared.js";
import { formatTime } from "../pipeline/progress.js";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";
import { resolveRenderParameters } from "./precedence.js";
import { assertRenderableFormat } from "./format-preflight.js";
import { assertIdPathInside } from "../manifest/ids.js";
import { resolveProjectRoots } from "../config/roots.js";
import { outputPlanFor } from "../core/output-plan.js";
import { orchestrateRender, type RenderTargetItem } from "./render.js";

export type GenerateKind = "audio" | "image" | "scene" | "timeline" | "all";

export interface GenerateOptions {
  /** Repeatable `--id` values. */
  id?: string[];
  all?: boolean;
  yes?: boolean;
  config?: string;
  root?: string;
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

  for (const id of options.id ?? []) assertSelectorId("generate", id);
  const idFilter = options.id && options.id.length > 0 ? new Set(options.id) : null;

  const selected: Target[] = [];
  for (const pool of pools) {
    let chosen = pool.entries;
    if (idFilter) {
      chosen = pool.entries.filter((entry) => idFilter.has(entry.id));
    } else if (!options.all && !options.yes) {
      if (!process.stdin.isTTY) {
        throw createError(ErrorCode.CC0001, {
          reason: "generate requires an explicit selector (--id, --all, or --yes) in non-interactive mode",
        });
      }
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
  const plan = outputPlanFor(format);
  const outDir = options.out
    ? resolve(project.rootDir, options.out)
    : join(resolveProjectRoots(project.rootDir, project.config).output, OUTPUT_SUBDIRS.images);
  await ensureDir(outDir);
  const overwrite = options.overwrite ?? project.config.render?.overwrite ?? project.config.overwrite ?? false;
  const outputPath = await resolveOutputPath(join(outDir, `${entry.id}${plan.extension}`), overwrite);
  assertIdPathInside(outDir, outputPath, entry.id);
  if (options.dryRun) return outputPath;

  const resolvedImage = await resolveImageClip(project, entry.id);
  const buffer = await renderImageBuffer(resolvedImage.clips, {
    width: resolvedImage.width,
    height: resolvedImage.height,
    background: resolvedImage.background,
    format,
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
  const outDir = options.out
    ? resolve(project.rootDir, options.out)
    : join(resolveProjectRoots(project.rootDir, project.config).output, OUTPUT_SUBDIRS.audio);
  await ensureDir(outDir);
  const overwrite = options.overwrite ?? project.config.render?.overwrite ?? project.config.overwrite ?? false;
  const outputPath = await resolveOutputPath(join(outDir, `${entry.id}.wav`), overwrite);
  assertIdPathInside(outDir, outputPath, entry.id);
  if (options.dryRun) return outputPath;

  const buffer = await resolveAudioBuffer(project, entry.id);
  const wav = encodeWavBuffer(buffer);
  await writeFile(outputPath, wav);
  return outputPath;
}

export async function generateCommand(kind: GenerateKind, options: GenerateOptions): Promise<void> {
  const resolver = createProjectResolver({ root: options.root, config: options.config });
  const resolution = await resolver.resolve();
  const config: CinecodeConfig = resolution.config;
  const project = resolution.manifest!;
  reportResolution(resolution, options.dryRun === true || (options as { verbose?: boolean }).verbose === true);

  const targets = await selectTargets(kind, project, options);
  if (targets.length === 0) {
    throw createError(ErrorCode.CC4004, { path: `generate ${kind}` }, { fixHint: "Select at least one id or register entries in main.ts." });
  }

  if (process.stdin.isTTY && !options.silent) {
    console.log(`\nTargets to generate (${targets.length}):`);
    for (const t of targets) {
      console.log(`  - [${t.kind}] ${t.entry.id} (${describe(t.entry)})`);
    }
  }

  if (!options.dryRun) runReport.expectArtifact(`generate ${kind}`);

  const startTime = Date.now();
  const results: Array<{ id: string; kind: string; path: string }> = [];

  for (const target of targets) {
    if (target.kind === "image") {
      process.stderr.write(`\n▶ image: ${target.entry.id}\n`);
      const outputPath = await generateImage(project, target.entry as ImageEntry, options);
      results.push({ id: target.entry.id, kind: target.kind, path: outputPath });
      if (!options.dryRun) runReport.artifact({ kind: "image", path: resolve(outputPath), units: 1, unit: "file" });
      if (!options.silent) console.log(`✓ image → ${outputPath}`);
    } else if (target.kind === "audio") {
      process.stderr.write(`\n▶ audio: ${target.entry.id}\n`);
      const outputPath = await generateAudio(project, target.entry as AudioEntry, options);
      const audioEntry = target.entry as AudioEntry;
      const sampleRate = audioEntry.sampleRate ?? project.config.audio?.sampleRate ?? 48000;
      const channels = audioEntry.channels ?? project.config.audio?.channels ?? 2;
      runReport.result({ audio: { sampleRate, channels } });
      results.push({ id: target.entry.id, kind: target.kind, path: outputPath });
      if (!options.dryRun) runReport.artifact({ kind: "audio", path: resolve(outputPath), units: 1, unit: "file" });
      if (!options.silent) console.log(`✓ audio → ${outputPath}`);
    } else {
      process.stderr.write(`\n▶ ${target.kind}: ${target.entry.id}\n`);
      const comp = target.kind === "scene"
        ? await composeSceneComposition(project, target.entry.id)
        : await assembleTimelineComposition(project, target.entry.id);
      const targetItem: RenderTargetItem = {
        id: target.entry.id,
        name: target.entry.name,
        kind: target.kind,
        composition: comp,
        entry: target.entry,
        width: (target.entry as any).width,
        height: (target.entry as any).height,
        fps: (target.entry as any).fps,
        format: (target.entry as any).format,
        codec: (target.entry as any).codec,
        quality: (target.entry as any).quality,
        duration: (target.entry as any).duration ?? comp.duration,
      };
      await orchestrateRender(resolution, [targetItem], {
        out: options.out,
        concurrency: options.concurrency,
        seed: options.seed,
        overwrite: options.overwrite ?? config.render?.overwrite ?? config.overwrite ?? false,
        dryRun: options.dryRun === true,
        all: false,
        preview: false,
        fresh: false,
        resume: false,
        noCache: false,
      });
      results.push({ id: target.entry.id, kind: target.kind, path: target.entry.id });
    }
  }
  runReport.result({ generated: results });

  if (!options.silent) {
    console.log(`\nGenerated ${results.length} asset(s) in ${formatTime(Date.now() - startTime)}`);
  }
}

import { findCommand, buildCommanderCommand } from "./command-registry.js";

export function createGenerateCommand(): Command {
  const spec = findCommand("generate");
  if (!spec) throw new Error("Command 'generate' not found in registry");
  return buildCommanderCommand(spec);
}
