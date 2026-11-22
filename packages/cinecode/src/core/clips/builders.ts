import type {
  AudioClip,
  Clip,
  DataVizClip,
  EffectRef,
  GradientMeshClip,
  MeshWarpClip,
  SoundClip,
  StickerClip,
  SubtitleClip,
  Text3dClip,
  TransitionRef,
  VisualClip,
} from "../types/clips.js";
import type { AudioTrack, AnyTrack, Timeline, VisualTrack, SubtitleTrack } from "../types/tracks.js";
import { brandDefinition } from "../../manifest/brands.js";
import type { Composition, CompositionProps } from "../types/composition.js";
import type { BlendMode } from "../types/visual.js";
import { type FrameConversion, createConversion, timeInputToFrames } from "../time/convert.js";
import { computeClipSpan } from "../validation/timeline.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { BUILTIN_TRANSITION_NAMES } from "../../transitions/index.js";

function validateBuilderOptions(
  options: Record<string, unknown>,
  validKeys: readonly string[],
  kind: string,
): void {
  for (const key of Object.keys(options)) {
    if (!validKeys.includes(key)) {
      throw createError(ErrorCode.CC1014, {
        kind: `${kind} option`,
        name: key,
        available: validKeys.join(", "),
      });
    }
  }
}

const TRACK_OPTION_KEYS: readonly string[] = ["muted", "opacity", "blend"];
const AUDIO_TRACK_OPTION_KEYS: readonly string[] = ["muted", "volume"];
const SUBTITLE_TRACK_OPTION_KEYS: readonly string[] = ["muted"];
const SEQUENCE_OPTION_KEYS: readonly string[] = ["trackName", "start", "muted", "opacity", "blend"];
const TIMELINE_OPTION_KEYS: readonly string[] = ["name", "speed", "offset", "duration"];
const DATAVIZ_KEYS: readonly string[] = [
  "start", "end", "duration", "name", "transform", "opacity", "blend",
  "chartType", "data", "color", "width", "height", "title",
];
const STICKER_KEYS: readonly string[] = [
  "start", "end", "duration", "name", "transform", "opacity", "blend",
  "emoji", "size", "fit",
];
const GRADIENT_MESH_KEYS: readonly string[] = [
  "start", "end", "duration", "name", "transform", "opacity", "blend",
  "gridCols", "gridRows", "anchors", "width", "height",
];
const TEXT3D_KEYS: readonly string[] = [
  "start", "end", "duration", "name", "transform", "opacity", "blend",
  "text", "fontSize", "depth", "bevel", "color", "material",
];
const MESHWARP_KEYS: readonly string[] = [
  "start", "end", "duration", "name", "transform", "opacity", "blend",
  "src", "cols", "rows", "displacements", "width", "height",
];

export function track(
  name: string,
  clips: readonly VisualClip[],
  options: { readonly muted?: boolean; readonly opacity?: number; readonly blend?: BlendMode } = {},
): VisualTrack {
  validateBuilderOptions(options as Record<string, unknown>, TRACK_OPTION_KEYS, "track");
  if (options.muted !== undefined && typeof options.muted !== "boolean") {
    throw createError(ErrorCode.CC1012, { reason: `Track muted must be a boolean, got ${typeof options.muted}` });
  }
  if (options.opacity !== undefined) {
    if (typeof options.opacity !== "number" || !Number.isFinite(options.opacity) || options.opacity < 0 || options.opacity > 1) {
      throw createError(ErrorCode.CC1012, { reason: `Track opacity must be a number between 0 and 1, got ${options.opacity}` });
    }
  }
  const normalized = Array.isArray(clips)
    ? clips.filter((clip): clip is VisualClip => !!clip && typeof clip === "object" && (clip as Record<string, unknown>).type !== undefined)
    : [];
  const sorted = [...normalized]
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => {
      const startA = a.c.start !== undefined ? (typeof a.c.start === "number" ? a.c.start : parseFloat(String(a.c.start)) || 0) : 0;
      const startB = b.c.start !== undefined ? (typeof b.c.start === "number" ? b.c.start : parseFloat(String(b.c.start)) || 0) : 0;
      return startA - startB || a.idx - b.idx;
    })
    .map((item) => item.c);
  return {
    name,
    kind: "visual",
    clips: sorted as readonly VisualClip[],
    muted: options.muted,
    opacity: options.opacity,
    blend: options.blend,
  };
}

export function audioTrack(
  name: string,
  clips: readonly (AudioClip | SoundClip)[],
  options: { readonly muted?: boolean; readonly volume?: number } = {},
): AudioTrack {
  validateBuilderOptions(options as Record<string, unknown>, AUDIO_TRACK_OPTION_KEYS, "audioTrack");
  return { name, kind: "audio", clips, ...options };
}

