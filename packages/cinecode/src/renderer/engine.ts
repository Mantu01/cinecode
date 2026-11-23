import type { Canvas } from "@napi-rs/canvas";
import type { Composition, VisualClip } from "../core/types/index.js";
import type { Rgba, Gradient } from "./color/types.js";
import {
  compositionConversion,
  compositionTotalFrames,
  frameToSeconds,
} from "../core/time/index.js";
import { resolveClipKeyframes } from "../core/keyframes/engine.js";
import { computeClipSpan, validateComposition, compositionValidationError } from "../core/validation/index.js";
import { preflightText } from "./text/preflight.js";
import { createContext, clearCanvas, compositeLayers } from "./composite/engine.js";
import { getDefaultRenderRuntime, type RenderRuntime } from "./runtime.js";
import {
  computeDirtyRect,
  isFullFrameRect,
  rectArea,
  rectsOverlap,
} from "./layout/engine.js";
import { clampResolutionScale } from "./scale.js";
import {
  type RenderSession,
  createRenderSession,
  getFallbackSession,
  getLiveSessionCount,
  resetLiveSessionCount,
} from "./session.js";
import { getRendererCacheStats } from "./pool.js";
import {
  type RenderContext,
  type RenderResult,
  type RenderFrameOptions,
  type VideoFrameRef,
  type CompositionIndex,
  EMPTY_CLIPS,
  REJECTED_CLIP_TYPES,
  SUPPORTED_VISUAL_CLIP_TYPES,
} from "./engine-types.js";
import {
  corePaintToRenderer,
  isIncrementallySafe,
  clipScreenRect,
  hasSubtitleTracks,
  resolveBlendMode,
  getMask,
  getMatte,
} from "./shapes-render.js";
import { createDefaultTransform } from "./shapes/index.js";
import { applySkybox } from "./clip-3d.js";
import { drawClip, clipCoverageIssues } from "./clip-dispatch.js";
import { applyEffects, evaluateClipVisual, applyPostProcessing } from "./clip-effects.js";
import { renderSubtitleTracks } from "./clip-text.js";
import { renderSplitScreen as renderSplitScreenImpl } from "./split-screen.js";
import {
  setDisableLocalVideoDecode,
  setMediaCacheForRenderer,
  hasVideoFrameCached,
  storeRemoteVideoFrame,
  getMediaCacheForRenderer,
  videoFrameRefsFor,
  primeVideoFramesForRange,
} from "./video-cache.js";

const DIRTY_RECT_AREA_LIMIT = 0.6;

export {
  getRendererCacheStats,
  createRenderSession,
  getLiveSessionCount,
  resetLiveSessionCount,
  compositionConversion,
  setDisableLocalVideoDecode,
  setMediaCacheForRenderer,
  hasVideoFrameCached,
  storeRemoteVideoFrame,
  getMediaCacheForRenderer,
  videoFrameRefsFor,
  primeVideoFramesForRange,
  clipCoverageIssues,
  REJECTED_CLIP_TYPES,
  SUPPORTED_VISUAL_CLIP_TYPES,
};

export type {
  RenderSession,
  RenderContext,
  RenderResult,
  RenderFrameOptions,
  VideoFrameRef,
};
export type RenderSessionState = RenderSession;

export function clearRendererCaches(session?: RenderSession): void {
  if (session) {
    session.dispose();
  } else {
    getFallbackSession().dispose();
  }
}

export function buildCompositionIndex(composition: Composition): CompositionIndex {
  const conversion = compositionConversion(composition);
  const activeByFrame = new Map<number, VisualClip[]>();
  const trackByClip = new Map<VisualClip, number>();
  const totalFrames = compositionTotalFrames(composition);

  const tracks = composition.rootTimeline.tracks;
  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
    const track = tracks[trackIndex]!;
    if (track.kind === "audio" || track.kind === "subtitle") continue;
    if (track.muted === true) continue;
    const ordered = track.clips
      .map((clip, order) => ({ clip, order, span: computeClipSpan(clip as never, conversion) }))
      .sort((a, b) => a.span.startFrames - b.span.startFrames || a.order - b.order);
    for (const { clip, span } of ordered) {
      trackByClip.set(clip, trackIndex);
      for (let f = span.startFrames; f < span.endFrames; f++) {
        let bucket = activeByFrame.get(f);
        if (!bucket) {
          bucket = [];
          activeByFrame.set(f, bucket);
        }
        bucket.push(clip);
      }
    }
  }

  return { totalFrames, activeByFrame, trackByClip };
}

