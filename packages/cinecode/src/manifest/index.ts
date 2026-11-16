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
} from "../core/types/index.js";
import type { AudioBuffer } from "../audio/types.js";
import type { AudioDef, ImageDef, SceneDef } from "../core/define/definitions.js";
import {
  audioTrack as makeAudioTrack,
  composition as makeComposition,
  timeline as makeTimeline,
  track as makeTrack,
} from "../core/clips/builders.js";
import { createConversion } from "../core/time/index.js";
import { computeClipSpan } from "../core/validation/index.js";
import { loadModuleFile, resolveEntryFile } from "./loader.js";

export interface ManifestProject {
  readonly rootDir: string;
  readonly entryPath: string;
  readonly config: CinecodeConfig;
  readonly manifest: MainManifest;
  readonly hasManifest: boolean;
}

export function normalizeManifest(raw: unknown): MainManifest {
  const manifest = (raw ?? {}) as MainManifest;
  const checkIds = (entries: readonly { id: string }[] | undefined, kind: string): void => {
    if (!entries) return;
    const seen = new Set<string>();
    for (const entry of entries) {
      if (!entry.id) throw new Error(`main.ts: every ${kind} entry requires an "id"`);
      if (seen.has(entry.id)) throw new Error(`main.ts: duplicate ${kind} id "${entry.id}"`);
      seen.add(entry.id);
    }
  };
  checkIds(manifest.images, "image");
  checkIds(manifest.audio, "audio");
  checkIds(manifest.scenes, "scene");
  checkIds(manifest.timelines, "timeline");
  return {
    images: manifest.images ?? [],
    audio: manifest.audio ?? [],
    scenes: manifest.scenes ?? [],
    timelines: manifest.timelines ?? [],
    characters: manifest.characters ?? [],
    motions: manifest.motions ?? [],
  };
}

/**
 * Loads `cinecode.config.ts` + the root manifest (`main.ts`). A missing
 * manifest is not an error — projects may still export a single composition
 * from the config file (legacy flow).
 */
export async function loadManifestProject(
  config: CinecodeConfig,
  rootDir = process.cwd(),
): Promise<ManifestProject> {
  const entry = config.project?.entry ?? "./main.ts";
  const entryPath = resolveEntryFile(entry, rootDir);
  if (!existsSync(entryPath)) {
    return { rootDir, entryPath, config, manifest: normalizeManifest({}), hasManifest: false };
  }
  const raw = await loadModuleFile<MainManifest>(entry, rootDir, { fresh: true });
  return { rootDir, entryPath, config, manifest: normalizeManifest(raw), hasManifest: true };
}

