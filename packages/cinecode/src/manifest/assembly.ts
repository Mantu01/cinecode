import { resolve } from "node:path";
import type {
  AnyTrack,
  AudioClip,
  Clip,
  VisualClip,
  Composition,
  Timeline,
  AudioPlacement,
  ManifestEntryBase,
} from "../core/types/index.js";
import type { AudioBuffer } from "../audio/types.js";
import type { AudioDef, ImageDef, SceneDef, SoundContext } from "../core/define/definitions.js";
import {
  audioTrack as makeAudioTrack,
  composition as makeComposition,
  timeline as makeTimeline,
  track as makeTrack,
} from "../core/clips/builders.js";
import { loadModuleFile } from "./loader.js";
import { checkDeclaredDuration, computeTimelineContentDuration } from "./duration.js";
import { createError, ErrorCode } from "../errors/index.js";
import { resolveMediaFilePath } from "../media/paths.js";
import { resolveCompositionGeometry } from "./target.js";
import { resolveAudioBuffer } from "./audio-resolve.js";
export { resolveAudioBuffer } from "./audio-resolve.js";
import {
  toSeconds,
  timelineDurationSeconds,
  shiftTimeline,
  findEntry,
  type ManifestProject,
} from "./index.js";

export type MaybeComposition = Composition & { readonly rootTimeline: Timeline };

export function isComposition(value: unknown): value is MaybeComposition {
  return !!value && typeof value === "object" && "rootTimeline" in (value as object);
}

export function isTimeline(value: unknown): value is Timeline {
  return !!value && typeof value === "object" && Array.isArray((value as Timeline).tracks);
}

export function isSceneDef(value: unknown): value is SceneDef<unknown> {
  return !!value && typeof value === "object" && (value as SceneDef<unknown>).kind === "scene";
}

export async function resolveTimelineValue(raw: unknown, file: string, baseDir?: string): Promise<Timeline> {
  if (isComposition(raw)) return raw.rootTimeline;
  if (isTimeline(raw)) return raw;
  if (isSceneDef(raw)) return raw.build(undefined as never);
  if (typeof raw === "function") {
    const result = (raw as (props: unknown) => unknown)(undefined);
    if (isTimeline(result)) return result;
    if (isComposition(result)) return result.rootTimeline;
    if (Array.isArray(result)) {
      const clips = result.filter((item): item is object => !!item && typeof item === "object") as readonly object[];
      return makeTimeline(clips.map((clip, i) => makeTrack(`default-${i}`, clip as never)), { name: `scene-${file}`, duration: 1 });
    }
  }
  throw createError(ErrorCode.CC3008, { path: file, expected: "a timeline (defineTimeline/defineScene)" }, { location: { file } });
}

export interface ResolvedScene {
  readonly id: string;
  readonly name: string;
  readonly timeline: Timeline;
  readonly duration: number;
  readonly declaredDuration?: number;
  readonly contentDuration: number;
  readonly overflowingClip?: string;
}

export async function resolveScene(
  scene: { id: string; name?: string; file?: string; duration?: number | string; truncate?: boolean },
  rootDir: string,
  fps: number,
  moduleCache?: Map<string, unknown>,
  entryPath?: string,
): Promise<ResolvedScene> {
  if (!scene.file) {
    throw createError(ErrorCode.CC3008, { path: `scene:${scene.id}`, expected: 'a "file" to load' });
  }
  const manifestDir = entryPath ? resolve(entryPath, "..") : rootDir;
  const resolved = resolve(manifestDir, scene.file);
  const raw = moduleCache?.get(resolved) ?? moduleCache?.get(scene.file) ?? (await loadModuleFile<unknown>(resolved, manifestDir, {}));
  const timeline = await resolveTimelineValue(raw, scene.file, manifestDir);
  const declared = toSeconds(scene.duration, fps) ?? (isSceneDef(raw) ? toSeconds(raw.duration, fps) : undefined);
  const contentInfo = computeTimelineContentDuration(timeline, fps, declared);
  return {
    id: scene.id,
    name: scene.name ?? scene.id,
    timeline,
    duration: declared ?? contentInfo.seconds,
    declaredDuration: declared,
    contentDuration: contentInfo.seconds,
    overflowingClip: contentInfo.overflowingClip,
  };
}

export async function assembleTimelineFromRefs(
  project: ManifestProject,
  entry: { id: string; sceneRefs?: readonly string[]; fps?: number },
): Promise<Timeline> {
  const { manifest, rootDir, config } = project;
  const fps = entry.fps ?? config.video?.fps ?? 30;
  const tracks: AnyTrack[] = [];
  let cursor = 0;
  for (const sceneId of entry.sceneRefs ?? []) {
    const sceneEntry = findEntry(manifest.scenes, sceneId, "scene");
    const scene = await resolveScene(sceneEntry, rootDir, fps, project.moduleCache, project.entryPath);
    const issues = checkDeclaredDuration({
      kind: "scene",
      id: sceneEntry.id,
      declared: scene.declaredDuration,
      content: scene.contentDuration,
      fps,
      truncate: sceneEntry.truncate,
      manifestPath: project.entryPath,
      overflowingClip: scene.overflowingClip,
    });
    if (issues.length > 0) throw issues[0];
    const shifted = shiftTimeline(scene.timeline, cursor);
    tracks.push(...shifted.tracks);
    cursor += scene.duration;
  }
  return makeTimeline(tracks, { name: entry.id, duration: cursor });
}

