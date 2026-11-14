import type { Timeline } from "../types/tracks.js";
import type { Clip } from "../types/clips.js";
import { clipName } from "../types/clips.js";
import type { FrameConversion } from "../time/convert.js";
import { timeInputToFrames } from "../time/convert.js";
import { existsSync } from "node:fs";
import { AUTHORING_CODES, type ValidationIssue, authoringIssue } from "./errors.js";
import { findTimelineOvershoots } from "../time/timeline.js";

export interface ClipSpan {
  readonly clip: Clip;
  readonly startFrames: number;
  readonly endFrames: number;
  readonly declared: boolean;
}

const DETERMINISM_BLOCKLIST: readonly (readonly [api: string, pattern: RegExp])[] = [
  ["Date.now", /\bDate\.now\s*\(/],
  ["Math.random", /\bMath\.random\s*\(/],
  ["performance.now", /\bperformance\.now\s*\(/],
];

export function scanSourceForNonDeterminism(source: string, file: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [api, pattern] of DETERMINISM_BLOCKLIST) {
      if (pattern.test(line)) {
        issues.push(
          authoringIssue(
            AUTHORING_CODES.nonDeterministicApi,
            `Non-deterministic API "${api}" used in ${file}`,
            {
              hint: `Use random(seed), noise1d(seed, t) or noise2d(seed, x, y) from cinecode instead of ${api}.`,
              position: { file, line: i + 1, column: line.indexOf(api) + 1 },
            },
          ),
        );
      }
    }
  });
  return issues;
}

export function computeClipSpan(clip: Clip, conversion: FrameConversion): ClipSpan {
  const startFrames = clip.start === undefined ? 0 : timeInputToFrames(clip.start, conversion);
  let endFrames: number;
  if (clip.end !== undefined) {
    endFrames = timeInputToFrames(clip.end, conversion);
  } else if (clip.duration !== undefined) {
    endFrames = startFrames + timeInputToFrames(clip.duration, conversion);
  } else {
    endFrames = startFrames + 1;
  }
  const declared = endFrames <= startFrames;
  if (declared) {
    endFrames = startFrames + 1;
  }
  return { clip, startFrames, endFrames, declared };
}

export function minimumDurationFrames(_conversion: FrameConversion): number {
  return 1;
}

export interface TimelineValidationContext {
  readonly conversion: FrameConversion;
  readonly compositionWidth?: number;
  readonly compositionHeight?: number;
  readonly durationFrames?: number;
  readonly boundaryBehavior?: "clamp" | "extend" | "strict";
}

export function validateTimeline(
  timeline: Timeline,
  context: TimelineValidationContext,
  position?: { file: string; line: number; column: number },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const track of timeline.tracks) {
    if (track.kind === "subtitle") {
      for (const clip of track.clips) {
        if (!existsSync(clip.src)) {
          issues.push(
            authoringIssue(AUTHORING_CODES.invalidComposition, `Subtitle file not found: "${clip.src}"`, {
              clipName: clipName(clip as Clip),
              trackName: track.name,
              position,
            }),
          );
        }
      }
    }
    const spans = track.clips.map((clip) => computeClipSpan(clip as Clip, context.conversion));
    spans.sort((a, b) => a.startFrames - b.startFrames);

    for (const span of spans) {
      if (span.declared) {
        const name = clipName(span.clip);
        issues.push(
          authoringIssue(AUTHORING_CODES.invalidDuration, `Clip "${name}" has zero or negative duration`, {
            clipName: name,
            trackName: track.name,
            position,
          }),
        );
        continue;
      }
      if (span.startFrames < 0) {
        const name = clipName(span.clip);
        issues.push(
          authoringIssue(AUTHORING_CODES.outsideComposition, `Clip "${name}" starts before the composition start`, {
            clipName: name,
            trackName: track.name,
            position,
          }),
        );
      }
    }

    for (let i = 1; i < spans.length; i += 1) {
      const previous = spans[i - 1]!;
      const current = spans[i]!;
      if (current.startFrames < previous.endFrames) {
        const hasDeclaredTransition =
          hasTransition(previous.clip, "transitionOut") && hasTransition(current.clip, "transitionIn");
        if (!hasDeclaredTransition) {
          const name = clipName(current.clip);
          issues.push(
            authoringIssue(
              AUTHORING_CODES.overlappingClips,
              `Clip "${name}" overlaps the previous clip on track "${track.name ?? "unnamed"}"`,
              { clipName: name, trackName: track.name, position },
            ),
          );
        }
      }
    }
  }

  if (context.durationFrames !== undefined) {
    const behavior = context.boundaryBehavior ?? "clamp";
    if (behavior !== "extend") {
      for (const overshoot of findTimelineOvershoots(timeline, context.conversion, context.durationFrames)) {
        const message = `Clip "${overshoot.clipName}" overshoots the composition boundary by ${overshoot.overshootFrames} frame(s)`;
        const issue = authoringIssue(AUTHORING_CODES.timelineOvershoot, message, {
          clipName: overshoot.clipName,
          trackName: overshoot.trackName,
          position,
          hint: behavior === "strict" ? "Trim the clip or raise composition.duration" : "The clip will be clamped to the composition duration",
        });
        issues.push(behavior === "strict" ? issue : { ...issue, severity: "warning" });
      }
    }
  }

  return issues;
}

function hasTransition(clip: Clip, key: "transitionIn" | "transitionOut"): boolean {
  const value: unknown = (clip as unknown as Record<string, unknown>)[key];
  return value !== undefined && value !== null;
}
