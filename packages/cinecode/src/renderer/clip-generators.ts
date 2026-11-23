import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import type {
  VisualClip,
  Clip,
  ParticleClip,
  NoiseClip,
  ChromaKeyClip,
  GradientMeshClip,
  MeshWarpClip,
} from "../core/types/index.js";
import type { Rect, ShapeDrawParams } from "./shapes/index.js";
import { createDefaultTransform, applyTransform } from "./shapes/index.js";
import { createContext, clearCanvas } from "./composite/engine.js";
import { resolveEmitterConfig } from "../particles/types.js";
import { getParticleContext, updateParticleContext } from "../particles/context.js";
import { renderParticles } from "../particles/render.js";
import { chromaKeyEffect } from "../effects/chroma-key.js";
import { createEffectInput } from "../effects/engine.js";
import { layoutChart, interpolateChartData, drawChart, drawNoData } from "../dataviz/index.js";
import { drawSticker } from "../stickers/index.js";
import { drawMeshGradient, generateRegularAnchors } from "../gradients/index.js";
import {
  createWarpGrid,
  applyWarpDisplacements,
  computeAnimatedWarp,
  applyWarp,
  isIdentityWarp,
} from "../warp/index.js";
import { computeClipSpan } from "../core/validation/index.js";
import { getFallbackSession, type RenderSession } from "./session.js";
import type { RenderContext } from "./engine-types.js";
import { getVideoMetadata, extractVideoFrameCanvas, loadCachedImage } from "./video-cache.js";

export function drawParticleClip(
  ctx: SKRSContext2D,
  clip: ParticleClip,
  params: ShapeDrawParams,
  context: RenderContext,
): void {
  const width = Math.max(1, Math.round(clip.width ?? context.width));
  const height = Math.max(1, Math.round(clip.height ?? context.height));
  const config = resolveEmitterConfig(clip.params, clip.seed);
  const particleContext = getParticleContext(clip, context.frame);
  const elapsed = elapsedSinceClipStart(clip, context);
  const state = updateParticleContext(particleContext, elapsed, context.frame, config, {
    width,
    height,
  });

  const temp = (context.session ?? getFallbackSession()).getParticleCanvas(width, height);
  const tempCtx = createContext(temp);
  clearCanvas(tempCtx, width, height);
  renderParticles(tempCtx, state, config.blending, clip.params.debug === true ? { debugMode: true, viewport: { width, height } } : {});

  ctx.save();
  applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, width, height);
  ctx.drawImage(temp, 0, 0, width, height);
  ctx.restore();
}

export function elapsedSinceClipStart(clip: ParticleClip, context: RenderContext): number {
  const span = computeClipSpan(clip, context.conversion);
  const elapsed = (context.frame - span.startFrames) / context.conversion.fpsFloat;
  return Math.max(0, elapsed);
}

export function drawNoiseClip(
  ctx: SKRSContext2D,
  clip: NoiseClip,
  params: ShapeDrawParams,
  context: RenderContext,
): void {
  const width = Math.max(1, Math.round(clip.width ?? 100));
  const height = Math.max(1, Math.round(clip.height ?? 100));
  const texture = (context.session ?? getFallbackSession()).getNoiseTexture(width, height);
  ctx.save();
  applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, width, height);
  ctx.globalAlpha = params.opacity ?? 1;
  ctx.drawImage(texture, 0, 0, width, height);
  ctx.restore();
}

export function getChromaKeyCanvas(width: number, height: number, session?: RenderSession): Canvas {
  return (session ?? getFallbackSession()).getChromaKeyCanvas(width, height);
}

