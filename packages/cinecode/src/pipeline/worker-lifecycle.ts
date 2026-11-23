import type { Worker } from "node:worker_threads";
import type { Composition } from "../core/types/index.js";
import { createError, ErrorCode } from "../errors/codes.js";
import { frameFromTransfer } from "./frame-format.js";
import type { ChunkIdentity } from "./chunk-identity.js";
import type { TransportOutput, WorkerResult } from "./worker-types.js";

export function stripAudioForWorkers(composition: Composition): Composition {
  const tracks = composition.rootTimeline.tracks;
  const visualTracks = tracks.filter((t) => t.kind !== "audio");
  if (visualTracks.length === tracks.length) return composition;
  return {
    ...composition,
    rootTimeline: { ...composition.rootTimeline, tracks: visualTracks },
  };
}

export function normalizeWorkerResult(
  output: TransportOutput,
  identity: ChunkIdentity,
  onTransferred?: () => void,
): WorkerResult {
  return {
    ...output,
    identity,
    chunkIndex: identity.chunkIndex,
    frames: output.frames.map((frame) => {
      if (!("pixels" in frame)) return { index: frame.index, buffer: frame.buffer };
      onTransferred?.();
      return { index: frame.index, buffer: frameFromTransfer(frame.pixels, true) };
    }),
  };
}

export async function bootstrapWorker(
  worker: Worker,
  payload: Record<string, unknown>,
  startup: number[],
): Promise<number> {
  const started = Date.now();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      worker.off("message", onMessage);
      worker.off("exit", onExit);
      worker.off("error", onError);
    };
    const onMessage = (message: { type?: string; error?: string; startupMs?: number }): void => {
      if (message.type !== "ready" && message.type !== "init-error") return;
      cleanup();
      if (message.type === "init-error") {
        reject(createError(ErrorCode.CC4008, { path: "worker", reason: message.error ?? "unknown" }));
        return;
      }
      if (message.startupMs !== undefined) startup.push(message.startupMs);
      resolve();
    };
    const onExit = (code: number): void => {
      cleanup();
      reject(
        createError(ErrorCode.CC4003, {
          details: `Worker terminated during bootstrap (exit code ${code})`,
        }),
      );
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    worker.on("message", onMessage);
    worker.once("exit", onExit);
    worker.once("error", onError);
    worker.postMessage({ type: "init", payload });
  });
  return Date.now() - started;
}