export function subtitleTrack(
  name: string,
  clips: readonly SubtitleClip[],
  options: { readonly muted?: boolean } = {},
): SubtitleTrack {
  validateBuilderOptions(options as Record<string, unknown>, SUBTITLE_TRACK_OPTION_KEYS, "subtitleTrack");
  return { name, kind: "subtitle", clips, ...options };
}

export function dataVizClip(props: Omit<DataVizClip, "type">): DataVizClip {
  validateBuilderOptions(props as Record<string, unknown>, DATAVIZ_KEYS, "dataVizClip");
  return { type: "dataViz", ...props };
}

export function stickerClip(emoji: string, size: number, overrides: Partial<StickerClip> = {}): StickerClip {
  validateBuilderOptions(overrides as Record<string, unknown>, STICKER_KEYS, "stickerClip");
  return { type: "sticker", emoji, size, ...overrides };
}

export function gradientMeshClip(
  props: { gridCols: number; gridRows: number; anchors: GradientMeshClip["anchors"] },
  overrides: Partial<GradientMeshClip> = {},
): GradientMeshClip {
  validateBuilderOptions(overrides as Record<string, unknown>, GRADIENT_MESH_KEYS, "gradientMeshClip");
  return { type: "gradient-mesh", ...props, ...overrides };
}

export function text3dClip(props: Omit<Text3dClip, "type">): Text3dClip {
  validateBuilderOptions(props as Record<string, unknown>, TEXT3D_KEYS, "text3dClip");
  return { type: "text3d", ...props };
}

export function meshWarpClip(
  src: string,
  params: { cols: number; rows: number },
  overrides: Partial<MeshWarpClip> = {},
): MeshWarpClip {
  validateBuilderOptions(overrides as Record<string, unknown>, MESHWARP_KEYS, "meshWarpClip");
  return { type: "meshwarp", src, ...params, ...overrides };
}

export interface SequenceOptions {
  readonly trackName?: string;
  readonly start?: number | string;
  readonly muted?: boolean;
  readonly opacity?: number;
  readonly blend?: BlendMode;
}

export function sequence(clips: readonly VisualClip[], options: SequenceOptions = {}): VisualTrack {
  validateBuilderOptions(options as Record<string, unknown>, SEQUENCE_OPTION_KEYS, "sequence");
  let startSeconds = 0;
  if (options.start !== undefined) {
    if (typeof options.start === "number") {
      if (!Number.isFinite(options.start) || options.start < 0) {
        throw createError(ErrorCode.CC1012, { reason: `Sequence start must be non-negative, got ${options.start}` });
      }
      startSeconds = options.start;
    } else if (typeof options.start === "string") {
      const parsed = parseFloat(options.start);
      if (Number.isNaN(parsed) || parsed < 0) {
        throw createError(ErrorCode.CC1012, { reason: `Sequence start must be non-negative, got "${options.start}"` });
      }
      startSeconds = parsed;
    } else {
      throw createError(ErrorCode.CC1012, { reason: `Sequence start must be a number or string, got ${typeof options.start}` });
    }
  }
  if (options.muted !== undefined && typeof options.muted !== "boolean") {
    throw createError(ErrorCode.CC1012, { reason: `Sequence muted must be a boolean, got ${typeof options.muted}` });
  }
  if (options.opacity !== undefined) {
    if (typeof options.opacity !== "number" || !Number.isFinite(options.opacity) || options.opacity < 0 || options.opacity > 1) {
      throw createError(ErrorCode.CC1012, { reason: `Sequence opacity must be a number between 0 and 1, got ${options.opacity}` });
    }
  }

  let cursorSeconds = startSeconds;
  const placed: VisualClip[] = [];
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i]!;
    if (i === 0) {
      // The first clip starts at sequence start; transitionIn does not produce negative start
      placed.push({ ...clip, start: cursorSeconds });
      cursorSeconds += restOf(clip);
    } else {
      const overlap = transitionDuration(clip.transitionIn);
      const clipStart = Math.max(startSeconds, cursorSeconds - overlap);
      placed.push({ ...clip, start: clipStart });
      cursorSeconds = clipStart + restOf(clip);
    }
  }
  return {
    name: options.trackName ?? "sequence",
    kind: "visual",
    clips: placed,
    muted: options.muted,
    opacity: options.opacity,
    blend: options.blend,
  };
}

const DEFAULT_TRANSITION_SECONDS = 0.5;