export function findEntry<T extends { id: string }>(
  entries: readonly T[] | undefined,
  id: string,
  kind: string,
): T {
  const found = entries?.find((entry) => entry.id === id);
  if (!found) {
    const available = (entries ?? []).map((entry) => entry.id).join(", ") || "none";
    throw new Error(`Unknown ${kind} "${id}". Registered: ${available}`);
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
  if (typeof value === "number") return value;
  if (value.includes(":")) {
    const [h = 0, m = 0, s = 0, f = 0] = value.split(":").map(Number);
    return h * 3600 + m * 60 + s + f / fps;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

type MaybeComposition = Composition & { readonly rootTimeline: Timeline };

function isComposition(value: unknown): value is MaybeComposition {
  return !!value && typeof value === "object" && "rootTimeline" in (value as object);
}

function isTimeline(value: unknown): value is Timeline {
  return !!value && typeof value === "object" && Array.isArray((value as Timeline).tracks);
}

function isSceneDef(value: unknown): value is SceneDef<unknown> {
  return !!value && typeof value === "object" && (value as SceneDef<unknown>).kind === "scene";
}

async function resolveTimelineValue(raw: unknown, file: string): Promise<Timeline> {
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
  throw new Error(
    `Module "${file}" does not export a timeline (expected defineTimeline/defineScene)`,
  );
}

export interface ResolvedScene {
  readonly id: string;
  readonly name: string;
  readonly timeline: Timeline;
  readonly duration: number;
}

/** Loads a scene entry and resolves it to a duration-bearing timeline. */
export async function resolveScene(
  scene: { id: string; name?: string; file?: string; duration?: number | string },
  rootDir: string,
  fps: number,
): Promise<ResolvedScene> {
  if (!scene.file) {
    throw new Error(`Scene "${scene.id}" has no "file" to load`);
  }
  const raw = await loadModuleFile<unknown>(scene.file, rootDir, { fresh: true });
  const timeline = await resolveTimelineValue(raw, scene.file);
  const explicit =
    toSeconds(scene.duration, fps) ?? (isSceneDef(raw) ? toSeconds(raw.duration, fps) : undefined);
  const duration = explicit ?? timelineDurationSeconds(timeline, fps);
  return { id: scene.id, name: scene.name ?? scene.id, timeline, duration };
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

  const video = config.video;
  const width = entry.width ?? video?.width ?? 1920;
  const height = entry.height ?? video?.height ?? 1080;
  const fps = entry.fps ?? video?.fps ?? 30;
  const background = entry.background ?? video?.background ?? "#000000";

  let timeline: Timeline;
  if (entry.file) {
    const raw = await loadModuleFile<unknown>(entry.file, rootDir, { fresh: true });
    if (isComposition(raw)) {
      return { ...raw, name: raw.name ?? entry.id };
    }
    timeline = await resolveTimelineValue(raw, entry.file);
  } else {
    timeline = await assembleTimelineFromRefs(project, entry);
  }

  const explicitDuration = toSeconds(entry.duration, fps) ?? toSeconds(timeline.duration, fps);
  const resolvedDuration = explicitDuration ?? timelineDurationSeconds(timeline, fps);

  const audioTracks = await assembleAudioTracks(project, entry.audioRef, resolvedDuration || 1);

  const allTracks: AnyTrack[] = [...timeline.tracks, ...audioTracks];

  return makeComposition({
    name: entry.id,
    width,
    height,
    fps,
    background,
    duration: resolvedDuration > 0 ? resolvedDuration : undefined,
    audio: {
      sampleRate: config.audio?.sampleRate ?? 48000,
      channels: config.audio?.channels ?? 2,
      masterVolume: config.audio?.masterVolume ?? 1,
    },
    rootTimeline: makeTimeline(allTracks, { name: entry.id }),
  });
}

async function assembleTimelineFromRefs(
  project: ManifestProject,
  entry: { id: string; sceneRefs?: readonly string[]; fps?: number },
): Promise<Timeline> {
  const { manifest, rootDir, config } = project;
  const fps = entry.fps ?? config.video?.fps ?? 30;
  const tracks: AnyTrack[] = [];
  let cursor = 0;
  for (const sceneId of entry.sceneRefs ?? []) {
    const sceneEntry = findEntry(manifest.scenes, sceneId, "scene");
    const scene = await resolveScene(sceneEntry, rootDir, fps);
    const shifted = shiftTimeline(scene.timeline, cursor);
    tracks.push(...shifted.tracks);
    cursor += scene.duration;
  }
  return makeTimeline(tracks, { name: entry.id, duration: cursor });
}

// ---------------------------------------------------------------------------
// Audio resolution
// ---------------------------------------------------------------------------

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
    const raw = await loadModuleFile<unknown>(entry.file, project.rootDir, { fresh: true });
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
    const decoded = await decodeAudioFile(resolve(project.rootDir, entry.src), {
      cache,
      targetSampleRate: sampleRate,
      targetChannels: channels,
    });
    return decoded.buffer;
  }

  throw new Error(`Audio "${audioId}" has neither "file" nor "src"`);
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
    return renderSoundDef(raw as { generate: (ctx: unknown, params: unknown) => void });
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

function renderSoundDef(def: { generate: (ctx: unknown, params: unknown) => void }): AudioBuffer {
  const sampleRate = 48000;
  const channels = 2;
  const duration = 1;
  const length = Math.round(sampleRate * duration);
  const data = new Float32Array(length * channels);
  const context = {
    sampleRate,
    startSample: 0,
    lengthSamples: length,
    write: (sampleIndex: number, left: number, right: number): void => {
      if (sampleIndex < 0 || sampleIndex >= length) return;
      data[sampleIndex * channels] = left;
      data[sampleIndex * channels + 1] = right;
    },
  };
  def.generate(context, {});
  return { sampleRate, channels, length, data };
}

async function assembleAudioTracks(
  project: ManifestProject,
  audioRef: readonly string[] | undefined,
  duration: number,
): Promise<AnyTrack[]> {
  if (!audioRef || audioRef.length === 0) return [];
  const { manifest } = project;
  const clips: AudioClip[] = [];

  for (const audioId of audioRef) {
    const entry = findEntry(manifest.audio, audioId, "audio");
    const volume = entry.gain ?? 1;
    if (entry.src && !entry.file) {
      clips.push({
        type: "audio",
        src: resolve(project.rootDir, entry.src),
        start: 0,
        duration,
        volume,
      });
      continue;
    }
    const buffer = await resolveAudioBuffer(project, audioId);
    clips.push({ type: "audio", src: "", buffer, start: 0, duration, volume });
  }

  return clips.length > 0 ? [makeAudioTrack("timeline-audio", clips)] : [];
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
  const scene = await resolveScene(sceneEntry, rootDir, fps);
  return makeComposition({
    name: sceneEntry.id,
    width: sceneEntry.width ?? config.video?.width ?? 1920,
    height: sceneEntry.height ?? config.video?.height ?? 1080,
    fps,
    background: sceneEntry.background ?? config.video?.background ?? "#000000",
    duration: scene.duration,
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
    throw new Error(`Image "${imageId}" has no "file" to load`);
  }
  const raw = await loadModuleFile<unknown>(entry.file, project.rootDir, { fresh: true });
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
    throw new Error(`Module "${entry.file}" does not export an image (expected defineImage)`);
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

export { makeTrack, makeTimeline, resolveEntryFile };