export async function assembleTimelineComposition(
  project: ManifestProject,
  timelineEntryId: string,
): Promise<Composition> {
  const { config, manifest } = project;
  const entry = findEntry(manifest.timelines, timelineEntryId, "timeline");
  const fps = entry.fps ?? config.video?.fps ?? 30;

  let timeline: Timeline;
  let audioPlacementsFromComp: AudioPlacement[] = [];

  if (entry.file) {
    const manifestDir = resolve(project.entryPath, "..");
    const resolved = resolve(manifestDir, entry.file);
    const raw =
      project.moduleCache?.get(resolved) ??
      project.moduleCache?.get(entry.file) ??
      (await loadModuleFile<unknown>(resolved, manifestDir, {}));

    if (isComposition(raw)) {
      timeline = raw.rootTimeline;
      audioPlacementsFromComp = [...(raw.audioPlacements ?? [])];
    } else {
      timeline = await resolveTimelineValue(raw, entry.file, manifestDir);
    }
  } else {
    timeline = await assembleTimelineFromRefs(project, entry);
  }

  if (entry.audioRef) {
    const seen = new Set<string>();
    for (const ref of entry.audioRef) {
      const lower = ref.toLowerCase();
      if (seen.has(lower)) {
        throw createError(ErrorCode.CC1010, { path: project.entryPath, reason: `duplicate audio reference "${ref}" in timeline "${entry.id}"` });
      }
      seen.add(lower);
    }
  }

  const contentInfo = computeTimelineContentDuration(timeline, fps, toSeconds(entry.duration, fps));
  const geometry = resolveCompositionGeometry({
    entry,
    config,
    contentDuration: contentInfo.seconds,
    manifestPath: project.entryPath,
    kind: "timeline",
    overflowingClip: contentInfo.overflowingClip,
  });

  const audio = await assembleAudioTracks(project, entry.audioRef, geometry.duration || 1);
  const allTracks: AnyTrack[] = [...timeline.tracks, ...audio.tracks];
  const allPlacements: AudioPlacement[] = [...audioPlacementsFromComp, ...audio.placements];

  return makeComposition({
    name: entry.id,
    width: geometry.width,
    height: geometry.height,
    fps: geometry.fps,
    background: geometry.background,
    duration: geometry.duration > 0 ? geometry.duration : undefined,
    contentDuration: geometry.contentDuration,
    audioPlacements: allPlacements,
    audio: {
      sampleRate: config.audio?.sampleRate ?? 48000,
      channels: config.audio?.channels ?? 2,
      masterVolume: config.audio?.masterVolume ?? 1,
    },
    rootTimeline: makeTimeline(allTracks, { name: entry.id, duration: geometry.duration }),
  });
}

export async function composeSceneComposition(
  project: ManifestProject,
  sceneId: string,
): Promise<Composition> {
  const { config, manifest, rootDir } = project;
  const sceneEntry = findEntry(manifest.scenes, sceneId, "scene");
  const fps = sceneEntry.fps ?? config.video?.fps ?? 30;
  const scene = await resolveScene(sceneEntry, rootDir, fps, project.moduleCache, project.entryPath);
  const geometry = resolveCompositionGeometry({
    entry: sceneEntry,
    config,
    contentDuration: scene.contentDuration,
    manifestPath: project.entryPath,
    kind: "scene",
    overflowingClip: scene.overflowingClip,
  });
  return makeComposition({
    name: sceneEntry.id,
    width: geometry.width,
    height: geometry.height,
    fps: geometry.fps,
    background: geometry.background,
    duration: geometry.duration,
    contentDuration: geometry.contentDuration,
    audio: {
      sampleRate: config.audio?.sampleRate ?? 48000,
      channels: config.audio?.channels ?? 2,
      masterVolume: config.audio?.masterVolume ?? 1,
    },
    rootTimeline: scene.timeline,
  });
}

export interface ResolvedImage {
  readonly width: number;
  readonly height: number;
  readonly clips: readonly Clip[];
  readonly background: string;
}

