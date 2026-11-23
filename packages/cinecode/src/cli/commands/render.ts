import { listPresets } from "../../encoder/platform-presets.js";
import type { QualitySetting, RenderFormat, VideoCodec } from "../../core/types/index.js";
import type { ManifestEntryBase } from "../../core/types/manifest.js";
import { assembleTimelineComposition, findEntry } from "../../manifest/index.js";
import { createProjectResolver, reportResolution } from "../resolve/project-resolver.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { UsageError } from "../shared/usage-error.js";
import { isCancellation } from "../shared/exit-codes.js";
import { runReport } from "../output/run-report.js";
import { orchestrateRender, type RenderCliOptions, type RenderTargetItem } from "../pipeline/render-run.js";

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