export function getCompositionIndex(composition: Composition, session?: RenderSession): CompositionIndex {
  const indexCache = (session ?? getFallbackSession()).indexCache;
  let index = indexCache.get(composition as unknown as object);
  if (!index) {
    index = buildCompositionIndex(composition);
    indexCache.set(composition as unknown as object, index);
  }
  return index;
}

export async function renderFrame(
  composition: Composition,
  frame: number,
  seed: number,
  options: RenderFrameOptions = {},
): Promise<RenderResult> {
  const validation = validateComposition(composition);
  if (!validation.valid) throw compositionValidationError(validation);
  preflightText(composition);

  const session = options.session ?? getFallbackSession();
  const scale =
    options.resolutionScale === undefined ? 1 : clampResolutionScale(options.resolutionScale);
  const result = await renderCompositionFrame(
    composition,
    frame,
    seed,
    options.runtime ?? getDefaultRenderRuntime(),
    session,
  );
  if (scale === 1) return result;
  const width = Math.max(1, Math.round(composition.width * scale));
  const height = Math.max(1, Math.round(composition.height * scale));
  const scaled = session.getScaledSurface(width, height);
  const ctx = createContext(scaled);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(result.canvas, 0, 0, result.canvas.width, result.canvas.height, 0, 0, width, height);
  return { ...result, canvas: scaled };
}

export async function renderCompositionFrame(
  composition: Composition,
  frame: number,
  seed: number,
  runtime: RenderRuntime,
  session?: RenderSession,
): Promise<RenderResult> {
  const s = session ?? getFallbackSession();
  s.clearTempCanvases();
  const conversion = compositionConversion(composition);
  const rootSpeed = composition.rootTimeline?.speed ?? 1;
  const rootOffset = typeof composition.rootTimeline?.offset === "number"
    ? composition.rootTimeline.offset
    : typeof composition.rootTimeline?.offset === "string"
      ? parseFloat(composition.rootTimeline.offset) || 0
      : 0;
  const time = frameToSeconds(frame, conversion) * rootSpeed + rootOffset;
  const backgroundPaint = corePaintToRenderer(composition.background);
  let backgroundForContext: string | Rgba | Gradient = "#000000";
  if (typeof backgroundPaint === "string") {
    backgroundForContext = backgroundPaint;
  } else if (backgroundPaint && "r" in backgroundPaint) {
    backgroundForContext = backgroundPaint;
  } else if (backgroundPaint && typeof backgroundPaint === "object" && "stops" in backgroundPaint) {
    backgroundForContext = backgroundPaint as Gradient;
  }
  const context: RenderContext = {
    composition,
    conversion,
    frame,
    time,
    seed,
    width: composition.width,
    height: composition.height,
    background: backgroundForContext,
    runtime,
    session: s,
  };
  if (composition.splitScreen) {
    return renderSplitScreen(composition, context, seed);
  }
  return renderStandardFrame(composition, context, seed, s);
}

export async function renderSplitScreen(
  composition: Composition,
  context: RenderContext,
  seed: number,
): Promise<RenderResult> {
  return renderSplitScreenImpl(composition, context, seed, renderStandardFrame);
}

