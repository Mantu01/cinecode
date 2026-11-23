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
import { checkDeclaredDuration, computeTimelineContentDuration } from "./duration.js";
import { createConversion, secondsToFrames } from "../core/time/convert.js";
import {
  toSeconds,
  timelineDurationSeconds,
  findEntry,
  assembleTimelineComposition,
  composeSceneComposition,
  composeImageComposition,
  composeAudioComposition,
  type ManifestProject,
} from "./index.js";
import { DEFAULTS } from "../config/defaults.js";

export interface ResolvedGeometry {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly background: string;
  readonly duration: number;
  readonly contentDuration: number;
  readonly totalFrames: number;
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
  readonly overflowingClip?: string;
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

  const width = kind === "audio" ? 0 : (flags?.width ?? entry.width ?? preset?.width ?? config.video?.width ?? DEFAULTS.video.width);
  const height = kind === "audio" ? 0 : (flags?.height ?? entry.height ?? preset?.height ?? config.video?.height ?? DEFAULTS.video.height);
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

  const declared = toSeconds(entry.duration, fps) ?? (rawComposition ? toSeconds(rawComposition.duration, fps) : undefined);
  const contentInfo = rawComposition ? computeTimelineContentDuration(rawComposition.rootTimeline, fps, declared) : undefined;
  const contentDuration = input.contentDuration ?? contentInfo?.seconds ?? 0;
  const overflowingClip = input.overflowingClip ?? contentInfo?.overflowingClip;

  if (declared !== undefined && contentDuration > 0) {
    const issues = checkDeclaredDuration({
      kind: kind === "scene" ? "scene" : "timeline",
      id: entry.id,
      declared,
      content: contentDuration,
      fps,
      truncate,
      manifestPath,
      overflowingClip,
    });
    if (issues.length > 0) throw issues[0];
  }

  const duration = declared !== undefined ? declared : contentDuration;
  const conversion = createConversion(fps);
  const totalFrames = secondsToFrames(duration, conversion);

  // Validate output settings at selection time before any frame is rendered.
  // A codec inherited from config never makes a codec-less format (gif/png/pdf) invalid.
  const outputFormat = outputPlanFor(format);
  const explicitCodec = flags?.codec ?? entry.codec ?? preset?.codec;
  const outputPlan = resolveOutputPlan({
    format,
    codec: explicitCodec ?? (codec !== undefined && outputFormat.codecs.includes(codec) ? codec : undefined),
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
    totalFrames,
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
    boundaryBehavior: "clamp",
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
    return resolveKindTarget(project, id, "timeline", entry, () => assembleTimelineComposition(project, entry.id), options.flags);
  }
  if (kind === "scene") {
    const entry = findEntry(manifest.scenes, id, "scene");
    return resolveKindTarget(project, id, "scene", entry, () => composeSceneComposition(project, entry.id), options.flags);
  }
  if (kind === "image") {
    const entry = findEntry(manifest.images, id, "image");
    return resolveKindTarget(project, id, "image", entry, () => composeImageComposition(project, entry.id), options.flags);
  }
  if (kind === "audio") {
    const entry = findEntry(manifest.audio, id, "audio");
    return resolveKindTarget(project, id, "audio", entry, () => composeAudioComposition(project, entry.id), options.flags);
  }

  throw createError(ErrorCode.CC1014, { kind: "target kind", name: kind, available: "timeline, scene, image, audio" });
}

async function resolveKindTarget(
  project: ManifestProject,
  id: string,
  kind: "timeline" | "scene" | "image" | "audio",
  entry: ManifestEntryBase,
  assemble: () => Promise<Composition>,
  flags?: CompositionGeometryInput["flags"],
): Promise<ResolvedTarget> {
  const composition = await assemble();
  if (!composition) {
    throw createError(ErrorCode.CC1010, { path: project.entryPath, reason: `failed to assemble ${kind} "${id}"` });
  }
  const geometry = resolveCompositionGeometry({
    entry,
    config: project.config,
    flags,
    contentDuration: composition.contentDuration,
    manifestPath: project.entryPath,
    rawComposition: composition,
    kind,
  });
  const finalComp = applyCompositionGeometry(composition, geometry, entry.id);
  return Object.freeze({
    id: entry.id,
    kind,
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
