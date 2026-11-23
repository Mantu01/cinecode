import { Canvas, loadImage } from "@napi-rs/canvas";
import type { Composition } from "../core/types/index.js";
import type { VideoClip, MediaProps } from "../core/types/clips.js";
import { extractFramesInMemory, type ExtractedFrame } from "../media/frames.js";
import { calculateSourceFrame, type ConformParams } from "../media/conform.js";
import { setVisualizerMediaCache } from "../audio/visualizerSample.js";
import { createError, ErrorCode } from "../errors/index.js";
import { type RenderSession, getFallbackSession } from "./session.js";
import type { VideoFrameRef, RenderContext } from "./engine-types.js";

export function canvasBytes(canvas: Canvas): number {
  return canvas.width * canvas.height * 4;
}

export function rememberImage(src: string, canvas: Canvas, session?: RenderSession): void {
  (session ?? getFallbackSession()).imageCache.set(src, canvas);
}

export async function loadCachedImage(src: string, session?: RenderSession): Promise<Canvas> {
  const cache = (session ?? getFallbackSession()).imageCache;
  if (cache.has(src)) return cache.get(src)!;
  const img = await loadImage(src);
  const canvas = new Canvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  rememberImage(src, canvas, session);
  return canvas;
}

export function getRgbaBuffer(resolution: string, byteSize: number, session?: RenderSession): Uint8ClampedArray {
  const cache = (session ?? getFallbackSession()).rgbaBufferCache;
  let buf = cache.get(resolution);
  if (!buf || buf.length !== byteSize) {
    buf = new Uint8ClampedArray(byteSize);
    cache.set(resolution, buf);
  }
  return buf;
}

export function setDisableLocalVideoDecode(disable: boolean, session?: RenderSession): void {
  (session ?? getFallbackSession()).disableLocalVideoDecode = disable;
}

export function setMediaCacheForRenderer(cache: import("../media/cache.js").MediaCache, session?: RenderSession): void {
  (session ?? getFallbackSession()).mediaCache = cache;
  setVisualizerMediaCache(cache);
}

export function videoFrameKey(src: string, sourceFrame: number): string {
  return `${src}@${sourceFrame}`;
}

export function rememberVideoFrame(src: string, sourceFrame: number, frame: ExtractedFrame, session?: RenderSession): void {
  const s = session ?? getFallbackSession();
  const key = videoFrameKey(src, sourceFrame);
  s.videoFrameOrigin.set(key, src);
  s.videoFrameCache.set(key, frame);
}

export function hasVideoFrameCached(src: string, sourceFrame: number, session?: RenderSession): boolean {
  return (session ?? getFallbackSession()).videoFrameCache.has(videoFrameKey(src, sourceFrame));
}

export function storeRemoteVideoFrame(
  src: string,
  frame: ExtractedFrame,
  sourceFrame: number,
  session?: RenderSession,
): void {
  rememberVideoFrame(src, sourceFrame, frame, session);
}

export function getMediaCacheForRenderer(session?: RenderSession): import("../media/cache.js").MediaCache | null {
  return (session ?? getFallbackSession()).mediaCache;
}

export function recallVideoFrame(src: string, sourceFrame: number, session?: RenderSession): ExtractedFrame | undefined {
  return (session ?? getFallbackSession()).videoFrameCache.get(videoFrameKey(src, sourceFrame));
}

export function latestVideoFrame(src: string, session?: RenderSession): ExtractedFrame | undefined {
  const s = session ?? getFallbackSession();
  const keys = Array.from(s.videoFrameCache.keys()).reverse();
  for (const key of keys) {
    if (s.videoFrameOrigin.get(key) === src) {
      const frame = s.videoFrameCache.get(key);
      if (frame) return frame;
    }
  }
  return undefined;
}

export async function getVideoMetadata(
  src: string,
  cache: import("../media/cache.js").MediaCache,
): Promise<import("../media/cache.js").MediaMetadata | null> {
  const cached = await cache.getMetadata(src).catch(() => null);
  if (cached) return cached;
  try {
    const { inspectMedia } = await import("../media/inspector.js");
    return await inspectMedia(src, { cache, sourceDir: process.cwd() });
  } catch {
    return null;
  }
}

