import type { CinecodeConfig } from "../types/config.js";
import type { Timeline } from "../types/tracks.js";
import type { TrackKind } from "../types/tracks.js";
import type { Clip } from "../types/clips.js";
import type { MainManifest } from "../types/manifest.js";
import type { AudioBuffer } from "../../audio/types.js";
import type { InferredCinecodeConfig } from "../../config/zod-schema.js";
import { validateAuthoringConfig, assertNotCompositionExport } from "../../config/validator.js";
import { markMainDefinition, validateMainDefinition, deepFreezeManifest } from "../../manifest/contract.js";
import { brandDefinition } from "../../manifest/brands.js";

export interface TimelineFactory<P> {
  readonly props?: P;
  readonly build: (props: P) => Timeline;
}

export type TimelineDef<P> = (props: P) => Timeline;

/**
 * Creates a timeline definition that builds a Timeline from optional props.
 *
 * `timelines[].sceneRefs` sequences scenes back to back in array order with no
 * implicit overlap; build cross-scene transitions inside one scene.
 *
 * @param build - Function that constructs the timeline from props
 * @returns A TimelineDef that can be registered in main.ts
 */
export function defineTimeline<P = Record<string, never>>(
  build: (props: P) => Timeline,
): TimelineDef<P> {
  return brandDefinition(build, "timeline");
}

/**
 * Creates a no-props timeline definition for simple timelines.
 *
 * @param build - Function that builds the timeline without props
 * @returns A timeline builder with no parameters
 */
export function defineTimelineNoProps(build: () => Timeline): () => Timeline {
  return brandDefinition(build, "timeline");
}

export interface SceneDef<P> extends TimelineFactory<P> {
  readonly kind: "scene";
  readonly name: string;
  readonly duration: number | string;
}

/**
 * Creates a scene definition — a named timeline with fixed duration.
 *
 * Scenes referenced by a timeline play back-to-back in `sceneRefs` order with
 * no implicit overlap. `duration` must equal the built timeline's content;
 * a mismatch of more than one frame is a validation error.
 *
 * @param name - Scene name identifier
 * @param duration - Scene duration in seconds or time string
 * @param build - Function to build the scene's timeline
 * @returns A SceneDef that can be placed in main.ts scenes array
 */
export function defineScene<P>(
  name: string,
  duration: number | string,
  build: (props: P) => Timeline,
): SceneDef<P> {
  return brandDefinition({ kind: "scene", name, duration, build }, "scene");
}

export interface ComponentDef<P> {
  readonly kind: "component";
  readonly name: string;
  readonly build: (props: P) => Timeline;
}

/**
 * Creates a reusable component definition.
 *
 * @param name - Component identifier
 * @param build - Function that builds a timeline from props
 * @returns A ComponentDef for use in timelines
 */
export function defineComponent<P = any>(name: string, build: (props: P) => Timeline): ComponentDef<P> {
  return { kind: "component", name, build };
}

export interface SoundDef<P> {
  readonly kind: "sound";
  readonly name: string;
  readonly duration?: number;
  readonly generate: (context: SoundContext, params: P) => void;
}

export interface SoundContext {
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly duration: number;
  readonly gain: number;
  readonly seed: number;
  readonly id: string;
  readonly startSample: number;
  readonly lengthSamples: number;
  readonly write: (sampleIndex: number, left: number, right?: number) => void;
}

/**
 * Creates a sound definition for procedural audio generation.
 *
 * @param name - Sound identifier
 * @param generate - Function to generate audio samples
 * @param options - Optional sound definition options
 * @returns A SoundDef for use in audio tracks
 */
export function defineSound<P = Record<string, unknown>>(
  name: string,
  generate: (context: SoundContext, params: P) => void,
  options?: { duration?: number },
): SoundDef<P> {
  return { kind: "sound", name, duration: options?.duration, generate };
}

/**
 * Type-safe helper for cinecode.config.ts. Validates authoring options at definition time.
 */
export function defineConfig(config: InferredCinecodeConfig): InferredCinecodeConfig {
  assertNotCompositionExport(config);
  const { errors } = validateAuthoringConfig(config);
  if (errors.length > 0) throw errors[0];
  return config;
}

export function trackKind(value: "visual" | "audio"): TrackKind {
  return value;
}

// ---------------------------------------------------------------------------
// Image generation (Section 4 of the modernization plan)
// ---------------------------------------------------------------------------

export interface ImageBuildContext {
  /** Image width in pixels (already scaled by `scaleFactor`). */
  readonly width: number;
  readonly height: number;
  /** Base width before retina scaling. */
  readonly baseWidth: number;
  /** Base height before retina scaling. */
  readonly baseHeight: number;
  readonly name?: string;
  readonly seed: number;
}

export type ImageFactory = (context: ImageBuildContext) => Clip | readonly Clip[];

export interface ImageDef {
  readonly kind: "image";
  readonly build: ImageFactory;
}

/** Declares a standalone still image. No timeline or muxer required. */
export function defineImage(build: ImageFactory): ImageDef {
  return brandDefinition({ kind: "image", build }, "image");
}

// ---------------------------------------------------------------------------
// Audio generation
// ---------------------------------------------------------------------------

export interface AudioBuildContext {
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly duration: number;
  readonly gain: number;
  readonly seed: number;
  readonly id: string;
}

export type AudioFactory = (context: AudioBuildContext) => AudioBuffer | Promise<AudioBuffer>;

export interface AudioDef {
  readonly kind: "audio";
  readonly build: AudioFactory;
}

/** Declares a standalone audio generator producing an `AudioBuffer`. */
export function defineAudio(build: AudioFactory): AudioDef {
  return brandDefinition({ kind: "audio", build }, "audio");
}

// ---------------------------------------------------------------------------
// Root manifest
// ---------------------------------------------------------------------------

export interface MainDef extends MainManifest {
  readonly kind: "main";
}

/**
 * Declares the root manifest (`main.ts`). Arrays are normalized to empty.
 *
 * @param manifest - The main manifest object containing all entries
 * @returns A MainDef wrapping the manifest
 */
export function defineMain(manifest: MainManifest): MainDef {
  validateMainDefinition(manifest);
  const def: MainDef = {
    kind: "main",
    images: manifest.images ?? [],
    audio: manifest.audio ?? [],
    scenes: manifest.scenes ?? [],
    timelines: manifest.timelines ?? [],
  };
  deepFreezeManifest(def);
  return markMainDefinition(def);
}
