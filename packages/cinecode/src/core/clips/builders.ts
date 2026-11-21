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

export function track(name: string, clips: readonly VisualClip[], options: { readonly muted?: boolean; readonly opacity?: number; readonly blend?: BlendMode } = {}): VisualTrack {
  const normalized = Array.isArray(clips)
    ? clips.filter((clip): clip is VisualClip => !!clip && typeof clip === "object" && (clip as Record<string, unknown>).type !== undefined)
    : [];
  return { name, clips: normalized as readonly VisualClip[] };
}

export function audioTrack(name: string, clips: readonly (AudioClip | SoundClip)[], options: { readonly muted?: boolean } = {}): AudioTrack {
  return { name, kind: "audio", clips, ...options };
}

export function subtitleTrack(name: string, clips: readonly SubtitleClip[]): SubtitleTrack {
  return { name, kind: "subtitle", clips };
}

export function dataVizClip(props: Omit<DataVizClip, "type">): DataVizClip {
  return { type: "dataViz", ...props };
}

export function stickerClip(emoji: string, size: number, overrides: Partial<StickerClip> = {}): StickerClip {
  return { type: "sticker", emoji, size, ...overrides };
}

export function gradientMeshClip(
  props: { gridCols: number; gridRows: number; anchors: GradientMeshClip["anchors"] },
  overrides: Partial<GradientMeshClip> = {},
): GradientMeshClip {
  return { type: "gradient-mesh", ...props, ...overrides };
}

export function text3dClip(props: Omit<Text3dClip, "type">): Text3dClip {
  return { type: "text3d", ...props };
}

export function meshWarpClip(
  src: string,
  params: { cols: number; rows: number },
  overrides: Partial<MeshWarpClip> = {},
): MeshWarpClip {
  return { type: "meshwarp", src, ...params, ...overrides };
}

export interface SequenceOptions {
  readonly trackName?: string;
  readonly start?: number | string;
}

export function sequence(clips: readonly VisualClip[], options: SequenceOptions = {}): VisualTrack {
  let cursorSeconds = 0;
  const placed: VisualClip[] = [];
  const startFrames = options.start === undefined ? 0 : undefined;
  void startFrames;
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i]!;
    const transitionDurationSeconds = transitionDuration(clip.transitionIn);
    cursorSeconds -= transitionDurationSeconds;
    placed.push({ ...clip, start: cursorSeconds });
    const rest = restOf(clip);
    cursorSeconds += rest;
  }
  return { name: options.trackName ?? "sequence", clips: placed };
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
  if (typeof clip.start === "number" && typeof clip.end === "number") {
    return clip.end - clip.start;
  }
  return 1;
}

export interface TimelineOptions {
  name?: string;
  speed?: number;
  offset?: number | string;
  duration?: number | string;
}

export function timeline(...inputs: Array<readonly AnyTrack[] | AnyTrack | TimelineOptions>): Timeline {
  const tracks: AnyTrack[] = [];
  const options: TimelineOptions = {};

  for (const input of inputs) {
    if (!input) continue;
    if (Array.isArray(input)) {
      for (const t of input) {
        if (t && typeof t === "object") tracks.push(t as AnyTrack);
      }
      continue;
    }
    if (typeof input === "object" && "tracks" in input && Array.isArray((input as any).tracks)) {
      for (const t of (input as any).tracks) {
        if (t && typeof t === "object") tracks.push(t as AnyTrack);
      }
    } else if (typeof input === "object" && "name" in input) {
      options.name = (input as any).name;
      if ((input as any).speed !== undefined) options.speed = (input as any).speed as number;
      if ((input as any).offset !== undefined) options.offset = (input as any).offset as number | string;
      if ((input as any).duration !== undefined) options.duration = (input as any).duration as number | string;
    }
  }

  return { tracks: tracks as readonly AnyTrack[], ...options };
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