export function maxSourceFrameOf(metadata: import("../media/cache.js").MediaMetadata): number {
  const fps = metadata.fps > 0 ? metadata.fps : 30;
  return Math.max(0, Math.floor(metadata.duration * fps) - 1);
}

export async function videoFrameRefsFor(
  composition: Composition,
  frames: readonly number[],
  session?: RenderSession,
): Promise<readonly VideoFrameRef[]> {
  if (frames.length === 0) return [];
  const mediaCache = (session ?? getFallbackSession()).mediaCache;
  const refs: VideoFrameRef[] = [];
  const seen = new Set<string>();
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind === "audio" || track.kind === "subtitle") continue;
    for (const clip of track.clips) {
      if (clip.type !== "video") continue;
      const src = clip.src;
      if (!src || seen.has(src)) continue;
      seen.add(src);
      if (!mediaCache) continue;
      const metadata = await getVideoMetadata(src, mediaCache);
      if (!metadata) continue;
      const clampedMax = maxSourceFrameOf(metadata);

      const media = clip as VideoClip;
      const trimStart =
        typeof media.trimStart === "number"
          ? media.trimStart
          : parseFloat(media.trimStart as string);
      const trimEnd =
        typeof media.trimEnd === "number" ? media.trimEnd : parseFloat(media.trimEnd as string);
      const conformParams: ConformParams = {
        trim:
          !isNaN(trimStart) || !isNaN(trimEnd)
            ? { trimStart: isNaN(trimStart) ? 0 : trimStart, trimEnd: isNaN(trimEnd) ? 0 : trimEnd }
            : undefined,
        speed:
          media.speed !== undefined || media.reverse !== undefined
            ? { speed: media.speed ?? 1, reverse: media.reverse ?? false }
            : undefined,
      };

      for (const frame of frames) {
        refs.push({
          src,
          sourceFrame: Math.min(
            clampedMax,
            calculateSourceFrame(
              frame,
              metadata,
              { fps: composition.fps, width: composition.width, height: composition.height },
              conformParams,
            ),
          ),
        });
      }
    }
  }
  return refs;
}

export async function primeVideoFramesForRange(
  composition: Composition,
  frames: readonly number[],
  session?: RenderSession,
): Promise<void> {
  const s = session ?? getFallbackSession();
  if (s.disableLocalVideoDecode || !s.mediaCache || frames.length === 0) return;

  const seen = new Set<string>();
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind === "audio" || track.kind === "subtitle") continue;
    for (const clip of track.clips) {
      if (clip.type !== "video") continue;
      const src = clip.src;
      if (!src || seen.has(src)) continue;
      seen.add(src);

      const metadata = await getVideoMetadata(src, s.mediaCache);
      if (!metadata) continue;
      const clampedMax = maxSourceFrameOf(metadata);

      const media = clip as VideoClip;
      const trimStart =
        typeof media.trimStart === "number"
          ? media.trimStart
          : parseFloat(media.trimStart as string);
      const trimEnd =
        typeof media.trimEnd === "number" ? media.trimEnd : parseFloat(media.trimEnd as string);
      const conformParams: ConformParams = {
        trim:
          !isNaN(trimStart) || !isNaN(trimEnd)
            ? { trimStart: isNaN(trimStart) ? 0 : trimStart, trimEnd: isNaN(trimEnd) ? 0 : trimEnd }
            : undefined,
        speed:
          media.speed !== undefined || media.reverse !== undefined
            ? { speed: media.speed ?? 1, reverse: media.reverse ?? false }
            : undefined,
      };

      const sourceFrames = frames.map((frame) =>
        Math.min(
          clampedMax,
          calculateSourceFrame(
            frame,
            metadata,
            { fps: composition.fps, width: composition.width, height: composition.height },
            conformParams,
          ),
        ),
      );
      let first = Infinity;
      let last = -Infinity;
      for (const sf of sourceFrames) {
        if (sf < first) first = sf;
        if (sf > last) last = sf;
      }
      if (first > last) continue;

      if (last - first + 1 > frames.length * 5) continue;
      if (
        s.videoFrameCache.has(videoFrameKey(src, first)) &&
        s.videoFrameCache.has(videoFrameKey(src, last))
      )
        continue;

      try {
        const extracted = await extractFramesInMemory(
          src,
          first,
          last - first + 1,
          undefined,
          metadata.fps,
        );
        for (let i = 0; i < extracted.length; i++) {
          rememberVideoFrame(src, first + i, extracted[i]!, s);
        }
      } catch {
        // Note: Priming is an optimization — per-frame extraction still works.
      }
    }
  }
}