export async function resolveImageClip(
  project: ManifestProject,
  imageId: string,
): Promise<ResolvedImage> {
  const entry = findEntry(project.manifest.images, imageId, "image");
  const scaleFactor = (entry as { scaleFactor?: number }).scaleFactor ?? project.config.images?.scaleFactor ?? 1;
  const width = entry.width ?? project.config.video?.width ?? 1920;
  const height = entry.height ?? project.config.video?.height ?? 1080;

  if (!entry.file) {
    throw createError(ErrorCode.CC3008, { path: `image:${imageId}`, expected: 'a "file" to load' });
  }
  const manifestDir = resolve(project.entryPath, "..");
  const resolved = resolve(manifestDir, entry.file);
  const raw = project.moduleCache?.get(resolved) ?? project.moduleCache?.get(entry.file) ?? (await loadModuleFile<unknown>(resolved, manifestDir, {}));
  const scaledWidth = Math.round(width * scaleFactor);
  const scaledHeight = Math.round(height * scaleFactor);

  let build: Clip | readonly Clip[];
  const context = {
    width: scaledWidth,
    height: scaledHeight,
    baseWidth: width,
    baseHeight: height,
    name: entry.name,
    seed: (entry as { seed?: number }).seed ?? 0,
  };
  if (typeof raw === "object" && raw !== null && (raw as ImageDef).kind === "image") {
    build = (raw as ImageDef).build(context);
  } else if (typeof raw === "function") {
    build = (raw as (ctx: unknown) => Clip | readonly Clip[])(context);
  } else if (raw && typeof raw === "object") {
    build = raw as Clip;
  } else {
    throw createError(ErrorCode.CC3008, { path: entry.file, expected: "an image (defineImage)" }, { location: { file: entry.file } });
  }

  return {
    width: scaledWidth,
    height: scaledHeight,
    clips: Array.isArray(build) ? build : [build as Clip],
    background: (entry as { background?: string }).background ?? project.config.video?.background ?? "#000000",
  };
}

export async function composeImageComposition(
  project: ManifestProject,
  imageId: string,
): Promise<Composition> {
  const { config, manifest } = project;
  const entry = findEntry(manifest.images, imageId, "image");
  const resolved = await resolveImageClip(project, entry.id);
  const fps = config.video?.fps ?? 30;
  const duration = 1 / fps;
  const track = makeTrack(
    "image-track",
    resolved.clips.map((clip) => ({
      ...clip,
      start: 0,
      duration: clip.duration ?? duration,
    })) as VisualClip[],
  );
  const geometry = resolveCompositionGeometry({
    entry,
    config,
    contentDuration: duration,
    manifestPath: project.entryPath,
    kind: "image",
  });
  return makeComposition({
    name: entry.id,
    width: geometry.width,
    height: geometry.height,
    fps: geometry.fps,
    background: geometry.background,
    duration,
    contentDuration: duration,
    rootTimeline: makeTimeline([track], { name: entry.id, duration }),
  });
}

export async function composeAudioComposition(
  project: ManifestProject,
  audioId: string,
): Promise<Composition> {
  const { config, manifest } = project;
  const entry = findEntry(manifest.audio, audioId, "audio");
  const fps = config.video?.fps ?? 30;
  const duration = toSeconds(entry.duration, fps) ?? 1;
  const audio = await assembleAudioTracks(project, [entry.id], duration);
  const geometry = resolveCompositionGeometry({
    entry,
    config,
    contentDuration: duration,
    manifestPath: project.entryPath,
    kind: "audio",
  });
  const sampleRate = (entry.sampleRate ?? config.audio?.sampleRate ?? 48000) as 22050 | 44100 | 48000 | 96000;
  return makeComposition({
    name: entry.id,
    width: 0,
    height: 0,
    fps: geometry.fps,
    background: "#000000",
    duration: geometry.duration,
    contentDuration: duration,
    audioPlacements: audio.placements,
    audio: {
      sampleRate,
      channels: (entry.channels as 1 | 2) ?? config.audio?.channels ?? 2,
      masterVolume: entry.gain ?? config.audio?.masterVolume ?? 1,
    },
    rootTimeline: makeTimeline(audio.tracks, { name: entry.id, duration: geometry.duration }),
  });
}

export async function assembleAudioTracks(
  project: ManifestProject,
  audioRef: readonly string[] | undefined,
  duration: number,
): Promise<{ tracks: AnyTrack[]; placements: AudioPlacement[] }> {
  if (!audioRef || audioRef.length === 0) return { tracks: [], placements: [] };
  const { manifest } = project;
  const clips: AudioClip[] = [];
  const placements: AudioPlacement[] = [];

  for (const audioId of audioRef) {
    const entry = findEntry(manifest.audio, audioId, "audio");
    const gain = entry.gain ?? 1;
    if (typeof gain !== "number" || !Number.isFinite(gain) || gain < 0 || gain > 4) {
      throw createError(ErrorCode.CC1012, { reason: `Audio entry "${audioId}" gain must be between 0 and 4, got ${gain}` });
    }
    placements.push({ id: audioId, start: 0, duration, gain });
    if (entry.src && !entry.file) {
      clips.push({ type: "audio", src: resolveMediaFilePath(entry.src, project.rootDir, project.config), start: 0, duration, volume: gain });
      continue;
    }
    const buffer = await resolveAudioBuffer(project, audioId);
    clips.push({ type: "audio", src: "", buffer, start: 0, duration, volume: gain });
  }

  return {
    tracks: clips.length > 0 ? [makeAudioTrack("timeline-audio", clips)] : [],
    placements,
  };
}
