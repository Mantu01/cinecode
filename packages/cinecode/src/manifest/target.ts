import type {
  CinecodeConfig,
  Composition,
  ManifestEntryBase,
  QualitySetting,
  RenderFormat,
  VideoCodec,
  AudioPlacement,
  Timeline,
} from "../core/types/index.js";
import { composition as makeComposition, timeline as makeTimeline } from "../core/clips/builders.js";
import { createError, ErrorCode } from "../errors/index.js";
import { outputPlanFor, resolveOutputPlan, type ResolvedOutputPlan, STREAM_FORMATS, OUTPUT_PLANS } from "../core/output-plan.js";
import { checkDeclaredDuration } from "./duration.js";
import {
  toSeconds,
  timelineDurationSeconds,
  findEntry,
  resolveEntryFile,
  resolveTimelineValue,
  assembleTimelineFromRefs,
  assembleAudioTracks,
  resolveScene,
  resolveImageClip,
  assembleTimelineComposition,
  composeSceneComposition,
  type ManifestProject,
} from "./index.js";
import { isComposition, isSceneDef } from "./index.js";
import { loadModuleFile } from "./loader.js";
import { hotReloadEnabled } from "../loader/index.js";
import { DEFAULTS } from "../config/defaults.js";

export interface ResolvedGeometry {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly background: string;
  readonly duration: number;
  readonly contentDuration: number;
  readonly truncate: boolean;
  readonly scaleFactor?: number;
}

export interface CompositionGeometryInput {
  readonly entry: ManifestEntryBase & {
    readonly width?: number;
    readonly height?: number;
    readonly fps?: number;
    readonly background?: string;
    readonly duration?: number | string;
    readonly truncate?: boolean;
    readonly format?: RenderFormat;
    readonly codec?: VideoCodec;
    readonly quality?: QualitySetting | number;
    readonly scaleFactor?: number;
  };
  readonly config: CinecodeConfig;
  readonly flags?: {
    readonly width?: number;
    readonly height?: number;
    readonly fps?: number;
    readonly format?: RenderFormat;
    readonly codec?: VideoCodec;
    readonly quality?: QualitySetting;
    readonly alpha?: boolean;
  };
  readonly preset?: {
    readonly width?: number;
    readonly height?: number;
    readonly fps?: number;
    readonly format?: RenderFormat;
    readonly codec?: VideoCodec;
  };
  readonly contentDuration?: number;
  readonly rawComposition?: Composition;
  readonly manifestPath?: string;
  readonly kind?: "timeline" | "scene" | "image" | "audio";
}

export interface ResolvedCompositionGeometry extends ResolvedGeometry {
  readonly format: RenderFormat;
  readonly codec?: VideoCodec;
  readonly quality: QualitySetting;
  readonly outputPlan: ResolvedOutputPlan;
}

/**
 * Resolves authoritative geometry and output intent using strict precedence:
 * command flag beats entry, entry beats preset, preset beats config, config beats default.
 */
export function resolveCompositionGeometry(input: CompositionGeometryInput): ResolvedCompositionGeometry {
  const { entry, config, flags, preset, rawComposition, manifestPath = "main.ts" } = input;
  const kind = input.kind ?? (rawComposition ? "timeline" : "scene");

  const width = flags?.width ?? entry.width ?? preset?.width ?? config.video?.width ?? DEFAULTS.video.width;
  const height = flags?.height ?? entry.height ?? preset?.height ?? config.video?.height ?? DEFAULTS.video.height;
  const fps = flags?.fps ?? entry.fps ?? preset?.fps ?? config.video?.fps ?? DEFAULTS.video.fps;
  const background = entry.background ?? config.video?.background ?? DEFAULTS.video.background;
  const scaleFactor = entry.scaleFactor ?? config.images?.scaleFactor ?? 1;

  const format =
    flags?.format ??
    entry.format ??
    preset?.format ??
    config.render?.format ??
    (DEFAULTS.render.format as RenderFormat);

  const codec = flags?.codec ?? entry.codec ?? preset?.codec ?? config.render?.codec ?? undefined;
  const rawQuality = flags?.quality ?? entry.quality;
  const quality: QualitySetting =
    typeof rawQuality === "number"
      ? "medium"
      : (rawQuality ??
        (config.render?.quality as QualitySetting) ??
        (DEFAULTS.render.quality as QualitySetting));

  const truncate = entry.truncate === true;

  const contentDuration =
    input.contentDuration ?? (rawComposition ? timelineDurationSeconds(rawComposition.rootTimeline, fps) : 0);

  const declared = toSeconds(entry.duration, fps) ?? (rawComposition ? toSeconds(rawComposition.duration, fps) : undefined);

  if (declared !== undefined && contentDuration > 0) {
    const issues = checkDeclaredDuration({
      kind: kind === "scene" ? "scene" : "timeline",
      id: entry.id,
      declared,
      content: contentDuration,
      fps,
      truncate,
      manifestPath,
    });
    if (issues.length > 0) throw issues[0];
  }

  const duration = declared !== undefined ? declared : contentDuration;

  // Validate output settings at selection time before any frame is rendered
  const outputPlan = resolveOutputPlan({
    format,
    codec,
    alpha: flags?.alpha,
  });

  const entryAny = entry as { audioRef?: readonly string[] };
  if (entryAny.audioRef && entryAny.audioRef.length > 0 && !outputPlan.plan.audio) {
    throw createError(ErrorCode.CC1008, {
      format,
      supported: STREAM_FORMATS.filter((f) => OUTPUT_PLANS[f].audio !== undefined).join(", "),
      reason: `format "${format}" does not support audio, but entry "${entry.id}" specifies audioRef`,
    });
  }

  return Object.freeze({
    width,
    height,
    fps,
    background,
    duration,
    contentDuration,
    truncate,
    scaleFactor,
    format,
    codec: outputPlan.codec,
    quality,
    outputPlan,
  });
}

