import type { Composition } from "../core/types/index.js";
import { renderFrame, type RenderSession } from "../renderer/engine.js";
import type { RenderRuntime } from "../renderer/runtime.js";
import { isVerbose } from "../observability/invocation-context.js";
import {
  type FrameErrorPolicy,
  type FrameFailure,
  frameToBuffer,
  placeholderBuffer,
  extractClipReference,
  colorSpecToString,
  isCircuitBroken,
  formatDiagnostics,
} from "./frame-policy.js";

export interface FrameBatchOutput {
  readonly frames: readonly { index: number; buffer: Buffer }[];
  readonly error?: string;
  readonly failures?: readonly FrameFailure[];
  readonly aborted?: boolean;
  readonly diagnostics?: string;
}

export interface FrameBatchInput {
  readonly composition: Composition;
  readonly seed: number;
  readonly frames: readonly number[];
  readonly policy: FrameErrorPolicy;
  readonly maxConsecutiveFailures: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly runtime: RenderRuntime;
  readonly session: RenderSession;
  readonly isCancelled?: () => boolean;
}

export async function renderFrameBatch(input: FrameBatchInput): Promise<FrameBatchOutput> {
  const { composition, seed, frames, policy, maxConsecutiveFailures, frameWidth, frameHeight, runtime, session } = input;
  const results: { index: number; buffer: Buffer }[] = [];
  const failures: FrameFailure[] = [];
  let consecutiveFailures = 0;
  let previousBuffer: Buffer | null = null;

  for (const frame of frames) {
    if (input.isCancelled?.()) break;
    try {
      const result = await renderFrame(composition, frame, seed, { runtime, session });
      const buffer = frameToBuffer(result.canvas);
      results.push({ index: frame, buffer });
      previousBuffer = buffer;
      consecutiveFailures = 0;
    } catch (error) {
      session.lastFrameSurface = null;
      const failure: FrameFailure = {
        frame,
        timecode: frame / Math.max(1, composition.fps),
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        clip: extractClipReference(error),
      };
      failures.push(failure);
      consecutiveFailures += 1;
      if (isVerbose()) {
        process.stderr.write(
          JSON.stringify({
            level: "error",
            stage: "frame-render",
            frame,
            timecodeSeconds: failure.timecode,
            clip: failure.clip,
            message: failure.message,
          }) + "\n",
        );
      }

      if (policy === "abort") {
        return {
          frames: results,
          failures,
          aborted: true,
          error: `[CC4003] render aborted on failed frame ${frame}: ${failure.message}`,
          diagnostics: formatDiagnostics(failures, frames.length),
        };
      }

      if (isCircuitBroken(consecutiveFailures, maxConsecutiveFailures)) {
        return {
          frames: results,
          failures,
          aborted: true,
          error: `[CC4003] circuit breaker tripped after ${consecutiveFailures} consecutive failed frame(s) (policy: ${policy}): ${failure.message}`,
          diagnostics: formatDiagnostics(failures, frames.length),
        };
      }

      if (policy === "repeat-previous" && previousBuffer) {
        results.push({ index: frame, buffer: previousBuffer });
        continue;
      }

      results.push({
        index: frame,
        buffer: placeholderBuffer(frameWidth, frameHeight, failure.message, colorSpecToString(composition.background)),
      });
    }
  }

  return {
    frames: results,
    failures,
    ...(failures.length > 0 ? { diagnostics: formatDiagnostics(failures, frames.length) } : {}),
  };
}
