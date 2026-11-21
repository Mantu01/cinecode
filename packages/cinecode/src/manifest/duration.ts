import { createError, ErrorCode, type CinecodeError } from "../errors/index.js";
import { recordDegradation, recordNote } from "../errors/degradations.js";

export interface DurationCheckInput {
  readonly kind: "timeline" | "scene";
  readonly id: string;
  readonly declared: number | undefined;
  readonly content: number;
  readonly fps: number;
  readonly truncate?: boolean;
  readonly manifestPath: string;
}

const EPSILON_FRAMES = 1;

/** One declared duration, compared against the content its clips actually produce. */
export function checkDeclaredDuration(input: DurationCheckInput): CinecodeError[] {
  const { kind, id, declared, content, fps, truncate, manifestPath } = input;
  if (declared === undefined) return [];

  const droppedFrames = Math.round((content - declared) * fps);
  if (droppedFrames > EPSILON_FRAMES) {
    if (truncate === true) {
      recordDegradation({
        code: ErrorCode.CC1010,
        what: `${kind} "${id}" truncates its content`,
        reason: `declared ${declared}s, content runs ${content}s at ${fps} fps`,
        input: manifestPath,
        instead: `${droppedFrames} frame(s) are dropped because "truncate: true" is set`,
      });
      return [];
    }
    return [
      createError(
        ErrorCode.CC1010,
        {
          path: manifestPath,
          reason:
            `${kind} "${id}" declares duration ${declared}s but its content runs ${content}s; ` +
            `${droppedFrames} frame(s) would be dropped. Raise the duration to ${content}s, or add "truncate": true to accept the cut.`,
        },
        {
          location: { file: manifestPath, clip: id },
          fixHint: `Set ${kind} "${id}" duration to ${content}s or add "truncate": true.`,
        },
      ),
    ];
  }

  const extraFrames = Math.round((declared - content) * fps);
  if (extraFrames > EPSILON_FRAMES) {
    recordNote(
      `${kind} "${id}" declares ${declared}s but its content ends at ${content}s; the trailing ${(extraFrames / fps).toFixed(3)}s uses the boundary mode.`,
    );
  }
  return [];
}