export async function drawChromaKeyClip(
  ctx: SKRSContext2D,
  clip: ChromaKeyClip,
  bounds: Rect,
  params: ShapeDrawParams,
  context: RenderContext,
): Promise<void> {
  const src = clip.src;
  let sourceCanvas: Canvas;
  let srcWidth: number;
  let srcHeight: number;
  const mediaCache = context.session.mediaCache;
  const isVideo = mediaCache !== null && (await getVideoMetadata(src, mediaCache)) !== null;
  if (isVideo) {
    const extracted = await extractVideoFrameCanvas(
      src,
      context,
      clip as { trimStart?: number | string },
    );
    sourceCanvas = extracted.canvas;
    srcWidth = extracted.width;
    srcHeight = extracted.height;
  } else {
    const imgCanvas = await loadCachedImage(src, context.session);
    srcWidth = imgCanvas.width;
    srcHeight = imgCanvas.height;
    sourceCanvas = getChromaKeyCanvas(srcWidth, srcHeight, context.session);
    const sourceCtx = sourceCanvas.getContext("2d");
    sourceCtx.clearRect(0, 0, srcWidth, srcHeight);
    sourceCtx.drawImage(imgCanvas, 0, 0);
  }

  chromaKeyEffect.apply(
    createEffectInput(sourceCanvas, sourceCanvas.getContext("2d"), context.time, context.seed),
    {
      keyColor: clip.keyColor,
      similarity: clip.similarity,
      spillSuppress: clip.spillSuppress,
      softness: clip.softness,
    },
  );

  let sx = 0,
    sy = 0,
    sw = srcWidth,
    sh = srcHeight;
  if (clip.crop) {
    sx = clip.crop.x;
    sy = clip.crop.y;
    sw = clip.crop.width;
    sh = clip.crop.height;
  }

  let dx = 0,
    dy = 0,
    dw = bounds.width,
    dh = bounds.height;
  const fit = clip.fit ?? "cover";
  if (fit === "contain") {
    const scale = Math.min(bounds.width / sw, bounds.height / sh);
    dw = sw * scale;
    dh = sh * scale;
    dx = (bounds.width - dw) / 2;
    dy = (bounds.height - dh) / 2;
  } else if (fit === "cover") {
    const scale = Math.max(bounds.width / sw, bounds.height / sh);
    dw = sw * scale;
    dh = sh * scale;
    dx = (bounds.width - dw) / 2;
    dy = (bounds.height - dh) / 2;
  } else if (fit === "fill") {
    dw = bounds.width;
    dh = bounds.height;
  } else if (fit === "none") {
    dw = sw;
    dh = sh;
    dx = (bounds.width - dw) / 2;
    dy = (bounds.height - dh) / 2;
  }

  ctx.save();
  if (params.transform)
    applyTransform(
      ctx,
      { ...createDefaultTransform(), ...params.transform },
      bounds.width,
      bounds.height,
    );
  ctx.beginPath();
  ctx.rect(0, 0, bounds.width, bounds.height);
  ctx.clip();
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

export function drawDataVizClip(
  ctx: SKRSContext2D,
  clip: VisualClip & {
    data: readonly number[] | ReadonlyArray<{ label: string; value: number }>;
    chartType: "bar" | "line" | "scatter";
    colors?: readonly string[];
    showValues?: boolean;
    animDuration?: number;
  },
  bounds: Rect,
  params: ShapeDrawParams,
  context: RenderContext,
): void {
  const span = computeClipSpan(clip as unknown as Clip, context.conversion);
  const animDuration = clip.animDuration ?? 1;
  const progress =
    animDuration <= 0
      ? 1
      : Math.min(1, (context.time - span.startFrames / context.conversion.fpsFloat) / animDuration);
  const layout = layoutChart(clip.data, clip.chartType, bounds.width, bounds.height, {
    showValues: clip.showValues,
  });
  const animated = interpolateChartData(layout, progress);

  ctx.save();
  applyTransform(
    ctx,
    { ...createDefaultTransform(), ...params.transform },
    bounds.width,
    bounds.height,
  );
  if (clip.data.length === 0) {
    drawNoData(ctx, bounds.width, bounds.height);
    ctx.restore();
    return;
  }
  drawChart(ctx, animated, { colors: clip.colors, showValues: clip.showValues });
  ctx.restore();
}

export function drawStickerClip(
  ctx: SKRSContext2D,
  clip: VisualClip & { emoji: string; size: number; font?: string },
  bounds: Rect,
  params: ShapeDrawParams,
): void {
  const size = Math.min(clip.size, bounds.width, bounds.height);
  ctx.save();
  applyTransform(
    ctx,
    { ...createDefaultTransform(), ...params.transform },
    bounds.width,
    bounds.height,
  );
  drawSticker(ctx, clip.emoji, bounds.x, bounds.y, size, clip.font, params.opacity);
  ctx.restore();
}

export function drawGradientMeshClip(
  ctx: SKRSContext2D,
  clip: GradientMeshClip,
  bounds: Rect,
  params: ShapeDrawParams,
): void {
  const anchors =
    clip.anchors.length > 0
      ? clip.anchors
      : generateRegularAnchors(Math.max(1, clip.gridCols), Math.max(1, clip.gridRows), [
          "#2196f3",
          "#4caf50",
          "#ff9800",
          "#e91e63",
        ]);
  ctx.save();
  applyTransform(
    ctx,
    { ...createDefaultTransform(), ...params.transform },
    bounds.width,
    bounds.height,
  );
  ctx.beginPath();
  ctx.rect(0, 0, bounds.width, bounds.height);
  ctx.clip();
  ctx.globalAlpha = params.opacity ?? 1;
  drawMeshGradient(ctx, bounds.width, bounds.height, anchors);
  ctx.restore();
}

export async function drawMeshWarpClip(
  ctx: SKRSContext2D,
  clip: MeshWarpClip,
  bounds: Rect,
  params: ShapeDrawParams,
  context: RenderContext,
): Promise<void> {
  const src = clip.src;
  let sourceCanvas: Canvas;
  const mediaCache = context.session.mediaCache;
  const metadata = mediaCache !== null ? await getVideoMetadata(src, mediaCache) : null;
  if (metadata !== null) {
    const extracted = await extractVideoFrameCanvas(
      src,
      context,
      clip as { trimStart?: number | string },
    );
    sourceCanvas = extracted.canvas;
  } else {
    sourceCanvas = await loadCachedImage(src, context.session);
  }

  const cols = Math.max(1, Math.round(clip.cols));
  const rows = Math.max(1, Math.round(clip.rows));
  const grid =
    clip.animated === true
      ? computeAnimatedWarp(context.time, cols, rows, sourceCanvas.width, sourceCanvas.height)
      : applyWarpDisplacements(
          createWarpGrid(cols, rows, sourceCanvas.width, sourceCanvas.height),
          clip.warpPoints ?? [],
        );

  ctx.save();
  applyTransform(
    ctx,
    { ...createDefaultTransform(), ...params.transform },
    bounds.width,
    bounds.height,
  );
  ctx.beginPath();
  ctx.rect(0, 0, bounds.width, bounds.height);
  ctx.clip();
  ctx.globalAlpha = params.opacity ?? 1;
  if (isIdentityWarp(grid)) {
    ctx.drawImage(sourceCanvas, 0, 0, bounds.width, bounds.height);
  } else {
    const warped = applyWarp(
      sourceCanvas,
      grid,
      Math.round(bounds.width),
      Math.round(bounds.height),
    );
    ctx.drawImage(warped, 0, 0, bounds.width, bounds.height);
  }
  ctx.restore();
}
