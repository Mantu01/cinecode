import type { AudioClip, SoundClip, TtsClip, VisualClip, Clip, SubtitleClip } from "./clips.js";
import type { BlendMode } from "./visual.js";

export type TrackKind = "visual" | "audio" | "subtitle";

export interface TrackProps {
  readonly name?: string;
  readonly muted?: boolean;
  readonly opacity?: number;
  readonly blend?: BlendMode;
  readonly volume?: number;
}

export interface VisualTrack extends TrackProps {
  readonly kind?: "visual";
  readonly clips: readonly VisualClip[];
}

export interface AudioTrack extends TrackProps {
  readonly kind: "audio";
  readonly clips: readonly (AudioClip | SoundClip | TtsClip)[];
}

export type SubtitleTrackKind = "subtitle";

export interface SubtitleTrack extends TrackProps {
  readonly kind: SubtitleTrackKind;
  readonly clips: readonly SubtitleClip[];
}

export type AnyTrack = VisualTrack | AudioTrack | SubtitleTrack;

export interface TimelineClipSource {
  readonly [key: string]: unknown;
}

export interface Timeline {
  readonly name?: string;
  readonly tracks: readonly AnyTrack[];
  readonly offset?: number | string;
  readonly speed?: number;
  readonly duration?: number | string;
}

export type TimelineClip = VisualClip | AudioClip | SoundClip | TtsClip;

export function trackKindOf(track: AnyTrack): TrackKind {
  return (track.kind ?? "visual") as TrackKind;
}

export function isAudioTrack(track: AnyTrack): track is AudioTrack {
  return trackKindOf(track) === "audio";
}

export function isSubtitleTrack(track: AnyTrack): track is SubtitleTrack {
  return trackKindOf(track) === "subtitle";
}

export function allClips(timeline: Timeline): readonly TimelineClip[] {
  return timeline.tracks.flatMap((track) => track.clips as readonly TimelineClip[]);
}
