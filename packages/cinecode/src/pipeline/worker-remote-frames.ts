import type { MessagePort } from "node:worker_threads";
import type { Composition } from "../core/types/index.js";
import {
  setDisableLocalVideoDecode,
  videoFrameRefsFor,
  hasVideoFrameCached,
  storeRemoteVideoFrame,
} from "../renderer/engine.js";
import { createCacheClient } from "./cache-channel.js";
import { createError, ErrorCode } from "../errors/index.js";

let ready: Promise<void> | null = null;

export function disableWorkerLocalDecode(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      setDisableLocalVideoDecode(true);
    })();
  }
  return ready;
}

export function resetWorkerLocalDecode(): void {
  ready = null;
}

export async function fetchRemoteFrames(
  port: MessagePort | null,
  composition: Composition,
  frames: readonly number[],
): Promise<number> {
  const cacheClient = port ? createCacheClient(port) : null;
  if (!cacheClient) return 0;
  const refs = await videoFrameRefsFor(composition, frames);
  const misses = refs.filter((ref) => !hasVideoFrameCached(ref.src, ref.sourceFrame));
  const hits = refs.length - misses.length;
  if (misses.length === 0) return hits;

  const keys = misses.map((ref) => `video:${ref.src}@${ref.sourceFrame}`);
  const responses = await cacheClient.requestBatch(keys);
  for (let i = 0; i < misses.length; i++) {
    const ref = misses[i]!;
    const response = responses[i];
    if (!response || !response.hit || !response.data) {
      if (response?.error) {
        throw createError(ErrorCode.CC4001, { frame: ref.sourceFrame, source: ref.src, reason: response.error });
      }
      continue;
    }
    if (response.width !== undefined && response.height !== undefined) {
      storeRemoteVideoFrame(
        ref.src,
        {
          buffer: response.data,
          width: response.width,
          height: response.height,
          format: (response.format as "rgba" | "rgb24") ?? "rgba",
        },
        ref.sourceFrame,
      );
    } else {
      try {
        const payload = JSON.parse(response.data.toString("utf8")) as {
          buffer: string;
          width: number;
          height: number;
          format: "rgba" | "rgb24";
        };
        storeRemoteVideoFrame(
          ref.src,
          {
            buffer: Buffer.from(payload.buffer, "base64"),
            width: payload.width,
            height: payload.height,
            format: payload.format,
          },
          ref.sourceFrame,
        );
      } catch {
        // Note: source frame decode error handled during render stage
      }
    }
  }
  return hits;
}