function transitionDuration(transitionIn: TransitionRef | undefined): number {
  if (transitionIn === undefined) {
    return 0;
  }
  if (typeof transitionIn.duration === "string") {
    return Number.parseFloat(transitionIn.duration) || DEFAULT_TRANSITION_SECONDS;
  }
  if (typeof transitionIn.duration === "number") {
    return transitionIn.duration;
  }
  return DEFAULT_TRANSITION_SECONDS;
}

function restOf(clip: VisualClip): number {
  if (typeof clip.duration === "number") {
    return clip.duration;
  }
  if (typeof clip.duration === "string") {
    const parsed = Number.parseFloat(clip.duration);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  if (typeof clip.start === "number" && typeof clip.end === "number") {
    return Math.max(0, clip.end - clip.start);
  }
  return 1;
}

export interface TimelineOptions {
  name?: string;
  speed?: number;
  offset?: number | string;
  duration?: number | string;
}

export function timeline(...inputs: Array<readonly AnyTrack[] | AnyTrack | Timeline | TimelineOptions>): Timeline {
  const tracks: AnyTrack[] = [];
  let name: string | undefined;
  let speed: number | undefined;
  let offset: number | string | undefined;
  let duration: number | string | undefined;

  for (const input of inputs) {
    if (!input) continue;
    if (Array.isArray(input)) {
      for (const t of input) {
        if (t && typeof t === "object") tracks.push(t as AnyTrack);
      }
      continue;
    }
    if (typeof input === "object") {
      // Check if it's a Timeline with tracks
      if ("tracks" in input && Array.isArray((input as Timeline).tracks)) {
        const t = input as Timeline;
        tracks.push(...t.tracks);
        if (t.name !== undefined && name === undefined) name = t.name;
        if (t.speed !== undefined && speed === undefined) speed = t.speed;
        if (t.offset !== undefined && offset === undefined) offset = t.offset;
        if (t.duration !== undefined && duration === undefined) duration = t.duration;
        continue;
      }
      // Check if it's a single track with clips
      if ("clips" in input && Array.isArray((input as AnyTrack).clips)) {
        tracks.push(input as AnyTrack);
        continue;
      }
      // Otherwise it's TimelineOptions
      validateBuilderOptions(input as Record<string, unknown>, TIMELINE_OPTION_KEYS, "timeline");
      const opts = input as TimelineOptions;
      if (opts.speed !== undefined) {
        if (typeof opts.speed !== "number" || !Number.isFinite(opts.speed) || opts.speed <= 0) {
          throw createError(ErrorCode.CC1012, { reason: `Timeline speed must be a positive number, got ${opts.speed}` });
        }
        speed = opts.speed;
      }
      if (opts.offset !== undefined) {
        if (typeof opts.offset === "number" && (opts.offset < 0 || !Number.isFinite(opts.offset))) {
          throw createError(ErrorCode.CC1012, { reason: `Timeline offset must be non-negative, got ${opts.offset}` });
        }
        offset = opts.offset;
      }
      if (opts.duration !== undefined) {
        if (typeof opts.duration === "number" && (opts.duration <= 0 || !Number.isFinite(opts.duration))) {
          throw createError(ErrorCode.CC1012, { reason: `Timeline duration must be positive, got ${opts.duration}` });
        }
        duration = opts.duration;
      }
      if (opts.name !== undefined) name = opts.name;
    }
  }

  return {
    tracks,
    ...(name !== undefined ? { name } : {}),
    ...(speed !== undefined ? { speed } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(duration !== undefined ? { duration } : {}),
  };
}

export function composition(props: CompositionProps): Composition {
  return brandDefinition(
    { ...props, background: props.background ?? "#000000", audio: props.audio ?? { sampleRate: 48000, channels: 2, masterVolume: 1 } },
    "composition",
  );
}

export function compositionDuration(composition: Composition, conversion: FrameConversion): number {
  if (composition.duration !== undefined) {
    return timeInputToFrames(composition.duration, conversion);
  }
  return rootSpanFrames(composition.rootTimeline, conversion);
}

function rootSpanFrames(root: Timeline, conversion: FrameConversion): number {
  let max = 0;
  for (const track of root.tracks) {
    for (const clip of track.clips) {
      const span = computeClipSpan(clip as Clip, conversion);
      max = Math.max(max, span.endFrames);
    }
  }
  return max === 0 ? 1 : max;
}

export function createCompositionConversion(composition: Composition): FrameConversion {
  return createConversion(composition.fps);
}

export function clipAt(clip: VisualClip, conversion: FrameConversion): { start: number; end: number } {
  const span = computeClipSpan(clip, conversion);
  return { start: span.startFrames, end: span.endFrames };
}

export { type EffectRef };