export async function renderStandardFrame(
  composition: Composition,
  context: RenderContext,
  seed: number,
  session?: RenderSession,
): Promise<RenderResult> {
  const frame = context.frame;
  const index = getCompositionIndex(composition, context.session);
  const s = session ?? context.session;

  const targetCanvas = s.getRenderTarget(composition.width, composition.height);
  const targetCtx = createContext(targetCanvas);

  const activeClips = index.activeByFrame.get(frame) ?? EMPTY_CLIPS;
  const currentRects = activeClips.map(clipScreenRect);
  const previousSurface = s.lastFrameSurface ?? null;
  const incrementalAllowed =
    previousSurface !== null &&
    previousSurface.composition === (composition as unknown as object) &&
    previousSurface.canvas === targetCanvas &&
    previousSurface.frame === frame - 1 &&
    composition.skybox === undefined &&
    (composition.postProcessing?.effects?.length ?? 0) === 0 &&
    !hasSubtitleTracks(composition) &&
    activeClips.every(isIncrementallySafe);
  const dirtyRect =
    incrementalAllowed && previousSurface
      ? computeDirtyRect(
          previousSurface.rects,
          currentRects,
          composition.width,
          composition.height,
          2,
        )
      : null;
  const useIncremental =
    dirtyRect !== null &&
    !isFullFrameRect(dirtyRect, composition.width, composition.height) &&
    rectArea(dirtyRect) <= composition.width * composition.height * DIRTY_RECT_AREA_LIMIT;

  if (useIncremental) s.consecutiveFullRedraws = 0;
  else s.consecutiveFullRedraws += 1;

  if (useIncremental && dirtyRect) {
    targetCtx.save();
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.clearRect(dirtyRect.x, dirtyRect.y, dirtyRect.width, dirtyRect.height);
    targetCtx.restore();
  } else {
    clearCanvas(targetCtx, composition.width, composition.height);
    await applySkybox(targetCtx, composition);
  }
  const compositeClip = useIncremental ? dirtyRect : null;

  const [bufA, bufB] = s.getDrawBuffers(composition.width, composition.height);
  let drawBuffer: Canvas = bufA;
  let underlying: Canvas | null = null;
  let currentTrack = -1;

  for (const clip of activeClips) {
    const trackIndex = index.trackByClip.get(clip) ?? 0;
    if (trackIndex !== currentTrack) {
      currentTrack = trackIndex;
      underlying = null;
    }
    if (compositeClip && !rectsOverlap(clipScreenRect(clip), compositeClip)) {
      underlying = null;
      continue;
    }
    const clipCanvas = drawBuffer;
    const clipCtx = createContext(clipCanvas);
    clearCanvas(clipCtx, composition.width, composition.height);
    const activeClip = resolveClipKeyframes(clip, frame, composition.fps);
    await drawClip(clipCtx, activeClip, context, seed);
    const withEffects = applyEffects(clipCanvas, activeClip, context);
    const parentTrack = composition.rootTimeline.tracks[trackIndex];
    const trackOpacity = typeof parentTrack?.opacity === "number" ? parentTrack.opacity : 1;
    const opacity = (activeClip.opacity ?? 1) * trackOpacity;
    const blendMode = resolveBlendMode(activeClip.blend ?? parentTrack?.blend);
    const finalCanvas = evaluateClipVisual({ clipCanvas: withEffects, clip: activeClip, context, underlying });

    const mask = getMask(activeClip, composition.width, composition.height);
    const matte = getMatte(activeClip, composition.width, composition.height);

    compositeLayers(
      targetCtx,
      [
        {
          canvas: finalCanvas,
          opacity,
          blendMode,
          transform: createDefaultTransform(),
          mask,
          matte,
        },
      ],
      composition.width,
      composition.height,
      compositeClip ?? undefined,
    );

    underlying = finalCanvas;
    drawBuffer = drawBuffer === bufA ? bufB : bufA;
  }

  await renderSubtitleTracks(targetCtx, composition, context, seed);
  applyPostProcessing(targetCtx, composition, context, seed);
  s.lastFrameSurface = {
    composition: composition as unknown as object,
    frame,
    rects: currentRects,
    canvas: targetCanvas,
  };
  return { canvas: targetCanvas, frame, time: context.time };
}

export async function renderStill(
  composition: Composition,
  frame: number,
  seed: number = 0,
): Promise<Canvas> {
  const validation = validateComposition(composition);
  if (!validation.valid) throw compositionValidationError(validation);
  return (await renderFrame(composition, frame, seed)).canvas;
}