export function getVideoFrameCanvas(width: number, height: number, session?: RenderSession): Canvas {
  const pool = (session ?? getFallbackSession()).videoFrameCanvasPool;
  const key = `${width}x${height}`;
  let c = pool.get(key);
  if (!c) {
    c = new Canvas(width, height);
    pool.set(key, c);
  }
  return c;
}

export async function extractVideoFrameCanvas(
  src: string,
  context: RenderContext,
  mediaProps: {
    readonly trimStart?: number | string;
    readonly trimEnd?: number | string;
    readonly speed?: number;
    readonly reverse?: boolean;
  },
): Promise<{ canvas: Canvas; width: number; height: number }> {
  const { composition, frame } = context;
  const metadata = await getVideoMetadata(src, context.session.mediaCache!);
  if (!metadata) {
    throw new Error(
      `Could not read video metadata for "${src}" — check the path and that the file is a valid video.`,
    );
  }

  const trimStart =
    typeof mediaProps.trimStart === "number"
      ? mediaProps.trimStart
      : parseFloat(mediaProps.trimStart as string);
  const trimEnd =
    typeof mediaProps.trimEnd === "number"
      ? mediaProps.trimEnd
      : parseFloat(mediaProps.trimEnd as string);
  const conformParams: ConformParams = {
    trim:
      !isNaN(trimStart) || !isNaN(trimEnd)
        ? { trimStart: isNaN(trimStart) ? 0 : trimStart, trimEnd: isNaN(trimEnd) ? 0 : trimEnd }
        : undefined,
    speed:
      mediaProps.speed !== undefined || mediaProps.reverse !== undefined
        ? { speed: mediaProps.speed ?? 1, reverse: mediaProps.reverse ?? false }
        : undefined,
  };

  const sourceFrame = Math.min(
    maxSourceFrameOf(metadata),
    calculateSourceFrame(
      frame,
      metadata,
      { fps: composition.fps, width: composition.width, height: composition.height },
      conformParams,
    ),
  );

  let extractedFrame = recallVideoFrame(src, sourceFrame, context.session);
  if (!extractedFrame) {
    if (context.session.disableLocalVideoDecode) {
      throw createError(ErrorCode.CC4001, { frame: sourceFrame, source: src, reason: "Missing video frame in worker cache; shared decode service must provide all required frames" });
    }
    let decoded: ExtractedFrame[] | null;
    try {
      decoded = await extractFramesInMemory(
        src,
        sourceFrame,
        1,
        { width: metadata.width, height: metadata.height },
        metadata.fps,
      );
    } catch {
      decoded = null;
    }
    const first = decoded && decoded.length > 0 ? decoded[0] : undefined;
    if (first) {
      rememberVideoFrame(src, sourceFrame, first, context.session);
      extractedFrame = first;
    } else {
      extractedFrame = latestVideoFrame(src, context.session);
      if (!extractedFrame) {
        throw new Error(`Failed to decode frame ${sourceFrame} of "${src}".`);
      }
    }
  }

  const { buffer, width: srcWidth, height: srcHeight } = extractedFrame;
  const poolKey = `${srcWidth}x${srcHeight}`;
  const byteSize = srcWidth * srcHeight * 4;
  const rgbaBuf = getRgbaBuffer(poolKey, byteSize, context.session);
  const u8 = buffer as unknown as Uint8Array;
  rgbaBuf.set(u8);

  const frameCanvas = getVideoFrameCanvas(srcWidth, srcHeight, context.session);
  const frameCtx = frameCanvas.getContext("2d");
  const imgData = context.session.getImageData(frameCtx, srcWidth, srcHeight);
  imgData.data.set(rgbaBuf);
  frameCtx.putImageData(imgData, 0, 0);
  return { canvas: frameCanvas, width: srcWidth, height: srcHeight };
}