/**
 * Clones a composition with resolved geometry values applied, preserving immutability.
 */
export function applyCompositionGeometry(
  raw: Composition,
  geometry: ResolvedCompositionGeometry,
  entryName?: string,
): Composition {
  return {
    ...raw,
    name: entryName ?? raw.name,
    width: geometry.width,
    height: geometry.height,
    fps: geometry.fps,
    background: geometry.background,
    duration: geometry.duration > 0 ? geometry.duration : raw.duration,
    contentDuration: geometry.contentDuration,
  };
}

export interface ResolvedTarget {
  readonly id: string;
  readonly kind: "timeline" | "scene" | "image" | "audio";
  readonly entry: ManifestEntryBase;
  readonly composition: Composition;
  readonly geometry: ResolvedCompositionGeometry;
  readonly outputPlan: ResolvedOutputPlan;
  readonly audioPlacement: readonly AudioPlacement[];
  readonly format: RenderFormat;
  readonly codec?: VideoCodec;
  readonly quality: QualitySetting;
}

/**
 * Resolves a single authoritative target record for any entry in the manifest.
 */
export async function resolveTarget(
  project: ManifestProject,
  id: string,
  options: {
    readonly kind?: "timeline" | "scene" | "image" | "audio";
    readonly flags?: {
      readonly width?: number;
      readonly height?: number;
      readonly fps?: number;
      readonly format?: RenderFormat;
      readonly codec?: VideoCodec;
      readonly quality?: QualitySetting;
      readonly alpha?: boolean;
    };
  } = {},
): Promise<ResolvedTarget> {
  const manifest = project.manifest;
  let kind = options.kind;
  if (!kind) {
    const idKey = id.toLowerCase();
    if (manifest.timelines?.some((t) => t.id.toLowerCase() === idKey)) kind = "timeline";
    else if (manifest.scenes?.some((s) => s.id.toLowerCase() === idKey)) kind = "scene";
    else if (manifest.images?.some((i) => i.id.toLowerCase() === idKey)) kind = "image";
    else if (manifest.audio?.some((a) => a.id.toLowerCase() === idKey)) kind = "audio";
    else kind = "timeline";
  }

  if (kind === "timeline") {
    const entry = findEntry(manifest.timelines, id, "timeline");
    const composition = await assembleTimelineComposition(project, entry.id);
    const geometry = resolveCompositionGeometry({
      entry,
      config: project.config,
      flags: options.flags,
      contentDuration: composition.contentDuration,
      manifestPath: project.entryPath,
      rawComposition: composition,
      kind: "timeline",
    });
    const finalComp = applyCompositionGeometry(composition, geometry, entry.id);
    return Object.freeze({
      id: entry.id,
      kind: "timeline",
      entry,
      composition: finalComp,
      geometry,
      outputPlan: geometry.outputPlan,
      audioPlacement: finalComp.audioPlacements ?? [],
      format: geometry.format,
      codec: geometry.codec,
      quality: geometry.quality,
    });
  }

  if (kind === "scene") {
    const entry = findEntry(manifest.scenes, id, "scene");
    const composition = await composeSceneComposition(project, entry.id);
    const geometry = resolveCompositionGeometry({
      entry,
      config: project.config,
      flags: options.flags,
      contentDuration: composition.contentDuration,
      manifestPath: project.entryPath,
      rawComposition: composition,
      kind: "scene",
    });
    const finalComp = applyCompositionGeometry(composition, geometry, entry.id);
    return Object.freeze({
      id: entry.id,
      kind: "scene",
      entry,
      composition: finalComp,
      geometry,
      outputPlan: geometry.outputPlan,
      audioPlacement: finalComp.audioPlacements ?? [],
      format: geometry.format,
      codec: geometry.codec,
      quality: geometry.quality,
    });
  }

  if (kind === "image") {
    const entry = findEntry(manifest.images, id, "image");
    await resolveImageClip(project, entry.id);
    const geometry = resolveCompositionGeometry({
      entry,
      config: project.config,
      flags: options.flags,
      manifestPath: project.entryPath,
      kind: "image",
    });
    const composition = makeComposition({
      name: entry.id,
      width: geometry.width,
      height: geometry.height,
      fps: geometry.fps,
      background: geometry.background,
      duration: 1 / geometry.fps,
      contentDuration: 1 / geometry.fps,
      rootTimeline: makeTimeline([], { name: entry.id, duration: 1 / geometry.fps }),
    });
    return Object.freeze({
      id: entry.id,
      kind: "image",
      entry,
      composition,
      geometry,
      outputPlan: geometry.outputPlan,
      audioPlacement: [],
      format: geometry.format,
      codec: geometry.codec,
      quality: geometry.quality,
    });
  }

  // Audio
  const entry = findEntry(manifest.audio, id, "audio");
  const geometry = resolveCompositionGeometry({
    entry,
    config: project.config,
    flags: options.flags,
    manifestPath: project.entryPath,
    kind: "audio",
  });
  const composition = makeComposition({
    name: entry.id,
    width: 0,
    height: 0,
    fps: geometry.fps,
    background: "#000000",
    duration: geometry.duration,
    contentDuration: geometry.contentDuration,
    rootTimeline: makeTimeline([], { name: entry.id, duration: geometry.duration }),
  });
  return Object.freeze({
    id: entry.id,
    kind: "audio",
    entry,
    composition,
    geometry,
    outputPlan: geometry.outputPlan,
    audioPlacement: [],
    format: geometry.format,
    codec: geometry.codec,
    quality: geometry.quality,
  });
}
