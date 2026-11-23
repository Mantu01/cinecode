import { Command } from "commander";
import { join, resolve } from "node:path";
import type { CinecodeConfig, Composition } from "../../core/types/index.js";
import { compositionTotalFrames } from "../../core/time/index.js";
import type { AudioEntry, ImageEntry, SceneEntry, TimelineEntry } from "../../core/types/manifest.js";
import {
  assembleTimelineComposition,
  assertSelectorId,
  composeSceneComposition,
  resolveAudioBuffer,
  resolveImageClip,
  type ManifestProject,
} from "../../manifest/index.js";
import { createProjectResolver, reportResolution } from "../resolve/project-resolver.js";
import { renderImageBuffer } from "../../renderer/image.js";
import { encodeWavBuffer } from "../../audio/muxer.js";
import { multiSelect, type SelectItem } from "../shared/prompt-select.js";
import { OUTPUT_SUBDIRS, ensureDir, resolveOutputPath } from "../shared/shared.js";
import { formatTime } from "../../pipeline/progress.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { runReport } from "../output/run-report.js";
import { UsageError } from "../shared/usage-error.js";
import { assertRenderableFormat } from "../gate/format-preflight.js";
import { assertIdPathInside } from "../../manifest/ids.js";
import { resolveProjectRoots } from "../../config/roots.js";
import { outputPlanFor } from "../../core/output-plan.js";
import { writeFileAtomic } from "../../encoder/output.js";
import { orchestrateRender, type RenderTargetItem } from "../pipeline/render-run.js";

export type GenerateKind = "audio" | "image" | "scene" | "timeline" | "all";

const GENERATE_KINDS: readonly GenerateKind[] = ["image", "audio", "scene", "timeline", "all"];

