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

export function normalizeSource(source: string): string {
  let result = "";
  let i = 0;
  const len = source.length;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  const templateBraces: number[] = [];

  while (i < len) {
    const char = source[i]!;
    const next = i + 1 < len ? source[i + 1]! : "";

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        result += "\n";
      } else if (char === "\r") {
        result += "\r";
      } else {
        result += " ";
      }
      i++;
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        result += "  ";
        i += 2;
      } else if (char === "\n") {
        result += "\n";
        i++;
      } else if (char === "\r") {
        result += "\r";
        i++;
      } else {
        result += " ";
        i++;
      }
      continue;
    }

    if (inSingleQuote) {
      if (char === "\\" && next) {
        result += "  ";
        i += 2;
      } else if (char === "'") {
        inSingleQuote = false;
        result += " ";
        i++;
      } else if (char === "\n") {
        result += "\n";
        i++;
      } else if (char === "\r") {
        result += "\r";
        i++;
      } else {
        result += " ";
        i++;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (char === "\\" && next) {
        result += "  ";
        i += 2;
      } else if (char === '"') {
        inDoubleQuote = false;
        result += " ";
        i++;
      } else if (char === "\n") {
        result += "\n";
        i++;
      } else if (char === "\r") {
        result += "\r";
        i++;
      } else {
        result += " ";
        i++;
      }
      continue;
    }

    if (inBacktick) {
      if (char === "\\" && next) {
        result += "  ";
        i += 2;
      } else if (char === "`") {
        inBacktick = false;
        result += " ";
        i++;
      } else if (char === "$" && next === "{") {
        templateBraces.push(1);
        inBacktick = false;
        result += "${";
        i += 2;
      } else if (char === "\n") {
        result += "\n";
        i++;
      } else if (char === "\r") {
        result += "\r";
        i++;
      } else {
        result += " ";
        i++;
      }
      continue;
    }

    if (templateBraces.length > 0) {
      const lastIdx = templateBraces.length - 1;
      const current = templateBraces[lastIdx] ?? 0;
      if (char === "{") {
        templateBraces[lastIdx] = current + 1;
      } else if (char === "}") {
        const nextVal = current - 1;
        templateBraces[lastIdx] = nextVal;
        if (nextVal <= 0) {
          templateBraces.pop();
          inBacktick = true;
          result += "}";
          i++;
          continue;
        }
      }
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      result += "  ";
      i += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      result += "  ";
      i += 2;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      result += " ";
      i++;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      result += " ";
      i++;
      continue;
    }
    if (char === "`") {
      inBacktick = true;
      result += " ";
      i++;
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

const DETERMINISM_BLOCKLIST: readonly (readonly [api: string, pattern: RegExp, hint: string])[] = [
  ["Date.now", /\bDate\.now\s*\(/, "Pass time or frame explicitly instead of using Date.now()."],
  ["new Date", /\bnew\s+Date\s*\(\s*\)/, "Pass explicit timestamp or frame instead of new Date()."],
  ["Math.random", /\bMath\.random\s*\(/, "Use random(seed), noise1d(seed, t) or noise2d(seed, x, y) from cinecode instead of Math.random()."],
  ["performance.now", /\bperformance\.now\s*\(/, "Use frame numbers or composition duration instead of performance.now()."],
  ["crypto.randomUUID", /\bcrypto\.randomUUID\s*\(/, "Generate deterministic IDs or use seeded randomness instead of crypto.randomUUID()."],
  ["crypto.getRandomValues", /\bcrypto\.getRandomValues\s*\(/, "Use seeded PRNG instead of crypto.getRandomValues()."],
  ["toLocaleString", /\.toLocaleString\s*\(/, "Specify explicit locale and options or use deterministic formatting instead of toLocaleString()."],
  ["toLocaleDateString", /\.toLocaleDateString\s*\(/, "Specify explicit locale and options or use deterministic formatting instead of toLocaleDateString()."],
  ["toLocaleTimeString", /\.toLocaleTimeString\s*\(/, "Specify explicit locale and options or use deterministic formatting instead of toLocaleTimeString()."],
  ["Intl.DateTimeFormat", /\bIntl\.DateTimeFormat\b/, "Ensure explicit locale and timezone are specified for Intl.DateTimeFormat."],
  ["Intl.NumberFormat", /\bIntl\.NumberFormat\b/, "Ensure explicit locale is specified for Intl.NumberFormat."],
  ["readdirSync", /\b(?:fs\.)?readdirSync\s*\(/, "Filesystem readdirSync returns arbitrary order; sort entries explicitly or use media catalog."],
  ["readdir", /\b(?:fs\.)?readdir\s*\(/, "Filesystem readdir returns arbitrary order; sort entries explicitly or use media catalog."],
  ["readFileSync", /\b(?:fs\.)?readFileSync\s*\(/, "Use project media catalog instead of direct readFileSync."],
  ["readFile", /\b(?:fs\.)?readFile\s*\(/, "Use project media catalog instead of direct readFile."],
  ["openSync", /\b(?:fs\.)?openSync\s*\(/, "Use project media catalog instead of direct openSync."],
  ["render", /\brender\s*\(/, "Render must not be invoked inside composition source."],
  ["renderStill", /\brenderStill\s*\(/, "Render must not be invoked inside composition source."],
  ["renderVideo", /\brenderVideo\s*\(/, "Render must not be invoked inside composition source."],
];

export function scanSourceForNonDeterminism(source: string, file: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const normalized = normalizeSource(source);
  const lines = normalized.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [api, pattern, hint] of DETERMINISM_BLOCKLIST) {
      const match = pattern.exec(line);
      if (match) {
        issues.push(
          authoringIssue(
            AUTHORING_CODES.nonDeterministicApi,
            `Non-deterministic API "${api}" used in ${file}`,
            {
              hint,
              position: { file, line: i + 1, column: match.index + 1 },
            },
          ),
        );
      }
    }
  });
  return issues;
}

export function computeClipSpan(clip: Clip, conversion: FrameConversion): ClipSpan {
  const rawStart = clip.start === undefined ? 0 : timeInputToFrames(clip.start, conversion);
  const startFrames = Math.max(0, rawStart);
  let endFrames: number;
  if (clip.duration !== undefined) {
    endFrames = startFrames + timeInputToFrames(clip.duration, conversion);
  } else if (clip.end !== undefined) {
    endFrames = timeInputToFrames(clip.end, conversion);
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
    const spans = track.clips
      .map((clip, index) => ({ span: computeClipSpan(clip as Clip, context.conversion), index }))
      .sort((a, b) => a.span.startFrames - b.span.startFrames || a.index - b.index)
      .map((item) => item.span);

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
        issues.push({ ...issue, severity: behavior === "strict" ? "error" : "warning" });
      }
    }
  }

  return issues;
}

function hasTransition(clip: Clip, key: "transitionIn" | "transitionOut"): boolean {
  const value: unknown = (clip as unknown as Record<string, unknown>)[key];
  return value !== undefined && value !== null;
}
