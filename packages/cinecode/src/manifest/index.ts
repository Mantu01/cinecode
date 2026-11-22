import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AnyTrack,
  AudioClip,
  Clip,
  CinecodeConfig,
  Composition,
  MainManifest,
  Timeline,
  AudioPlacement,
} from "../core/types/index.js";
import type { AudioBuffer } from "../audio/types.js";
import type { AudioDef, ImageDef, SceneDef, SoundContext } from "../core/define/definitions.js";
import {
  audioTrack as makeAudioTrack,
  composition as makeComposition,
  timeline as makeTimeline,
  track as makeTrack,
} from "../core/clips/builders.js";
import { createConversion } from "../core/time/index.js";
import { computeClipSpan } from "../core/validation/index.js";
import { loadModuleFile, resolveEntryFile } from "./loader.js";
import { hotReloadEnabled, loadUserModuleNamespace } from "../loader/index.js";
import { assertMainContract, deepFreezeManifest } from "./contract.js";
import { assertDeterministicAuthoredModules } from "./determinism.js";
import { idRule, type ManifestId } from "./ids.js";
import { checkDeclaredDuration } from "./duration.js";
import { createError, ErrorCode } from "../errors/index.js";
import {
  parseAndValidateDuration,
  validateManifestDocument,
  type ManifestValidationOptions,
  type ManifestValidationResult,
} from "./validation.js";
import { resolveCompositionGeometry, applyCompositionGeometry } from "./target.js";

export { defineMain } from "../core/define/definitions.js";
export { deepFreezeManifest } from "./contract.js";
export type { ManifestId } from "./ids.js";
export * from "./target.js";

export interface ManifestProject {
  readonly rootDir: string;
  readonly entryPath: string;
  readonly config: CinecodeConfig;
  readonly manifest: MainManifest;
  readonly hasManifest: boolean;
  readonly rawManifest?: unknown;
  readonly validation?: ManifestValidationResult;
  readonly moduleCache?: Map<string, unknown>;
}

export function normalizeManifest(raw: unknown, manifestPath = "main.ts"): MainManifest {
  const manifest = (raw ?? {}) as MainManifest;
  return deepFreezeManifest({
    images: manifest.images ?? [],
    audio: manifest.audio ?? [],
    scenes: manifest.scenes ?? [],
    timelines: manifest.timelines ?? [],
  });
}

/** Loads the root manifest (`main.ts`); the caller decides whether a missing one is fatal. */
export async function loadManifestProject(
  config: CinecodeConfig,
  rootDir = process.cwd(),
): Promise<ManifestProject> {
  const entry = config.project?.entry ?? "./main.ts";
  const entryPath = resolveEntryFile(entry, rootDir);
  if (!existsSync(entryPath)) {
    return { rootDir, entryPath, config, manifest: normalizeManifest({}, entryPath), hasManifest: false };
  }
  const mod = await loadUserModuleNamespace<Record<string, unknown>>(entry, rootDir, { fresh: hotReloadEnabled() });
  if (!("default" in mod) || mod.default === undefined) {
    throw createError(
      ErrorCode.CC1010,
      {
        path: entryPath,
        reason: "the entry file must default-export defineMain({ images, audio, scenes, timelines }), but it exported a named-only export (no default export)",
      },
      {
        location: { file: entryPath },
        fixHint: "Default-export defineMain({ images, audio, scenes, timelines }).",
      },
    );
  }
  const definition = assertMainContract(mod.default, entryPath);
  assertDeterministicAuthoredModules(definition, entryPath, rootDir);
  return {
    rootDir,
    entryPath,
    config,
    manifest: normalizeManifest(definition, entryPath),
    hasManifest: true,
    rawManifest: definition,
  };
}

export function assertSelectorId(kind: string, id: string): ManifestId {
  const rule = idRule(id);
  if (rule) throw createError(ErrorCode.CC1012, { reason: `Invalid ${kind} id "${id}": ${rule}` });
  return id as ManifestId;
}

export function findEntry<T extends { id: string }>(
  entries: readonly T[] | undefined,
  id: string,
  kind: string,
): T {
  assertSelectorId(kind, id);
  const targetKey = id.toLowerCase();
  const found = entries?.find((entry) => entry.id.toLowerCase() === targetKey);
  if (!found) {
    const available = (entries ?? []).map((entry) => entry.id).join(", ") || "none";
    throw createError(ErrorCode.CC3007, { kind, id, available });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Duration helpers
// ---------------------------------------------------------------------------

export function timelineDurationSeconds(timeline: Timeline, fps: number): number {
  const conversion = createConversion(fps);
  let maxFrames = 0;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const span = computeClipSpan(clip as never, conversion);
      if (span.endFrames > maxFrames) maxFrames = span.endFrames;
    }
  }
  return maxFrames > 0 ? maxFrames / fps : 0;
}

