import type { Clip } from "../types/clips.js";
import type { Timeline } from "../types/tracks.js";
import { AUTHORING_CODES, authoringIssue, type ValidationIssue } from "../validation/errors.js";
import { type FrameConversion, timeInputToFrames } from "./convert.js";
import { framesToSeconds } from "./timebase.js";

export type BoundaryBehavior = "clamp" | "extend" | "strict";

export interface TimelineBoundaryOptions {
  readonly durationFrames: number;
  readonly conversion: FrameConversion;
  readonly behavior?: BoundaryBehavior;
  readonly position?: { file: string; line: number; column: number };
}

export interface ClampedClipNotice {
  readonly clipName: string;
  readonly trackName?: string;
  readonly startFrames: number;
  readonly originalEndFrames: number;
  readonly clampedEndFrames: number;
}

export interface SanitizedTimeline {
  readonly timeline: Timeline;
  readonly totalFrames: number;
  readonly behavior: BoundaryBehavior;
  readonly clamped: readonly ClampedClipNotice[];
  readonly sanitized: readonly { readonly clipName: string; readonly reason: string }[];
  readonly issues: readonly ValidationIssue[];
  readonly notices: readonly string[];
}

function clipDisplayName(clip: Clip): string {
  const named = clip as { name?: string; type?: string };
  return named.name ?? named.type ?? "clip";
}

function readClipStartFrames(clip: Clip, conversion: FrameConversion): number {
  return clip.start === undefined ? 0 : timeInputToFrames(clip.start, conversion);
}

function readClipEndFrames(clip: Clip, conversion: FrameConversion): number {
  const start = readClipStartFrames(clip, conversion);
  if (clip.end !== undefined) return timeInputToFrames(clip.end, conversion);
  if (clip.duration !== undefined) return start + timeInputToFrames(clip.duration, conversion);
  return start + 1;
}

export function sanitizeClipTiming(
  clip: Clip,
  conversion: FrameConversion,
): { readonly clip: Clip; readonly changed: boolean; readonly reason?: string } {
  const startFrames = readClipStartFrames(clip, conversion);
  const endFrames = readClipEndFrames(clip, conversion);
  const negativeStart = startFrames < 0;
  const zeroDuration = endFrames <= Math.max(0, startFrames);

  if (!negativeStart && !zeroDuration) return { clip, changed: false };

  const normalizedStart = negativeStart ? 0 : startFrames;
  const normalizedEnd = zeroDuration ? Math.max(1, normalizedStart + 1) : endFrames;
  const durationSeconds = framesToSeconds(normalizedEnd - normalizedStart, conversion);
  const next = {
    ...clip,
    start: framesToSeconds(normalizedStart, conversion),
    duration: durationSeconds,
    end: undefined,
  } as Clip;
  const reason = negativeStart
    ? "negative start offset"
    : "zero or negative duration";
  return { clip: next, changed: true, reason };
}

export function applyBoundaryBehavior(
  timeline: Timeline,
  options: TimelineBoundaryOptions,
): SanitizedTimeline {
  const behavior = options.behavior ?? "clamp";
  const conversion = options.conversion;
  const limit = Math.max(0, options.durationFrames);
  const clamped: ClampedClipNotice[] = [];
  const sanitized: { clipName: string; reason: string }[] = [];
  const issues: ValidationIssue[] = [];
  const notices: string[] = [];
  let furthestEnd = limit;

  const tracks = timeline.tracks.map((track) => {
    const clips = track.clips.map((clip) => {
      const cleaned = sanitizeClipTiming(clip as Clip, conversion);
      const candidate = cleaned.clip;
      if (cleaned.changed) {
        sanitized.push({ clipName: clipDisplayName(candidate), reason: cleaned.reason ?? "invalid timing" });
      }
      const startFrames = readClipStartFrames(candidate, conversion);
      const endFrames = readClipEndFrames(candidate, conversion);
      if (endFrames > furthestEnd) furthestEnd = endFrames;
      if (limit > 0 && endFrames > limit) {
        const name = clipDisplayName(candidate);
        if (behavior === "strict") {
          issues.push(
            authoringIssue(
              AUTHORING_CODES.timelineOvershoot,
              `Clip "${name}" ends at frame ${endFrames}, ${endFrames - limit} frame(s) past the composition boundary (${limit})`,
              { clipName: name, trackName: track.name, position: options.position },
            ),
          );
          return candidate;
        }
        if (behavior === "clamp") {
          const clampedEnd = Math.max(startFrames + 1, limit);
          const durationSeconds = framesToSeconds(clampedEnd - startFrames, conversion);
          clamped.push({
            clipName: name,
            trackName: track.name,
            startFrames,
            originalEndFrames: endFrames,
            clampedEndFrames: clampedEnd,
          });
          notices.push(
            `[CC1004] clip "${name}" overshoots the composition boundary by ${endFrames - limit} frame(s); clamped to ${clampedEnd}`,
          );
          return { ...candidate, start: framesToSeconds(startFrames, conversion), duration: durationSeconds, end: undefined } as Clip;
        }
      }
      return candidate;
    });
    return { ...track, clips } as typeof track;
  });

  const totalFrames = behavior === "extend" ? Math.max(limit, furthestEnd) : limit;
  if (behavior === "extend" && furthestEnd > limit) {
    notices.push(`[CC1004] composition extended by ${furthestEnd - limit} frame(s) to cover oversized clips`);
  }

  return {
    timeline: { ...timeline, tracks },
    totalFrames,
    behavior,
    clamped,
    sanitized,
    issues,
    notices,
  };
}

export function findTimelineOvershoots(
  timeline: Timeline,
  conversion: FrameConversion,
  durationFrames: number,
): readonly { readonly clipName: string; readonly trackName?: string; readonly overshootFrames: number }[] {
  const overshoots: { clipName: string; trackName?: string; overshootFrames: number }[] = [];
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const endFrames = readClipEndFrames(clip as Clip, conversion);
      if (endFrames <= durationFrames) continue;
      overshoots.push({
        clipName: clipDisplayName(clip as Clip),
        trackName: track.name,
        overshootFrames: endFrames - durationFrames,
      });
    }
  }
  return overshoots;
}
