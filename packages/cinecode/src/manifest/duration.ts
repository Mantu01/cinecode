import { resolve } from "node:path";
import type { Timeline, Clip, ManifestEntryBase } from "../core/types/index.js";
import { clipName } from "../core/types/clips.js";
import { parseDurationInput } from "../core/time-input.js";
import { createConversion, secondsToFrames, timeInputToFrames, type FrameConversion } from "../core/time/convert.js";
import { createError, ErrorCode, type CinecodeError } from "../errors/index.js";
import { recordDegradation, recordNote } from "../errors/degradations.js";

export type DurationStatus = "equal" | "padded" | "truncating" | "overflowing";

export interface DurationComparison {
  readonly status: DurationStatus;
  readonly declared: number;
  readonly content: number;
  readonly declaredFrames: number;
  readonly contentFrames: number;
  readonly deltaFrames: number;
  readonly droppedFrames: number;
  readonly extraFrames: number;
  readonly overflowingClip?: string;
}

export function compareDuration(
  declared: number,
  content: number,
  fps: number,
  truncate = false,
  overflowingClip?: string,
): DurationComparison {
  const conversion = createConversion(fps);
  const declaredFrames = secondsToFrames(declared, conversion);
  const contentFrames = secondsToFrames(content, conversion);
  const deltaFrames = contentFrames - declaredFrames;

  if (deltaFrames > 0) {
    return {
      status: truncate ? "truncating" : "overflowing",
      declared,
      content,
      declaredFrames,
      contentFrames,
      deltaFrames,
      droppedFrames: deltaFrames,
      extraFrames: 0,
      overflowingClip,
    };
  }

  if (deltaFrames < 0) {
    return {
      status: "padded",
      declared,
      content,
      declaredFrames,
      contentFrames,
      deltaFrames,
      droppedFrames: 0,
      extraFrames: -deltaFrames,
    };
  }

  return {
    status: "equal",
    declared,
    content,
    declaredFrames,
    contentFrames,
    deltaFrames: 0,
    droppedFrames: 0,
    extraFrames: 0,
  };
}

function computeClipSpanWithScenes(
  clip: Clip,
  conversion: FrameConversion,
  fps: number,
): { readonly startFrames: number; readonly endFrames: number } {
  const rawStart = clip.start === undefined ? 0 : timeInputToFrames(clip.start, conversion);
  const startFrames = Math.max(0, rawStart);

  if (clip.duration !== undefined) {
    const endFrames = startFrames + timeInputToFrames(clip.duration, conversion);
    return { startFrames, endFrames };
  }
  if (clip.end !== undefined) {
    const endFrames = timeInputToFrames(clip.end, conversion);
    return { startFrames, endFrames };
  }

  // Nested scene support
  const maybeScene = clip as { type?: string; timeline?: Timeline };
  if (maybeScene.type === "scene" && maybeScene.timeline) {
    const nested = computeTimelineContentDuration(maybeScene.timeline, fps);
    const endFrames = startFrames + nested.frames;
    return { startFrames, endFrames };
  }

  return { startFrames, endFrames: startFrames + 1 };
}

export interface TimelineDurationResult {
  readonly frames: number;
  readonly seconds: number;
  readonly maxClip?: string;
  readonly overflowingClip?: string;
}

export function computeTimelineContentDuration(
  timeline: Timeline,
  fps: number,
  declaredSeconds?: number,
): TimelineDurationResult {
  const conversion = createConversion(fps);
  const declaredFrames = declaredSeconds !== undefined ? secondsToFrames(declaredSeconds, conversion) : undefined;
  let maxFrames = 0;
  let maxClip: string | undefined;
  let overflowingClip: string | undefined;

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const span = computeClipSpanWithScenes(clip as Clip, conversion, fps);
      const name = clipName(clip as Clip);
      if (span.endFrames > maxFrames) {
        maxFrames = span.endFrames;
        maxClip = name;
      }
      if (declaredFrames !== undefined && span.endFrames > declaredFrames && !overflowingClip) {
        overflowingClip = name;
      }
    }
  }

  return {
    frames: maxFrames,
    seconds: maxFrames > 0 ? maxFrames / fps : 0,
    maxClip,
    overflowingClip: overflowingClip ?? maxClip,
  };
}

export interface DurationCheckInput {
  readonly kind: "timeline" | "scene";
  readonly id: string;
  readonly declared: number | undefined;
  readonly content: number;
  readonly fps: number;
  readonly truncate?: boolean;
  readonly manifestPath: string;
  readonly overflowingClip?: string;
}