export function toSeconds(
  value: number | string | undefined,
  fps: number = 30,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseAndValidateDuration(value, fps);
  return parsed.valid ? parsed.seconds : undefined;
}

/** Shifts every clip in a timeline forward by `offsetSeconds`. */
export function shiftTimeline(timeline: Timeline, offsetSeconds: number): Timeline {
  if (offsetSeconds === 0) return timeline;
  const tracks = timeline.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      const start = typeof clip.start === "number" ? clip.start : 0;
      return { ...clip, start: start + offsetSeconds };
    }),
  })) as readonly AnyTrack[];
  return { ...timeline, tracks };
}

// ---------------------------------------------------------------------------
// Scene / timeline resolution
// ---------------------------------------------------------------------------

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

export async function resolveTimelineValue(raw: unknown, file: string): Promise<Timeline> {
  if (isComposition(raw)) return raw.rootTimeline;
  if (isTimeline(raw)) return raw;
  if (isSceneDef(raw)) return raw.build(undefined as never);
  if (typeof raw === "function") {
    const result = (raw as (props: unknown) => unknown)(undefined);
    if (isTimeline(result)) return result;
    if (isComposition(result)) return result.rootTimeline;
    if (Array.isArray(result)) {
      const clips = result.filter(
        (item): item is object => !!item && typeof item === "object",
      ) as readonly object[];
      return makeTimeline(
        clips.map((clip, i) => makeTrack(`default-${i}`, clip as never)),
        { name: `scene-${file}`, duration: 1 },
      );
    }
  }
  throw createError(
    ErrorCode.CC3008,
    { path: file, expected: "a timeline (defineTimeline/defineScene)" },
    { location: { file } },
  );
}

export interface ResolvedScene {
  readonly id: string;
  readonly name: string;
  readonly timeline: Timeline;
  readonly duration: number;
  readonly declaredDuration?: number;
  readonly contentDuration: number;
}

/** Loads a scene entry and resolves it to a duration-bearing timeline. */
export async function resolveScene(
  scene: { id: string; name?: string; file?: string; duration?: number | string },
  rootDir: string,
  fps: number,
  moduleCache?: Map<string, unknown>,
): Promise<ResolvedScene> {
  if (!scene.file) {
    throw createError(ErrorCode.CC3008, { path: `scene:${scene.id}`, expected: 'a "file" to load' });
  }
  const resolved = resolveEntryFile(scene.file, rootDir);
  const raw = moduleCache?.get(resolved) ?? moduleCache?.get(scene.file) ?? await loadModuleFile<unknown>(scene.file, rootDir, { fresh: hotReloadEnabled() });
  const timeline = await resolveTimelineValue(raw, scene.file);
  const declared =
    toSeconds(scene.duration, fps) ?? (isSceneDef(raw) ? toSeconds(raw.duration, fps) : undefined);
  const content = timelineDurationSeconds(timeline, fps);
  return {
    id: scene.id,
    name: scene.name ?? scene.id,
    timeline,
    duration: declared ?? content,
    declaredDuration: declared,
    contentDuration: content,
  };
}

// ---------------------------------------------------------------------------
// Composition assembly
// ---------------------------------------------------------------------------

export interface AssembleOptions {
  readonly timelineId: string;
  readonly rootDir?: string;
}

/**
 * Builds a renderable `Composition` for a timeline entry by resolving its
 * referenced scenes + audio. If the timeline declares a `file`, that file is
 * the source of truth; otherwise the timeline is assembled from `sceneRefs`.
 */
