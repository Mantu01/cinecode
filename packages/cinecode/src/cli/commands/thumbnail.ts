import { Command } from "commander";
import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Composition } from "../../core/types/index.js";
import { compositionTotalFrames } from "../../core/time/index.js";
import { selectComposition } from "../resolve/composition-loader.js";
import { generateThumbnail, selectThumbnailFrame } from "../../encoder/thumbnail/index.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { runReport } from "../output/run-report.js";
import { createProjectResolver, reportResolution } from "../resolve/project-resolver.js";
import { assembleTimelineComposition, composeSceneComposition } from "../../manifest/index.js";
import { OUTPUT_SUBDIRS } from "../shared/shared.js";
import { UsageError } from "../shared/usage-error.js";

interface ThumbnailCliOptions {
  composition?: string;
  outputDir?: string;
  count: number;
  frame?: number;
  format: "png" | "jpg" | "webp";
  seed?: number;
  dryRun?: boolean;
  root?: string;
  config?: string;
}

async function projectComposition(
  resolution: Awaited<ReturnType<ReturnType<typeof createProjectResolver>["resolve"]>>,
  compositionName?: string,
): Promise<{ composition: Composition; id: string }> {
  if (resolution.mode === "file") {
    const composition = selectComposition([...resolution.compositions], compositionName);
    return { composition, id: composition.name };
  }
  const project = resolution.manifest;
  if (!project) throw createError(ErrorCode.CC1009, { path: resolution.manifestPath });
  const selected = await resolution.selected();
  if (selected[0]) return { composition: selected[0], id: resolution.selection.id ?? selected[0].name };
  const timeline = project.manifest.timelines?.[0];
  if (timeline) return { composition: await assembleTimelineComposition(project, timeline.id), id: timeline.id };
  const scene = project.manifest.scenes?.[0];
  if (scene) return { composition: await composeSceneComposition(project, scene.id), id: scene.id };
  throw createError(ErrorCode.CC1009, { path: project.entryPath }, { fixHint: "Register a timeline or scene in main.ts." });
}

export async function thumbnailCommand(
  fileOrOptions: string | ThumbnailCliOptions,
  maybeOptions?: ThumbnailCliOptions,
  maybeContext?: import("../gate/preflight.js").PreflightContext,
): Promise<void> {
  const isPositional = typeof fileOrOptions === "string";
  const options = (isPositional ? (maybeOptions ?? {}) : (fileOrOptions ?? maybeOptions ?? {})) as ThumbnailCliOptions;
  const contextCandidates = isPositional ? [maybeContext] : [maybeOptions, maybeContext];
  const context = contextCandidates.find(
    (candidate): candidate is import("../gate/preflight.js").PreflightContext =>
      typeof candidate === "object" && candidate !== null && "resolution" in candidate,
  );
  const file = isPositional ? fileOrOptions : undefined;
  const count = options.count ?? 3;
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new UsageError(`--count must be an integer between 1 and 100, received ${String(options.count)}.`);
  }
  const format = options.format ?? "png";
  if (!["png", "jpg", "webp"].includes(format)) {
    throw new UsageError(`Unknown format '${format}'. Valid formats: png, jpg, webp.`);
  }
  if (options.frame !== undefined && (!Number.isInteger(options.frame) || options.frame < 0)) {
    throw new UsageError(`--frame must be a non-negative integer, received ${String(options.frame)}.`);
  }

  const resolution = context?.resolution ?? await createProjectResolver({
    root: options.root,
    config: options.config,
    file,
    composition: options.composition,
    requireSelection: false,
  }).resolve();
  if (!context?.resolution) reportResolution(resolution, false);

  const { composition, id } = await projectComposition(resolution, options.composition);
  const outputDir = options.outputDir
    ? resolve(resolution.context.root, options.outputDir)
    : join(resolution.context.roots.output, OUTPUT_SUBDIRS.images);
  const seed = options.seed ?? 0;
  const selection = await selectThumbnailFrame(composition, { seed, frameIndices: options.frame !== undefined ? [options.frame] : undefined });

  const total = Math.max(1, compositionTotalFrames(composition));
  const frames: number[] = options.frame !== undefined
    ? [Math.min(total - 1, options.frame)]
    : selection.candidates.slice(0, count).map((candidate) => candidate.frame);
  for (let index = 0; frames.length < count && index < total; index += 1) {
    const frame = Math.round((index * (total - 1)) / Math.max(1, count - 1));
    if (!frames.includes(frame)) frames.push(frame);
  }
  frames.sort((left, right) => left - right);

  const files: string[] = [];
  if (!options.dryRun) {
    await mkdir(outputDir, { recursive: true });
    for (const frame of frames) {
      const target = join(outputDir, `${id}-frame-${frame}.${format}`);
      const result = await generateThumbnail(composition, target, { formats: [format], frame, seed });
      for (const output of result.files) {
        files.push(output.path);
        runReport.artifact({ kind: "thumbnail", path: resolve(output.path), units: 1, unit: "image" });
      }
    }
  }

  if (!runReport.isMachine()) {
    runReport.diagnostic(`Selected frame: ${selection.frame} (score ${selection.score.score.toFixed(3)})`);
    for (const frame of frames) runReport.diagnostic(`  frame ${String(frame).padStart(6)}`);
    for (const path of files) runReport.diagnostic(`  wrote ${path}`);
  }
  if (files.length === 0 && !options.dryRun) throw createError(ErrorCode.CC4004, { path: outputDir });
  runReport.result({ frame: selection.frame, frames, files, dryRun: options.dryRun === true });
}