/** One declared duration, compared against the content its clips actually produce. */
export function checkDeclaredDuration(input: DurationCheckInput): CinecodeError[] {
  const { kind, id, declared, content, fps, truncate = false, manifestPath, overflowingClip } = input;
  if (declared === undefined) return [];

  const comparison = compareDuration(declared, content, fps, truncate, overflowingClip);

  if (comparison.status === "overflowing") {
    const clipInfo = comparison.overflowingClip ? ` (overflowing clip: "${comparison.overflowingClip}")` : "";
    return [
      createError(
        ErrorCode.CC1010,
        {
          path: manifestPath,
          reason:
            `${kind} "${id}" declares duration ${comparison.declared}s but its content runs ${comparison.content}s; ` +
            `${comparison.droppedFrames} frame(s) would be dropped${clipInfo}. ` +
            `Raise the duration to ${comparison.content}s, or add "truncate": true to accept the cut.`,
        },
        {
          location: { file: manifestPath, clip: comparison.overflowingClip ?? id },
          fixHint: `Set ${kind} "${id}" duration to ${comparison.content}s or add "truncate": true.`,
        },
      ),
    ];
  }

  if (comparison.status === "truncating") {
    recordDegradation({
      code: ErrorCode.CC1010,
      what: `${kind} "${id}" truncates its content`,
      reason: `declared ${comparison.declared}s, content runs ${comparison.content}s at ${fps} fps`,
      input: manifestPath,
      instead: `${comparison.droppedFrames} frame(s) are dropped because "truncate: true" is set`,
    });
    return [];
  }

  if (comparison.status === "padded") {
    recordNote(
      `${kind} "${id}" declares ${comparison.declared}s but its content ends at ${comparison.content}s; the trailing ${(comparison.extraFrames / fps).toFixed(3)}s (${comparison.extraFrames} frame(s)) uses the boundary mode.`,
    );
  }

  return [];
}

export function validateEntryDuration(
  entry: ManifestEntryBase & { duration?: number | string; truncate?: boolean },
  kind: "scene" | "timeline",
  moduleExports: unknown,
  fps: number,
  manifestPath: string,
): CinecodeError[] {
  const raw = moduleExports;
  const isTime = !!raw && typeof raw === "object" && Array.isArray((raw as { tracks?: unknown }).tracks);
  const isComp = !!raw && typeof raw === "object" && "rootTimeline" in (raw as object);
  const isScene = !!raw && typeof raw === "object" && (raw as { kind?: string }).kind === "scene";
  const timeline = isTime ? (raw as Timeline) : isComp ? (raw as { rootTimeline: Timeline }).rootTimeline : isScene ? (raw as { build: (p: never) => Timeline }).build(undefined as never) : undefined;
  if (!timeline) return [];
  const rawDecl = entry.duration ?? (isScene ? (raw as { duration?: number | string }).duration : undefined);
  if (rawDecl === undefined) return [];
  const parsed = parseDurationInput(rawDecl, fps);
  if (!parsed.ok) return [];
  const contentInfo = computeTimelineContentDuration(timeline, fps, parsed.seconds);
  return checkDeclaredDuration({
    kind,
    id: entry.id,
    declared: parsed.seconds,
    content: contentInfo.seconds,
    fps,
    truncate: entry.truncate === true,
    manifestPath,
    overflowingClip: contentInfo.overflowingClip,
  });
}

export function validateTimelineRefsDuration(
  entry: ManifestEntryBase & { sceneRefs?: readonly string[]; duration?: number | string; truncate?: boolean },
  scenes: readonly (ManifestEntryBase & { file?: string; duration?: number | string })[] | undefined,
  fps: number,
  manifestPath: string,
  moduleCache?: Map<string, unknown>,
): CinecodeError[] {
  if (!entry.sceneRefs || entry.sceneRefs.length === 0 || entry.duration === undefined) return [];
  const parsed = parseDurationInput(entry.duration, fps);
  if (!parsed.ok) return [];
  let assembledSeconds = 0;
  let overflowingScene: string | undefined;
  for (const sRef of entry.sceneRefs) {
    const sEntry = scenes?.find((s) => s.id.toLowerCase() === sRef.toLowerCase());
    if (sEntry) {
      let sSec: number | undefined;
      if (sEntry.duration !== undefined) {
        const p = parseDurationInput(sEntry.duration, fps);
        if (p.ok) sSec = p.seconds;
      }
      if (sSec === undefined && sEntry.file) {
        const sFile = resolve(resolve(manifestPath, ".."), sEntry.file);
        const sMod = moduleCache?.get(sFile);
        const isTime = !!sMod && typeof sMod === "object" && Array.isArray((sMod as { tracks?: unknown }).tracks);
        const isComp = !!sMod && typeof sMod === "object" && "rootTimeline" in (sMod as object);
        const isScene = !!sMod && typeof sMod === "object" && (sMod as { kind?: string }).kind === "scene";
        const sTime = isTime ? (sMod as Timeline) : isComp ? (sMod as { rootTimeline: Timeline }).rootTimeline : isScene ? (sMod as { build: (p: never) => Timeline }).build(undefined as never) : undefined;
        if (sTime) sSec = computeTimelineContentDuration(sTime, fps).seconds;
      }
      const dur = sSec ?? 0;
      if (assembledSeconds + dur > parsed.seconds && !overflowingScene) overflowingScene = sRef;
      assembledSeconds += dur;
    }
  }
  return checkDeclaredDuration({
    kind: "timeline",
    id: entry.id,
    declared: parsed.seconds,
    content: assembledSeconds,
    fps,
    truncate: entry.truncate === true,
    manifestPath,
    overflowingClip: overflowingScene,
  });
}