export async function assembleTimelineComposition(
  project: ManifestProject,
  timelineEntryId: string,
): Promise<Composition> {
  const { config, manifest, rootDir } = project;
  const entry = findEntry(manifest.timelines, timelineEntryId, "timeline");

  const fps = entry.fps ?? config.video?.fps ?? 30;
  let timeline: Timeline;
  if (entry.file) {
    const resolved = resolveEntryFile(entry.file, rootDir);
    const raw = project.moduleCache?.get(resolved) ?? project.moduleCache?.get(entry.file) ?? await loadModuleFile<unknown>(entry.file, rootDir, { fresh: hotReloadEnabled() });
    if (isComposition(raw)) {
      const geometry = resolveCompositionGeometry({
        entry,
        config,
        manifestPath: project.entryPath,
        rawComposition: raw,
        kind: "timeline",
      });
      return applyCompositionGeometry(raw, geometry, entry.id);
    }
    timeline = await resolveTimelineValue(raw, entry.file);
  } else {
    timeline = await assembleTimelineFromRefs(project, entry);
  }

  const contentDuration = timelineDurationSeconds(timeline, fps);
  const geometry = resolveCompositionGeometry({
    entry,
    config,
    contentDuration,
    manifestPath: project.entryPath,
    kind: "timeline",
  });

  const audio = await assembleAudioTracks(project, entry.audioRef, geometry.duration || 1);
  const allTracks: AnyTrack[] = [...timeline.tracks, ...audio.tracks];

  return makeComposition({
    name: entry.id,
    width: geometry.width,
    height: geometry.height,
    fps: geometry.fps,
    background: geometry.background,
    duration: geometry.duration > 0 ? geometry.duration : undefined,
    contentDuration: geometry.contentDuration,
    audioPlacements: audio.placements,
    audio: {
      sampleRate: config.audio?.sampleRate ?? 48000,
      channels: config.audio?.channels ?? 2,
      masterVolume: config.audio?.masterVolume ?? 1,
    },
    rootTimeline: makeTimeline(allTracks, { name: entry.id, duration: geometry.duration }),
  });
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
    const scene = await resolveScene(sceneEntry, rootDir, fps, project.moduleCache);
    const issues = checkDeclaredDuration({
      kind: "scene",
      id: sceneEntry.id,
      declared: scene.declaredDuration,
      content: scene.contentDuration,
      fps,
      truncate: sceneEntry.truncate,
      manifestPath: project.entryPath,
    });
    if (issues.length > 0) throw issues[0];
    const shifted = shiftTimeline(scene.timeline, cursor);
    tracks.push(...shifted.tracks);
    cursor += scene.duration;
  }
  return makeTimeline(tracks, { name: entry.id, duration: cursor });
}

// ---------------------------------------------------------------------------
// Audio resolution
// ---------------------------------------------------------------------------

import { resolveMediaFilePath } from "../media/paths.js";
export { resolveMediaFilePath };

export async function resolveAudioBuffer(
  project: ManifestProject,
  audioId: string,
): Promise<AudioBuffer> {
  const entry = findEntry(project.manifest.audio, audioId, "audio");
  const sampleRate = entry.sampleRate ?? project.config.audio?.sampleRate ?? 48000;
  const channels = (entry.channels ?? project.config.audio?.channels ?? 2) as 1 | 2;
  const gain = entry.gain ?? 1;
  const fps = project.config.video?.fps ?? 30;
  const duration =
    toSeconds(entry.duration, fps) ?? toSeconds(project.config.video?.defaultDuration, fps) ?? 5;

  if (entry.file) {
    const resolved = resolveEntryFile(entry.file, project.rootDir);
    const raw = project.moduleCache?.get(resolved) ?? project.moduleCache?.get(entry.file) ?? await loadModuleFile<unknown>(entry.file, project.rootDir, { fresh: hotReloadEnabled() });
    const built = await evaluateAudio(raw, {
      sampleRate,
      channels,
      duration,
      gain,
      seed: 0,
      id: entry.id,
    });
    if (built) return built;
  }

  if (entry.src) {
    const { decodeAudioFile } = await import("../audio/decode.js");
    const { createMediaCache } = await import("../media/cache.js");
    const cache = createMediaCache(
      resolve(project.rootDir, project.config.cacheDir ?? ".cinecode/cache", "media"),
    );
    await cache.initialize();
    const mediaPath = resolveMediaFilePath(entry.src, project.rootDir, project.config);
    const decoded = await decodeAudioFile(mediaPath, {
      cache,
      targetSampleRate: sampleRate,
      targetChannels: channels,
    });
    return decoded.buffer;
  }

  throw createError(ErrorCode.CC3008, { path: `audio:${audioId}`, expected: '"file" or "src"' });
}

async function evaluateAudio(
  raw: unknown,
  context: {
    sampleRate: number;
    channels: 1 | 2;
    duration: number;
    gain: number;
    seed: number;
    id: string;
  },
): Promise<AudioBuffer | null> {
  if (!raw) return null;
  if (isAudioBuffer(raw)) return raw;
  if (typeof raw === "object" && (raw as AudioDef).kind === "audio") {
    return await (raw as AudioDef).build(context);
  }
  if (typeof raw === "function") {
    return (await (raw as (ctx: unknown) => unknown)(context)) as AudioBuffer;
  }
  if (typeof raw === "object" && (raw as { kind?: string }).kind === "sound") {
    return renderSoundDef(
      raw as { name?: string; duration?: number; generate: (ctx: SoundContext, params: unknown) => void },
      context,
    );
  }
  return null;
}