export interface GenerateOptions {
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

type Target =
  | { readonly kind: "image"; readonly entry: ImageEntry }
  | { readonly kind: "audio"; readonly entry: AudioEntry }
  | { readonly kind: "scene"; readonly entry: SceneEntry }
  | { readonly kind: "timeline"; readonly entry: TimelineEntry };

function describe(entry: ImageEntry | AudioEntry | SceneEntry | TimelineEntry): string {
  return entry.name ?? entry.id;
}

function detailOf(entry: ImageEntry | AudioEntry | SceneEntry | TimelineEntry): string {
  return entry.file ? `(${entry.file})` : entry.id;
}

function parseKind(input: string | undefined, options: GenerateOptions): GenerateKind {
  if (input !== undefined) {
    if (!(GENERATE_KINDS as readonly string[]).includes(input)) {
      throw new UsageError(`Unknown target '${input}'. Valid targets: ${GENERATE_KINDS.join(", ")}.`);
    }
    return input as GenerateKind;
  }
  if (options.all || (options.id?.length ?? 0) > 0) return "all";
  throw new UsageError(`Missing target. Pass one of: ${GENERATE_KINDS.join(", ")}.`);
}

async function selectTargets(
  kind: GenerateKind,
  project: ManifestProject,
  options: GenerateOptions,
): Promise<Target[]> {
  const { manifest } = project;
  const pools: Array<{ kind: Target["kind"]; entries: readonly Target["entry"][] }> = [];
  if (kind === "all" || kind === "image") pools.push({ kind: "image", entries: manifest.images ?? [] });
  if (kind === "all" || kind === "audio") pools.push({ kind: "audio", entries: manifest.audio ?? [] });
  if (kind === "all" || kind === "scene") pools.push({ kind: "scene", entries: manifest.scenes ?? [] });
  if (kind === "all" || kind === "timeline") pools.push({ kind: "timeline", entries: manifest.timelines ?? [] });

  for (const id of options.id ?? []) assertSelectorId("generate", id);
  const idFilter = options.id && options.id.length > 0 ? new Set(options.id) : null;
  if (idFilter) {
    const known = new Set(pools.flatMap((pool) => pool.entries.map((entry) => entry.id)));
    for (const id of idFilter) {
      if (!known.has(id)) {
        throw new UsageError(`Unknown id '${id}' for target '${kind}'. Known ids: ${[...known].join(", ") || "none"}.`);
      }
    }
  }

  const selected: Target[] = [];
  for (const pool of pools) {
    const chosen = idFilter ? pool.entries.filter((entry) => idFilter.has(entry.id)) : pool.entries;
    let picked = chosen;
    if (!idFilter && !options.all && !options.yes) {
      if (!process.stdin.isTTY) {
        throw new UsageError("generate requires an explicit selector (--id, --all, or --yes) in non-interactive mode");
      }
      const items: SelectItem<never>[] = chosen.map((entry) => ({
        value: entry as never,
        label: `[${entry.id}] ${describe(entry)}`,
        detail: detailOf(entry),
      }));
      picked = (await multiSelect(`Select ${pool.kind}s to generate:`, items, { preselectAll: false })) as readonly Target["entry"][];
    }
    for (const entry of picked) selected.push({ kind: pool.kind, entry } as Target);
  }
  return selected;
}

function outputDirFor(project: ManifestProject, kind: Target["kind"], options: GenerateOptions): string {
  if (options.out) return resolve(project.rootDir, options.out);
  const roots = resolveProjectRoots(project.rootDir, project.config);
  if (kind === "image") return join(roots.output, OUTPUT_SUBDIRS.images);
  if (kind === "audio") return join(roots.output, OUTPUT_SUBDIRS.audio);
  return kind === "scene" ? join(roots.output, OUTPUT_SUBDIRS.scenes) : join(roots.output, OUTPUT_SUBDIRS.videos);
}

function overwriteFor(project: ManifestProject, options: GenerateOptions): boolean {
  return options.overwrite ?? project.config.overwrite ?? false;
}

function imageExtension(format: "png" | "jpg" | "webp"): string {
  return format === "jpg" ? ".jpg" : `.${format}`;
}

async function plannedImagePath(project: ManifestProject, entry: ImageEntry, options: GenerateOptions): Promise<string> {
  const format = entry.format ?? project.config.images?.defaultFormat ?? "png";
  const outDir = outputDirFor(project, "image", options);
  const outputPath = await resolveOutputPath(join(outDir, `${entry.id}${imageExtension(format)}`), overwriteFor(project, options));
  assertIdPathInside(outDir, outputPath, entry.id);
  return outputPath;
}

async function plannedAudioPath(project: ManifestProject, entry: AudioEntry, options: GenerateOptions): Promise<string> {
  const outDir = outputDirFor(project, "audio", options);
  const outputPath = await resolveOutputPath(join(outDir, `${entry.id}.wav`), overwriteFor(project, options));
  assertIdPathInside(outDir, outputPath, entry.id);
  return outputPath;
}

async function generateImage(project: ManifestProject, entry: ImageEntry, options: GenerateOptions): Promise<string> {
  const outputPath = await plannedImagePath(project, entry, options);
  if (options.dryRun) return outputPath;
  const format = entry.format ?? project.config.images?.defaultFormat ?? "png";
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
  await writeFileAtomic(outputPath, buffer);
  return outputPath;
}

async function generateAudio(project: ManifestProject, entry: AudioEntry, options: GenerateOptions): Promise<string> {
  const outputPath = await plannedAudioPath(project, entry, options);
  if (options.dryRun) return outputPath;
  const buffer = await resolveAudioBuffer(project, entry.id);
  await writeFileAtomic(outputPath, encodeWavBuffer(buffer));
  return outputPath;
}

function sceneTarget(entry: SceneEntry, composition: Composition, kind: "scene" | "timeline"): RenderTargetItem {
  return {
    id: entry.id,
    name: entry.name,
    kind,
    composition,
    entry,
    width: entry.width,
    height: entry.height,
    fps: entry.fps,
    format: kind === "timeline" ? (entry as TimelineEntry).format : undefined,
    codec: kind === "timeline" ? (entry as TimelineEntry).codec : undefined,
    quality: kind === "timeline" ? (entry as TimelineEntry).quality : undefined,
    duration: entry.duration ?? composition.duration,
  };
}

export async function generateCommand(
  rawKind: string | undefined,
  options: GenerateOptions,
  context?: import("../gate/preflight.js").PreflightContext,
): Promise<void> {
  const kind = parseKind(rawKind, options);
  const resolution = context?.resolution ?? await createProjectResolver({ root: options.root, config: options.config }).resolve();
  const config: CinecodeConfig = resolution.config;
  const project = resolution.manifest;
  if (!project) {
    throw createError(ErrorCode.CC1009, { path: resolution.manifestPath }, { fixHint: "Add main.ts and register entries." });
  }
  if (!context?.resolution) {
    reportResolution(resolution, options.dryRun === true || (options as { verbose?: boolean }).verbose === true);
  }

  const targets = await selectTargets(kind, project, options);
  if (targets.length === 0) {
    throw createError(ErrorCode.CC4004, { path: `generate ${kind}` }, { fixHint: "Select at least one id or register entries in main.ts." });
  }

  if (process.stdin.isTTY && !options.silent && !runReport.isMachine()) {
    runReport.diagnostic(`\nTargets to generate (${targets.length}):`);
    for (const target of targets) runReport.diagnostic(`  - [${target.kind}] ${target.entry.id} (${describe(target.entry)})`);
  }

  const startTime = Date.now();
  const results: Array<{ id: string; kind: string; path: string }> = [];

  for (const target of targets) {
    if (target.kind === "image") {
      const outputPath = await generateImage(project, target.entry, options);
      results.push({ id: target.entry.id, kind: target.kind, path: outputPath });
      if (!options.dryRun) runReport.artifact({ kind: "image", path: resolve(outputPath), units: 1, unit: "file" });
      continue;
    }
    if (target.kind === "audio") {
      const outputPath = await generateAudio(project, target.entry, options);
      const sampleRate = target.entry.sampleRate ?? project.config.audio?.sampleRate ?? 48000;
      const channels = target.entry.channels ?? project.config.audio?.channels ?? 2;
      runReport.result({ audio: { sampleRate, channels } });
      results.push({ id: target.entry.id, kind: target.kind, path: outputPath });
      if (!options.dryRun) runReport.artifact({ kind: "audio", path: resolve(outputPath), units: 1, unit: "file" });
      continue;
    }

    const composition = target.kind === "scene"
      ? await composeSceneComposition(project, target.entry.id)
      : await assembleTimelineComposition(project, target.entry.id);
    const item = sceneTarget(target.entry, composition, target.kind);
    const format = item.format ?? config.render?.format ?? "mp4";
    assertRenderableFormat({
      command: "render",
      format,
      fromFrame: 0,
      toFrame: Math.max(1, compositionTotalFrames(composition)),
    });
    const plan = outputPlanFor(format);
    const outDir = outputDirFor(project, target.kind, options);
    const outputPath = await resolveOutputPath(join(outDir, `${target.entry.id}${plan.extension}`), overwriteFor(project, options));
    assertIdPathInside(outDir, outputPath, target.entry.id);

    await orchestrateRender(resolution, [item], {
      out: outputPath,
      concurrency: options.concurrency,
      seed: options.seed,
      overwrite: overwriteFor(project, options),
      dryRun: options.dryRun === true,
      all: false,
      preview: false,
      fresh: false,
      resume: false,
      noCache: false,
    });
    results.push({ id: target.entry.id, kind: target.kind, path: outputPath });
  }

  runReport.result({ generated: results, kind, count: results.length });
  if (!options.silent && !runReport.isMachine()) {
    runReport.diagnostic(`\nGenerated ${results.length} asset(s) in ${formatTime(Date.now() - startTime)}`);
  }
}


