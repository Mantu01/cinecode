import { ErrorCode } from "../errors/codes.js";
import {
  createFallbackFrameBuffer,
  resolveStrategy,
  DEFAULT_RECOVERY,
  type RecoveryPolicy,
} from "./recovery.js";
import type { Composition } from "../core/types/index.js";
import type { FrameChunk, FrameManager } from "./workers.js";
import type { ProgressReporter } from "./progress.js";

export async function handleChunkFailure(params: {
  readonly result: { chunkIndex: number; error?: string; frames: readonly { readonly index: number; readonly buffer: Buffer }[] };
  readonly chunksToRender: readonly { chunkIndex: number; chunk: FrameChunk }[];
  readonly workerManager: FrameManager;
  readonly recovery?: RecoveryPolicy;
  readonly processedComposition: Composition;
  readonly reporter: ProgressReporter;
}): Promise<readonly { readonly index: number; readonly buffer: Buffer }[]> {
  const { result, chunksToRender, workerManager, recovery, processedComposition, reporter } = params;
  if (!result.error) return result.frames;

  const strategy = resolveStrategy(recovery, "frame");
  const allowFallback = recovery?.fallbackFrame ?? DEFAULT_RECOVERY.fallbackFrame;
  const chunkError = new Error(result.error);
  if (strategy === "abort") throw chunkError;

  let recoveredFrames: readonly { readonly index: number; readonly buffer: Buffer }[] | null = null;
  if (strategy === "retry") {
    const retries = Math.max(0, recovery?.maxRetries ?? DEFAULT_RECOVERY.maxRetries);
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const targetChunk = chunksToRender.find((c) => c.chunkIndex === result.chunkIndex)?.chunk;
      if (targetChunk) {
        const retryResults = await workerManager.processChunks([targetChunk]);
        const retryResult = retryResults[0];
        if (retryResult && !retryResult.error) {
          recoveredFrames = retryResult.frames;
          reporter.reportWarning(
            `[CC4001] chunk ${result.chunkIndex} recovered on retry ${attempt}: ${result.error}`,
          );
          break;
        }
      }
    }
  }

  if (recoveredFrames) return recoveredFrames;

  if ((strategy === "skip" || strategy === "retry") && allowFallback) {
    const targetChunk = chunksToRender.find((c) => c.chunkIndex === result.chunkIndex)?.chunk;
    const framesList = targetChunk ? targetChunk.frames : result.frames.map((f) => f.index);
    reporter.reportDegradation(
      `[CC4001] chunk ${result.chunkIndex} failed: ${result.error} — placeholder frames substituted for ${framesList.length} frame(s)`,
      {
        code: ErrorCode.CC4001,
        what: `chunk ${result.chunkIndex} failed to render`,
        input: processedComposition.name,
        instead: `${framesList.length} placeholder frame(s) substituted`,
      },
    );
    return framesList.map((frame) => ({
      index: frame,
      buffer: createFallbackFrameBuffer(processedComposition),
    }));
  }

  throw chunkError;
}