function isAudioBuffer(value: unknown): value is AudioBuffer {
  return (
    !!value &&
    typeof value === "object" &&
    "data" in (value as object) &&
    "sampleRate" in (value as object)
  );
}

function renderSoundDef(
  def: { name?: string; duration?: number; generate: (ctx: SoundContext, params: unknown) => void },
  context: {
    sampleRate: number;
    channels: 1 | 2;
    duration: number;
    gain: number;
    seed: number;
    id: string;
  },
): AudioBuffer {
  const { sampleRate, channels, duration, gain, seed, id } = context;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw createError(ErrorCode.CC5002, {
      name: def.name ?? id,
      reason: `duration must be a positive number, got ${duration}`,
    });
  }
  if (def.duration !== undefined && Math.abs(def.duration - duration) > 0.001) {
    throw createError(ErrorCode.CC5002, {
      name: def.name ?? id,
      reason: `sound definition declared duration ${def.duration}s cannot match requested duration ${duration}s`,
    });
  }
  const length = Math.round(sampleRate * duration);
  const data = new Float32Array(length * channels);
  const soundContext: SoundContext = {
    sampleRate,
    channels,
    duration,
    gain,
    seed,
    id,
    startSample: 0,
    lengthSamples: length,
    write: (sampleIndex: number, left: number, right?: number): void => {
      if (sampleIndex < 0 || sampleIndex >= length) return;
      if (channels === 1) {
        data[sampleIndex] = left * gain;
      } else {
        data[sampleIndex * 2] = left * gain;
        data[sampleIndex * 2 + 1] = (right ?? left) * gain;
      }
    },
  };
  try {
    def.generate(soundContext, {});
  } catch (error) {
    throw createError(
      ErrorCode.CC5002,
      {
        name: def.name ?? id,
        reason: error instanceof Error ? error.message : String(error),
      },
      { cause: error },
    );
  }
  return { sampleRate, channels, length, data };
}

/** Every registered bed starts at 0 and spans the timeline; the report proves it. */
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
      throw createError(ErrorCode.CC1012, {
        reason: `Audio entry "${audioId}" gain must be between 0 and 4, got ${gain}`,
      });
    }
    placements.push({ id: audioId, start: 0, duration, gain });
    if (entry.src && !entry.file) {
      clips.push({
        type: "audio",
        src: resolveMediaFilePath(entry.src, project.rootDir, project.config),
        start: 0,
        duration,
        volume: gain,
      });
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

// ---------------------------------------------------------------------------
// Single-scene composition (used by `generate scene` and the dev server)
// ---------------------------------------------------------------------------

export async function composeSceneComposition(
  project: ManifestProject,
  sceneId: string,
): Promise<Composition> {
  const { config, manifest, rootDir } = project;
  const sceneEntry = findEntry(manifest.scenes, sceneId, "scene");
  const fps = sceneEntry.fps ?? config.video?.fps ?? 30;
  const scene = await resolveScene(sceneEntry, rootDir, fps, project.moduleCache);
  const geometry = resolveCompositionGeometry({
    entry: sceneEntry,
    config,
    contentDuration: scene.contentDuration,
    manifestPath: project.entryPath,
    kind: "scene",
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

// ---------------------------------------------------------------------------
// Image resolution
// ---------------------------------------------------------------------------

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
  const scaleFactor =
    (entry as { scaleFactor?: number }).scaleFactor ?? project.config.images?.scaleFactor ?? 1;
  const width = entry.width ?? project.config.video?.width ?? 1920;
  const height = entry.height ?? project.config.video?.height ?? 1080;

  if (!entry.file) {
    throw createError(ErrorCode.CC3008, { path: `image:${imageId}`, expected: 'a "file" to load' });
  }
  const resolved = resolveEntryFile(entry.file, project.rootDir);
  const raw = project.moduleCache?.get(resolved) ?? project.moduleCache?.get(entry.file) ?? await loadModuleFile<unknown>(entry.file, project.rootDir, { fresh: hotReloadEnabled() });
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
    throw createError(
      ErrorCode.CC3008,
      { path: entry.file, expected: "an image (defineImage)" },
      { location: { file: entry.file } },
    );
  }

  return {
    width: scaledWidth,
    height: scaledHeight,
    clips: Array.isArray(build) ? build : [build as Clip],
    background:
      (entry as { background?: string }).background ??
      project.config.video?.background ??
      "#000000",
  };
}

export { makeTrack, makeTimeline, resolveEntryFile, validateManifestDocument, parseAndValidateDuration };
export type { ManifestValidationResult, ManifestValidationOptions };
