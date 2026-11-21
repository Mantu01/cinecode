import { Canvas, loadImage } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import type {
  Composition,
  VisualClip,
  AudioClip,
  SoundClip,
  TtsClip,
  SceneClip,
  Timeline,
  EffectRef,
  VideoClip,
  SvgClip,
  ParticleClip,
  NoiseClip,
  AudioTrack,
  AudioVisualizerClip,
  ChromaKeyClip,
  Clip,
  GradientMeshClip,
  MeshWarpClip,
  Model3dClip,
  Text3dClip,
  MultiCameraClip,
} from "../core/types/index.js";
import type { FrameConversion } from "../core/time/index.js";
import {
  createConversion,
  createVfrConversion,
  frameToSeconds,
  compositionConversion,
  compositionTotalFrames,
} from "../core/time/index.js";
import { resolveClipKeyframes } from "../core/keyframes/engine.js";
import { CLIP_TYPES, computeClipSpan, validateComposition, compositionValidationError } from "../core/validation/index.js";
import { extractFramesInMemory, type ExtractedFrame } from "../media/frames.js";
import { calculateSourceFrame, type ConformParams } from "../media/conform.js";
import type { Rgba, Gradient } from "./color/types.js";
import { parseColor } from "./color/index.js";
import type { BlendMode, ShapeDrawParams, Transform, Rect } from "./shapes/primitives.js";
import { createDefaultTransform, applyBlendMode, applyTransform } from "./shapes/primitives.js";
import {
  drawRectangle,
  drawRoundedRectangle,
  drawEllipse,
  drawLine,
  drawPolygon,
  drawPath,
} from "./shapes/draw.js";
import type { TextStyle } from "./text/engine.js";
import { prepareText } from "./text/engine.js";
import { preflightText } from "./text/preflight.js";
import type { CompositedLayer, Mask, Matte } from "./composite/engine.js";
import { createCanvas, createContext, clearCanvas, compositeLayers } from "./composite/engine.js";
import { createEffectInput, clearTempCanvasPool } from "../effects/engine.js";
import { createError, ErrorCode, recordDegradation, type ErrorLocation } from "../errors/index.js";
import { getDefaultRenderRuntime, type RenderRuntime } from "./runtime.js";
import { parseSvgSource } from "../svg/parser.js";
import { drawSvg } from "../svg/renderer.js";
import { resolveEmitterConfig } from "../particles/types.js";
import { getParticleContext, updateParticleContext } from "../particles/context.js";
import { renderParticles } from "../particles/render.js";
import { generateNoiseTexture } from "../noise/generator.js";
import {
  layoutBars,
  layoutWaveform,
  layoutRadial,
  resolveAudioTrack,
  smoothBands,
  type VisualizerLayout,
} from "../audio/visualizer.js";
import {
  getAnalysisBuffer,
  extractVisualizerSample,
  setVisualizerMediaCache,
} from "../audio/visualizerSample.js";
import { fft, magnitude, extractBands, extractBandsLogarithmic } from "../audio/fft.js";
import { chromaKeyEffect } from "../effects/chroma-key.js";
import { renderSubtitles } from "../subtitles/render.js";
import type { SubtitleClip } from "../core/types/index.js";
import { layoutChart, interpolateChartData, drawChart, drawNoData } from "../dataviz/index.js";
import { drawSticker } from "../stickers/index.js";
import { drawMeshGradient, generateRegularAnchors, type MeshAnchor } from "../gradients/index.js";
import {
  createWarpGrid,
  applyWarpDisplacements,
  computeAnimatedWarp,
  applyWarp,
  isIdentityWarp,
} from "../warp/index.js";
import { extrudeTextGeometry } from "../text-3d/mesh.js";
import { createTextStyle3d } from "../text-3d/material.js";
import { renderTextMesh } from "../text-3d/render.js";
import {
  resolveRegions,
  resolveLayout,
  drawRegionShadow,
  drawSourceIntoRegion,
  type SplitRegion,
} from "./pip.js";
import { loadCubeMap, loadEquirectangular } from "../model-3d/environment/cubeMap.js";
import { createProceduralSkybox, renderSkybox } from "../model-3d/environment/skybox.js";
import type { CubeTexture } from "../model-3d/environment/cubeMap.js";
import { createEffectGraphOptimizer, type EffectBatchEntry } from "./postprocess/batch.js";
import {
  computeDirtyRect,
  isFullFrameRect,
  rectArea,
  rectsOverlap,
  transformedAabb,
} from "./layout/engine.js";
import { clampResolutionScale } from "./scale.js";
import { renderMultiCameraFrame } from "./multi-camera.js";
import { evictOldest, ByteBoundedCache, getRendererCacheStats } from "./pool.js";
import {
  type RenderSession,
  createRenderSession,
  getFallbackSession,
  getLiveSessionCount,
  resetLiveSessionCount,
  type FrameSurfaceState,
} from "./session.js";

export { getRendererCacheStats, createRenderSession, getLiveSessionCount, resetLiveSessionCount };
export type { RenderSession };
export type RenderSessionState = RenderSession;

/** Drops every renderer pool. Called between render jobs and on worker exit. */
export function clearRendererCaches(session?: RenderSession): void {
  if (session) {
    session.dispose();
  } else {
    getFallbackSession().dispose();
  }
}

export interface RenderContext {
  readonly composition: Composition;
  readonly conversion: FrameConversion;
  readonly frame: number;
  readonly time: number;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly background: string | Rgba | Gradient;
  readonly runtime?: RenderRuntime;
  readonly session: RenderSession;
}

export interface RenderResult {
  readonly canvas: Canvas;
  readonly frame: number;
  readonly time: number;
}

function canvasBytes(canvas: Canvas): number {
  return canvas.width * canvas.height * 4;
}

function rememberImage(src: string, canvas: Canvas, session?: RenderSession): void {
  (session ?? getFallbackSession()).imageCache.set(src, canvas);
}

function getRgbaBuffer(resolution: string, byteSize: number, session?: RenderSession): Uint8ClampedArray {
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

function videoFrameKey(src: string, sourceFrame: number): string {
  return `${src}@${sourceFrame}`;
}

function rememberVideoFrame(src: string, sourceFrame: number, frame: ExtractedFrame, session?: RenderSession): void {
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

/** Source frames each video clip needs for the given composition frames. */
export interface VideoFrameRef {
  readonly src: string;
  readonly sourceFrame: number;
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

      const media = clip as import("../core/types/clips.js").VideoClip;
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

function recallVideoFrame(src: string, sourceFrame: number, session?: RenderSession): ExtractedFrame | undefined {
  return (session ?? getFallbackSession()).videoFrameCache.get(videoFrameKey(src, sourceFrame));
}

/** Most recently drawn frame for `src` — a safe fallback when a seek fails. */
function latestVideoFrame(src: string, session?: RenderSession): ExtractedFrame | undefined {
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

/**
 * Probe a video's metadata (duration/fps/size), using the media cache and
 * falling back to a live ffprobe so a cold cache still renders.
 */
async function getVideoMetadata(
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

/**
 * Highest source frame index a video can supply. A composition may outlast its
 * source (an outro card held past the last frame); without this clamp the tail
 * frames seek past EOF and the render fails.
 */
function maxSourceFrameOf(metadata: import("../media/cache.js").MediaMetadata): number {
  const fps = metadata.fps > 0 ? metadata.fps : 30;
  return Math.max(0, Math.floor(metadata.duration * fps) - 1);
}

/**
 * Decode one contiguous run of source frames in a single ffmpeg pass and seed
 * the in-memory cache. Called once per render chunk per video, so a frame never
 * pays for its own process spawn on the hot path.
 */
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

      const media = clip as import("../core/types/clips.js").VideoClip;
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

      // Avoid priming scattered frames (heavy trim/speed ramps) — only
      // contiguous runs make sense for a single decode pass.
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
        // Priming is an optimization — per-frame extraction still works.
      }
    }
  }
}

/**
 * Per-composition index so `renderFrame` doesn't rescan every clip (and
 * re-validate the whole timeline) on every frame. With authoring styles that
 * emit one clip per frame (e.g. keyframe-expansion engines) a composition can
 * hold tens of thousands of clips; scanning them all per frame is O(clips)
 * and dominated render time. We instead precompute each clip's span once and
 * bucket active clips by frame, so per-frame lookup is O(active clips).
 */
interface CompositionIndex {
  readonly totalFrames: number;
  /** frame -> clips active on that frame, ordered by track, start time, declaration. */
  readonly activeByFrame: Map<number, VisualClip[]>;
  /** clip -> owning visual track index, used to resolve transition underlays. */
  readonly trackByClip: Map<VisualClip, number>;
}
const EMPTY_CLIPS: VisualClip[] = [];

function getDrawBuffers(width: number, height: number, session?: RenderSession): [Canvas, Canvas] {
  return (session ?? getFallbackSession()).getDrawBuffers(width, height);
}

function getRenderTarget(width: number, height: number, session?: RenderSession): Canvas {
  return (session ?? getFallbackSession()).getRenderTarget(width, height);
}

function getGroupCanvas(width: number, height: number, session?: RenderSession): Canvas {
  return (session ?? getFallbackSession()).getGroupCanvas(width, height);
}

const MAX_POOL_SIZE = 8;
const POOL_CACHE_BYTES = 128 * 1024 * 1024;

const DIRTY_RECT_AREA_LIMIT = 0.6;

/** Clip types whose bounds or pixels cannot be bounded conservatively per frame. */
const UNBOUNDED_CLIP_TYPES = new Set([
  "particle",
  "noise",
  "audioVisualizer",
  "model3d",
  "multiCamera",
  "meshwarp",
  "text3d",
  "dataViz",
  "gradient-mesh",
  "sticker",
  "svg",
  "group",
  "scene",
]);

function isIncrementallySafe(clip: VisualClip): boolean {
  return (
    !UNBOUNDED_CLIP_TYPES.has(clip.type) &&
    clip.transitionIn === undefined &&
    clip.transitionOut === undefined &&
    (clip.effects?.length ?? 0) === 0 &&
    clip.keyframes === undefined &&
    clip.mask === undefined &&
    clip.matte === undefined &&
    clip.dropShadow === undefined &&
    clip.transform === undefined
  );
}

function clipScreenRect(clip: VisualClip): Rect {
  const bounds = getClipBounds(clip);
  return transformedAabb(bounds, getClipTransform(clip, bounds.width, bounds.height));
}

function hasSubtitleTracks(composition: Composition): boolean {
  return composition.rootTimeline.tracks.some((track) => track.kind === "subtitle");
}

function getTransitionBuffers(width: number, height: number, session?: RenderSession): [Canvas, Canvas] {
  return (session ?? getFallbackSession()).getTransitionBuffers(width, height);
}

function getTransparentCanvas(width: number, height: number, session?: RenderSession): Canvas {
  return (session ?? getFallbackSession()).getTransparentCanvas(width, height);
}

function getParticleCanvas(width: number, height: number, session?: RenderSession): Canvas {
  return (session ?? getFallbackSession()).getParticleCanvas(width, height);
}

function getNoiseTexture(width: number, height: number, clip: NoiseClip, time: number, session?: RenderSession): Canvas {
  return (session ?? getFallbackSession()).getNoiseTexture(width, height);
}

const SKYBOX_CACHE_MAX = 8;

function resolveSkyboxTexture(composition: Composition, session?: RenderSession): Promise<CubeTexture> | null {
  const config = composition.skybox;
  if (!config) return null;
  const s = session ?? getFallbackSession();
  const key = JSON.stringify(config);
  const cached = s.skyboxCache.get(key);
  if (cached) return cached;
  const loading = (async () => {
    if (config.type === "procedural") return createProceduralSkybox();
    if (config.type === "equirectangular" && config.src) return loadEquirectangular(config.src);
    const faces = config.faces;
    if (faces && faces.length >= 6) {
      return loadCubeMap({
        posX: faces[0]!,
        negX: faces[1]!,
        posY: faces[2]!,
        negY: faces[3]!,
        posZ: faces[4]!,
        negZ: faces[5]!,
      });
    }
    return createProceduralSkybox();
  })();
  s.skyboxCache.set(key, loading);
  evictOldest(s.skyboxCache, SKYBOX_CACHE_MAX);
  return loading;
}

async function applySkybox(
  ctx: SKRSContext2D,
  composition: Composition,
): Promise<CubeTexture | null> {
  const texture = await resolveSkyboxTexture(composition);
  if (!texture) return null;
  renderSkybox(ctx, texture, composition.width, composition.height, {
    exposure: composition.skybox?.exposure,
    yaw: composition.skybox?.yaw,
    pitch: composition.skybox?.pitch,
  });
  return texture;
}

export { compositionConversion };

function buildCompositionIndex(composition: Composition): CompositionIndex {
  const conversion = compositionConversion(composition);
  const activeByFrame = new Map<number, VisualClip[]>();
  const trackByClip = new Map<VisualClip, number>();
  const totalFrames = compositionTotalFrames(composition);

  const tracks = composition.rootTimeline.tracks;
  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
    const track = tracks[trackIndex]!;
    if (track.kind === "audio" || track.kind === "subtitle") continue;
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

function getCompositionIndex(composition: Composition, session?: RenderSession): CompositionIndex {
  const indexCache = (session ?? getFallbackSession()).indexCache;
  let index = indexCache.get(composition as unknown as object);
  if (!index) {
    index = buildCompositionIndex(composition);
    indexCache.set(composition as unknown as object, index);
  }
  return index;
}

async function loadCachedImage(src: string, session?: RenderSession): Promise<Canvas> {
  const cache = (session ?? getFallbackSession()).imageCache;
  if (cache.has(src)) return cache.get(src)!;
  const img = await loadImage(src);
  const canvas = new Canvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  rememberImage(src, canvas, session);
  return canvas;
}

function corePaintToRenderer(
  paint:
    | string
    | {
        type: string;
        color?: string;
        stops?: readonly { color: string; offset: number }[];
        angle?: number;
        center?: { x: number; y: number };
        radius?: number;
        src?: string;
      }
    | undefined,
): string | Rgba | Gradient | Canvas | undefined {
  if (!paint) return undefined;
  if (typeof paint === "string") return paint;
  if (paint.type === "solid") return parseColor(paint.color ?? "#000000");
  if (paint.type === "linear") {
    return {
      type: "linear",
      angle: paint.angle ?? 0,
      stops: (paint.stops ?? []).map((s) => ({ offset: s.offset, color: parseColor(s.color) })),
    };
  }
  if (paint.type === "radial") {
    return {
      type: "radial",
      centerX: paint.center?.x ?? 0.5,
      centerY: paint.center?.y ?? 0.5,
      radius: paint.radius ?? 0.5,
      stops: (paint.stops ?? []).map((s) => ({ offset: s.offset, color: parseColor(s.color) })),
    };
  }
  if (paint.type === "conic") {
    return {
      type: "conic",
      angle: paint.angle ?? 0,
      centerX: paint.center?.x ?? 0.5,
      centerY: paint.center?.y ?? 0.5,
      stops: (paint.stops ?? []).map((s) => ({ offset: s.offset, color: parseColor(s.color) })),
    };
  }
  if (paint.type === "image") {
    const src = paint.src ?? "";
    if (src) {
      const cached = getFallbackSession().imageCache.get(src);
      if (cached) return cached;
    }
    return "#000000";
  }
  return "#000000";
}

function corePaintToTextRenderer(
  paint:
    | string
    | {
        type: string;
        color?: string;
        stops?: readonly { color: string; offset: number }[];
        angle?: number;
        center?: { x: number; y: number };
        radius?: number;
        src?: string;
      }
    | undefined,
): Rgba | Gradient | undefined {
  const result = corePaintToRenderer(paint);
  if (typeof result === "string") return parseColor(result);
  if (result instanceof Canvas) return undefined;
  return result;
}

function getClipTransform(clip: VisualClip, _width: number, _height: number): Transform {
  const t = clip.transform ?? {};
  return {
    translateX: t.x ?? 0,
    translateY: t.y ?? 0,
    rotate: t.rotation ?? 0,
    scaleX: t.scaleX ?? 1,
    scaleY: t.scaleY ?? 1,
    anchorX:
      t.anchor === "top-left" || t.anchor === "left" || t.anchor === "bottom-left"
        ? 0
        : t.anchor === "top-right" || t.anchor === "right" || t.anchor === "bottom-right"
          ? 1
          : 0.5,
    anchorY:
      t.anchor === "top-left" || t.anchor === "top" || t.anchor === "top-right"
        ? 0
        : t.anchor === "bottom-left" || t.anchor === "bottom" || t.anchor === "bottom-right"
          ? 1
          : 0.5,
  };
}

function getClipBounds(clip: VisualClip): Rect {
  if (clip.type === "shape" || clip.type === "solid") {
    return { x: 0, y: 0, width: clip.width ?? 100, height: clip.height ?? 100 };
  }
  if (clip.type === "text") {
    return {
      x: 0,
      y: 0,
      width: clip.maxWidth ?? 200,
      height: clip.fontSize * (clip.lineHeight ?? 1.2),
    };
  }
  if (clip.type === "text3d") {
    return { x: 0, y: 0, width: clip.width ?? 600, height: clip.height ?? clip.fontSize * 1.5 };
  }
  if (clip.type === "scene") {
    const sceneClip = clip as SceneClip;
    return { x: 0, y: 0, width: sceneClip.width ?? 100, height: sceneClip.height ?? 100 };
  }
  if (
    clip.type === "image" ||
    clip.type === "video" ||
    clip.type === "svg" ||
    clip.type === "noise" ||
    clip.type === "audioVisualizer" ||
    clip.type === "chromakey" ||
    clip.type === "gradient-mesh"
  ) {
    const imageClip = clip as VisualClip & { width?: number; height?: number };
    return { x: 0, y: 0, width: imageClip.width ?? 100, height: imageClip.height ?? 100 };
  }
  return { x: 0, y: 0, width: 100, height: 100 };
}

function toRgba(
  color: string | Rgba | Gradient | undefined,
  opacity: number,
): Rgba | Gradient | undefined {
  if (!color) return undefined;
  if (typeof color === "string") {
    const p = parseColor(color);
    return { ...p, a: p.a * opacity };
  }
  if ("r" in color) return { ...color, a: color.a * opacity };
  return {
    ...color,
    stops: color.stops.map((s) => ({ ...s, color: { ...s.color, a: s.color.a * opacity } })),
  };
}

function toSolidRgba(
  color: string | Rgba | Gradient | undefined,
  opacity: number,
): Rgba | undefined {
  if (!color) return undefined;
  if (typeof color === "string") {
    const p = parseColor(color);
    return { ...p, a: p.a * opacity };
  }
  if ("r" in color) return { ...color, a: color.a * opacity };
  return undefined;
}

function toStroke(
  stroke:
    | {
        color: string | Rgba;
        width: number;
        lineCap?: string;
        lineJoin?: string;
        dashes?: readonly number[];
        dashOffset?: number;
      }
    | undefined,
): ShapeDrawParams["stroke"] | undefined {
  if (!stroke) return undefined;
  const color = typeof stroke.color === "string" ? parseColor(stroke.color) : stroke.color;
  return {
    color,
    width: stroke.width,
    lineCap: (stroke.lineCap as "butt" | "round" | "square") ?? "butt",
    lineJoin: (stroke.lineJoin as "miter" | "round" | "bevel") ?? "miter",
    dashArray: stroke.dashes ?? [],
    dashOffset: stroke.dashOffset ?? 0,
  };
}

function toShadow(
  shadow: { color: string | Rgba; blur: number; offsetX?: number; offsetY?: number } | undefined,
): ShapeDrawParams["shadow"] | undefined {
  if (!shadow) return undefined;
  const color = typeof shadow.color === "string" ? parseColor(shadow.color) : shadow.color;
  return { color, blur: shadow.blur, offsetX: shadow.offsetX ?? 0, offsetY: shadow.offsetY ?? 0 };
}

function resolveBlendMode(blend: VisualClip["blend"]): BlendMode {
  const mapping: Record<string, BlendMode> = {
    normal: "source-over",
    multiply: "multiply",
    screen: "screen",
    overlay: "overlay",
    add: "plus-lighter",
    darken: "darken",
    lighten: "lighten",
    "soft-light": "soft-light",
    difference: "difference",
  };
  return mapping[blend ?? "normal"] ?? "source-over";
}

function getClipFill(clip: VisualClip): string | Rgba | Gradient | undefined {
  if (clip.type === "text") {
    return corePaintToTextRenderer(clip.fill);
  }
  if (clip.type === "shape") {
    const fill = corePaintToRenderer(clip.fill);
    if (fill instanceof Canvas) return undefined;
    return fill;
  }
  if (clip.type === "solid") {
    const color = corePaintToRenderer(clip.color);
    if (color instanceof Canvas) return undefined;
    return color;
  }
  return undefined;
}

function getClipStroke(clip: VisualClip):
  | {
      color: string | Rgba;
      width: number;
      lineCap?: string;
      lineJoin?: string;
      dashes?: readonly number[];
      dashOffset?: number;
    }
  | undefined {
  if (clip.type === "text") {
    return clip.stroke as
      | {
          color: string | Rgba;
          width: number;
          lineCap?: string;
          lineJoin?: string;
          dashes?: readonly number[];
          dashOffset?: number;
        }
      | undefined;
  }
  if (clip.type === "shape") {
    return clip.stroke as
      | {
          color: string | Rgba;
          width: number;
          lineCap?: string;
          lineJoin?: string;
          dashes?: readonly number[];
          dashOffset?: number;
        }
      | undefined;
  }
  return undefined;
}

function getClipShadow(
  clip: VisualClip,
): { color: string | Rgba; blur: number; offsetX?: number; offsetY?: number } | undefined {
  if (clip.type === "text") {
    return clip.shadow as
      { color: string | Rgba; blur: number; offsetX?: number; offsetY?: number } | undefined;
  }
  if (clip.type === "shape") {
    return clip.shadow as
      { color: string | Rgba; blur: number; offsetX?: number; offsetY?: number } | undefined;
  }
  return undefined;
}

function isEffectActive(effectRef: EffectRef, context: RenderContext): boolean {
  if (effectRef.enabled === false) return false;
  const conversion = context.conversion;
  if (effectRef.from !== undefined) {
    const startFrame =
      typeof effectRef.from === "number"
        ? effectRef.from
        : parseFloat(effectRef.from as string) * conversion.fpsFloat;
    if (context.frame < startFrame) return false;
  }
  if (effectRef.to !== undefined) {
    const endFrame =
      typeof effectRef.to === "number"
        ? effectRef.to
        : parseFloat(effectRef.to as string) * conversion.fpsFloat;
    if (context.frame >= endFrame) return false;
  }
  return true;
}

function getMask(clip: VisualClip, _width: number, _height: number): Mask | undefined {
  if (!clip.mask) return undefined;
  const mask = clip.mask;
  if (mask.shape.kind === "rectangle") {
    return {
      kind: "shape",
      shape: {
        kind: "rectangle",
        x: mask.shape.x,
        y: mask.shape.y,
        width: mask.shape.width,
        height: mask.shape.height,
      },
      invert: mask.invert ?? false,
    };
  }
  if (mask.shape.kind === "ellipse") {
    return {
      kind: "shape",
      shape: {
        kind: "ellipse",
        cx: mask.shape.cx,
        cy: mask.shape.cy,
        radiusX: mask.shape.radiusX,
        radiusY: mask.shape.radiusY,
      },
      invert: mask.invert ?? false,
    };
  }
  return undefined;
}

function getMatte(clip: VisualClip, _width: number, _height: number): Matte | undefined {
  if (!clip.matte) return undefined;
  return { kind: clip.matte.kind, source: null as unknown as Canvas };
}

/**
 * Pre-rendered canvas pool keyed by (sourceWidth, sourceHeight). Instead of
 * constructing a fresh Canvas+ImageData for every video frame draw, we reuse
 * one per resolution — a 60s video at 30fps is 1800 allocations saved per
 * clip, and a composition with multiple video clips compounds this.
 */
function getVideoFrameCanvas(width: number, height: number, session?: RenderSession): Canvas {
  const pool = (session ?? getFallbackSession()).videoFrameCanvasPool;
  const key = `${width}x${height}`;
  let c = pool.get(key);
  if (!c) {
    c = new Canvas(width, height);
    pool.set(key, c);
  }
  return c;
}

async function drawImageClip(
  ctx: SKRSContext2D,
  clip: VisualClip & {
    src: string;
    fit?: string;
    crop?: { x: number; y: number; width: number; height: number };
    flipped?: boolean;
    roundedCorners?: number;
  },
  bounds: Rect,
  params: ShapeDrawParams,
  _context: RenderContext,
): Promise<void> {
  const imgCanvas = await loadCachedImage(clip.src);
  const imgWidth = imgCanvas.width;
  const imgHeight = imgCanvas.height;

  let sx = 0,
    sy = 0,
    sw = imgWidth,
    sh = imgHeight;
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
  // Media clips are positioned like every other visual clip: the transform
  // places the clip's bounds box in the composition, then the box is filled.
  if (params.transform)
    applyTransform(
      ctx,
      { ...createDefaultTransform(), ...params.transform },
      bounds.width,
      bounds.height,
    );
  if (clip.flipped) {
    ctx.translate(bounds.width, 0);
    ctx.scale(-1, 1);
  }
  if (clip.roundedCorners && clip.roundedCorners > 0) {
    const r = clip.roundedCorners;
    ctx.beginPath();
    ctx.moveTo(dx + r, dy);
    ctx.lineTo(dx + dw - r, dy);
    ctx.arcTo(dx + dw, dy, dx + dw, dy + r, r);
    ctx.lineTo(dx + dw, dy + dh - r);
    ctx.arcTo(dx + dw, dy + dh, dx + dw - r, dy + dh, r);
    ctx.lineTo(dx + r, dy + dh);
    ctx.arcTo(dx, dy + dh, dx, dy + dh - r, r);
    ctx.lineTo(dx, dy + r);
    ctx.arcTo(dx, dy, dx + r, dy, r);
    ctx.clip();
  }
  ctx.drawImage(imgCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

/**
 * Renders a video clip at the current composition frame by:
 * 1. Computing which source frame corresponds to this composition time
 * 2. Extracting (or reading from cache) that source frame
 * 3. Drawing it with the clip's transform, fit/crop and rounded corners
 *
 * Optimised to avoid per-frame Canvas allocation and ImageData copy: writes
 * the raw RGBA buffer directly into a pooled canvas via putImageData.
 */
async function drawVideoClip(
  ctx: SKRSContext2D,
  clip: VisualClip & {
    src: string;
    fit?: string;
    crop?: { x: number; y: number; width: number; height: number };
    roundedCorners?: number;
  },
  bounds: Rect,
  params: ShapeDrawParams,
  context: RenderContext,
): Promise<void> {
  const src = clip.src;

  if (!context.session.mediaCache) {
    throw new Error(
      `Video clip "${src}" requires a media cache — call setMediaCacheForRenderer() before rendering.`,
    );
  }

  const extracted = await extractVideoFrameCanvas(
    src,
    context,
    clip as VisualClip & import("../core/types/clips.js").MediaProps,
  );
  const frameCanvas = extracted.canvas;

  // Apply fit/crop
  let sx = 0,
    sy = 0,
    sw = extracted.width,
    sh = extracted.height;
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
  // Crop to the clip's own box: fit modes (cover/contain/none) compute draw
  // sizes that can exceed the bounds, so the visible region must be the box
  // itself — otherwise an overflowing frame paints over neighbouring clips.
  const bw = bounds.width;
  const bh = bounds.height;
  if (clip.roundedCorners && clip.roundedCorners > 0) {
    const r = clip.roundedCorners;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(bw - r, 0);
    ctx.arcTo(bw, 0, bw, r, r);
    ctx.lineTo(bw, bh - r);
    ctx.arcTo(bw, bh, bw - r, bh, r);
    ctx.lineTo(r, bh);
    ctx.arcTo(0, bh, 0, bh - r, r);
    ctx.lineTo(0, r);
    ctx.arcTo(0, 0, r, 0, r);
    ctx.clip();
  } else {
    ctx.beginPath();
    ctx.rect(0, 0, bw, bh);
    ctx.clip();
  }
  ctx.drawImage(frameCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

const model3dRendererCache = new Map<string, import("../model-3d/renderer.js").Model3dRenderer>();

async function drawModel3dClip(
  ctx: SKRSContext2D,
  clip: Model3dClip,
  bounds: Rect,
  params: ShapeDrawParams,
  context: RenderContext,
): Promise<void> {
  const { composition } = context;
  const { Model3dRenderer } = await import("../model-3d/renderer.js");
  const cache = context.session.model3dRendererCache;
  let renderer = cache.get(clip.src);
  if (!renderer) {
    evictOldest(cache, MAX_POOL_SIZE);
    renderer = new Model3dRenderer();
    await renderer.loadModel(clip.src);
    cache.set(clip.src, renderer);
  }

  const camera = clip.camera;
  const environment = await resolveSkyboxTexture(composition);
  const canvas = await renderer.renderFrame(context.frame, composition.fps, {
    src: clip.src,
    width: clip.width ?? bounds.width,
    height: clip.height ?? bounds.height,
    environment: environment ?? undefined,
    camera:
      camera?.orbit === true
        ? { position: [0, 0, (camera.radius ?? 5) * 2], target: [0, 0, 0] }
        : undefined,
    animation:
      camera?.orbit === true
        ? {
            type: "orbit",
            duration: composition.duration !== undefined ? Number(composition.duration) || 1 : 1,
            orbitRadius: camera.radius ?? 5,
            orbitSpeed: camera.speed ?? 0.5,
          }
        : undefined,
    lighting: clip.lighting,
    skeletal: clip.animation,
    materialOverrides: clip.materialOverrides,
  });

  ctx.save();
  if (params.transform)
    applyTransform(
      ctx,
      { ...createDefaultTransform(), ...params.transform },
      bounds.width,
      bounds.height,
    );
  ctx.drawImage(canvas, 0, 0, bounds.width, bounds.height);
  ctx.restore();
}

async function drawMultiCameraClip(
  ctx: SKRSContext2D,
  clip: MultiCameraClip,
  bounds: Rect,
  params: ShapeDrawParams,
  context: RenderContext,
): Promise<void> {
  const environment = await resolveSkyboxTexture(context.composition);
  const canvas = await renderMultiCameraFrame(clip, context.time, {
    frame: context.frame,
    fps: context.conversion.fpsFloat,
    width: Math.max(1, Math.round(clip.width ?? bounds.width)),
    height: Math.max(1, Math.round(clip.height ?? bounds.height)),
    environment: environment ?? undefined,
  });
  ctx.save();
  if (params.transform)
    applyTransform(
      ctx,
      { ...createDefaultTransform(), ...params.transform },
      bounds.width,
      bounds.height,
    );
  ctx.drawImage(canvas, 0, 0, bounds.width, bounds.height);
  ctx.restore();
}

async function drawSvgClip(
  ctx: SKRSContext2D,
  clip: SvgClip,
  bounds: Rect,
  params: ShapeDrawParams,
): Promise<void> {
  let source: string;
  if (clip.content !== undefined) {
    source = clip.content;
  } else if (clip.src !== undefined) {
    try {
      source = readFileSync(clip.src, "utf8");
    } catch (error) {
      throw createError(ErrorCode.CC2003, {
        path: clip.src,
        reason: error instanceof Error ? error.message : String(error),
      }, { fixHint: "Check the SVG path resolves inside the media root." });
    }
  } else {
    throw createError(ErrorCode.CC3007, {
      kind: "SVG clip property",
      id: clip.name ?? "unnamed",
      available: "content or src",
    }, { fixHint: "Set either `content` (inline SVG) or `src` (SVG file) on the clip." });
  }
  const element = parseSvgSource(source, clip.src ?? clip.name ?? "SVG source");
  drawSvg(
    ctx,
    element,
    bounds,
    { ...createDefaultTransform(), ...params.transform },
    params.opacity ?? 1,
  );
}

function drawParticleClip(
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

  const temp = getParticleCanvas(width, height);
  const tempCtx = createContext(temp);
  clearCanvas(tempCtx, width, height);
  renderParticles(tempCtx, state, config.blending, clip.params.debug === true ? { debugMode: true, viewport: { width, height } } : {});

  ctx.save();
  applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, width, height);
  ctx.drawImage(temp, 0, 0, width, height);
  ctx.restore();
}

function elapsedSinceClipStart(clip: ParticleClip, context: RenderContext): number {
  const span = computeClipSpan(clip, context.conversion);
  const elapsed = (context.frame - span.startFrames) / context.conversion.fpsFloat;
  return Math.max(0, elapsed);
}

function drawNoiseClip(
  ctx: SKRSContext2D,
  clip: NoiseClip,
  params: ShapeDrawParams,
  context: RenderContext,
): void {
  const width = Math.max(1, Math.round(clip.width ?? 100));
  const height = Math.max(1, Math.round(clip.height ?? 100));
  const time = context.frame / context.conversion.fpsFloat;
  const texture = getNoiseTexture(width, height, clip, time);
  ctx.save();
  applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, width, height);
  ctx.globalAlpha = params.opacity ?? 1;
  ctx.drawImage(texture, 0, 0, width, height);
  ctx.restore();
}

const FFT_WINDOW_SIZE = 2048;

function buildVisualizerLayout(
  clip: AudioVisualizerClip,
  bands: Float32Array,
  width: number,
  height: number,
): VisualizerLayout {
  const options = { barWidth: clip.barWidth, barGap: clip.barGap, mirror: clip.mirror };
  switch (clip.vizType) {
    case "bars":
      return layoutBars(bands, width, height, options);
    case "waveform":
      return layoutWaveform(bands, width, height, options);
    case "radial":
      return layoutRadial(bands, width, height, options, "radial");
    case "circular":
      return layoutRadial(bands, width, height, options, "circular");
  }
}

const smoothingState = new WeakMap<object, Float32Array>();

async function drawAudioVisualizerClip(
  ctx: SKRSContext2D,
  clip: AudioVisualizerClip,
  params: ShapeDrawParams,
  context: RenderContext,
): Promise<void> {
  const width = Math.max(1, Math.round(clip.width ?? context.width));
  const height = Math.max(1, Math.round(clip.height ?? context.height));
  const bands = await computeVisualizerBands(clip, context);
  const layout = buildVisualizerLayout(clip, bands, width, height);
  ctx.save();
  applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, width, height);
  ctx.globalAlpha = params.opacity ?? 1;
  const color = clip.fill ?? "#ffffff";
  if (layout.bars !== undefined) {
    ctx.fillStyle = color;
    for (const bar of layout.bars) {
      if (bar.height <= 0) continue;
      ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
    }
  } else if (layout.waveform !== undefined) {
    drawWaveformPath(ctx, layout.waveform, color);
  } else if (layout.radial !== undefined) {
    drawRadialLines(ctx, layout, color, width, height);
  }
  ctx.restore();
}

async function computeVisualizerBands(
  clip: AudioVisualizerClip,
  context: RenderContext,
): Promise<Float32Array> {
  const bandCount = Math.max(1, clip.barCount ?? 32);
  const empty = new Float32Array(bandCount);
  const track = resolveAudioTrack(clip.trackRef, context.composition.rootTimeline);
  if (track === undefined) {
    throw new Error(`Audio visualizer references unknown audio track: ${clip.trackRef}`);
  }
  const span = computeClipSpan(clip, context.conversion);
  const activeClip = findActiveAudioClip(
    track,
    context.frame,
    span.startFrames,
    span.endFrames,
    context.conversion,
  );
  if (activeClip === undefined) return empty;
  const buffer = await getAnalysisBuffer(activeClip.src);
  if (buffer === undefined) return empty;
  const sampleTime =
    (context.frame - span.startFrames) / context.conversion.fpsFloat +
    (typeof activeClip.trimStart === "number" ? activeClip.trimStart : 0);
  const window = extractVisualizerSample(buffer, sampleTime * buffer.sampleRate, FFT_WINDOW_SIZE);
  const mags = magnitude(fft(window));
  const bands =
    clip.frequencyScale === "logarithmic"
      ? extractBandsLogarithmic(mags, bandCount, buffer.sampleRate)
      : extractBands(mags, bandCount, buffer.sampleRate);

  if ((clip.smoothing ?? 0) > 0) {
    const previous = smoothingState.get(clip);
    const smoothed = smoothBands(bands, previous, clip.smoothing ?? 0);
    smoothingState.set(clip, smoothed);
    return smoothed;
  }
  smoothingState.delete(clip);
  return bands;
}

function findActiveAudioClip(
  track: AudioTrack,
  frame: number,
  visualizerStart: number,
  visualizerEnd: number,
  conversion: FrameConversion,
): AudioClip | undefined {
  for (const clip of track.clips) {
    if (clip.type !== "audio") continue;
    const span = computeClipSpan(clip, conversion);
    if (
      span.startFrames <= frame &&
      frame < span.endFrames &&
      span.startFrames >= visualizerStart - 1 &&
      span.endFrames <= visualizerEnd + 1
    ) {
      return clip;
    }
  }
  return undefined;
}

function drawWaveformPath(
  ctx: SKRSContext2D,
  points: readonly { x: number; y: number }[],
  color: string,
): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i]!.x, points[i]!.y);
  }
  ctx.stroke();
}

function drawRadialLines(
  ctx: SKRSContext2D,
  layout: VisualizerLayout,
  color: string,
  width: number,
  height: number,
): void {
  const radial = layout.radial;
  if (radial === undefined || radial.length === 0) return;
  const isCircular = layout.type === "circular";
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  if (isCircular) {
    ctx.beginPath();
    ctx.moveTo(radial[0]!.x, radial[0]!.y);
    for (let i = 1; i < radial.length; i += 1) {
      ctx.lineTo(radial[i]!.x, radial[i]!.y);
    }
    ctx.closePath();
    ctx.stroke();
    return;
  }
  const cx = width / 2;
  const cy = height / 2;
  for (const point of radial) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }
}

async function extractVideoFrameCanvas(
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
      throw new Error(`[CC4001] Missing video frame ${sourceFrame} of "${src}" in worker cache; shared decode service must provide all required frames.`);
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
  const rgbaBuf = getRgbaBuffer(poolKey, byteSize);
  const u8 = buffer as unknown as Uint8Array;
  rgbaBuf.set(u8);

  const frameCanvas = getVideoFrameCanvas(srcWidth, srcHeight);
  const frameCtx = frameCanvas.getContext("2d");
  const imgData = frameCtx.createImageData(srcWidth, srcHeight);
  imgData.data.set(rgbaBuf);
  frameCtx.putImageData(imgData, 0, 0);
  return { canvas: frameCanvas, width: srcWidth, height: srcHeight };
}

function getChromaKeyCanvas(width: number, height: number, session?: RenderSession): Canvas {
  return (session ?? getFallbackSession()).getChromaKeyCanvas(width, height);
}

async function drawChromaKeyClip(
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

async function drawGroupClip(
  ctx: SKRSContext2D,
  clip: VisualClip & { children: readonly VisualClip[] },
  context: RenderContext,
  seed: number,
): Promise<Canvas> {
  const bounds = getClipBounds(clip);
  const groupCanvas = getGroupCanvas(bounds.width, bounds.height);
  const groupCtx = createContext(groupCanvas);

  for (const child of clip.children) {
    if (!isAudioClip(child)) {
      await drawClip(groupCtx, child as VisualClip, context, seed);
    }
  }

  const opacity = clip.opacity ?? 1;
  if (opacity < 1) {
    const result = getGroupCanvas(bounds.width, bounds.height);
    const resultCtx = createContext(result);
    resultCtx.globalAlpha = opacity;
    resultCtx.drawImage(groupCanvas, 0, 0);
    return result;
  }

  return groupCanvas;
}

async function drawSceneClip(
  ctx: SKRSContext2D,
  clip: SceneClip,
  bounds: Rect,
  params: ShapeDrawParams,
  context: RenderContext,
  seed: number,
): Promise<void> {
  const nestedTimeline =
    clip.timeline ??
    (context.composition.scenes ? (context.composition.scenes as Record<string, Timeline>)[clip.ref] : undefined);
  if (!nestedTimeline) {
    throw createError(ErrorCode.CC3007, {
      reason: `Scene "${clip.ref}" not found in composition scenes`,
    });
  }
  const width = Math.max(1, Math.round(clip.width ?? bounds.width));
  const height = Math.max(1, Math.round(clip.height ?? bounds.height));
  const span = computeClipSpan(clip, context.conversion);
  const nestedFrame = Math.max(0, context.frame - span.startFrames);
  const nestedContext: RenderContext = {
    ...context,
    frame: nestedFrame,
    time: nestedFrame / context.conversion.fpsFloat,
    width,
    height,
  };

  const sceneCanvas = createCanvas(width, height);
  const sceneCtx = createContext(sceneCanvas);
  clearCanvas(sceneCtx, width, height);
  const clipBuffer = createCanvas(width, height);

  for (const track of nestedTimeline.tracks) {
    if (track.kind === "audio" || track.kind === "subtitle") continue;
    const ordered = track.clips
      .map((c, order) => ({ clip: c, order, span: computeClipSpan(c as Clip, context.conversion) }))
      .filter((e) => e.span.startFrames <= nestedFrame && nestedFrame < e.span.endFrames)
      .sort((a, b) => a.span.startFrames - b.span.startFrames || a.order - b.order);

    for (const { clip: nestedClip } of ordered) {
      if (isAudioClip(nestedClip as { type: string })) continue;
      const activeClip = resolveClipKeyframes(nestedClip as VisualClip, nestedFrame, context.composition.fps);
      const clipCtx = createContext(clipBuffer);
      clearCanvas(clipCtx, width, height);
      await drawClip(clipCtx, activeClip, nestedContext, seed);
      const withEffects = applyEffects(clipBuffer, activeClip, nestedContext);
      const finalCanvas = evaluateClipVisual({ clipCanvas: withEffects, clip: activeClip, context: nestedContext, underlying: null });
      const mask = getMask(activeClip, width, height);
      const matte = getMatte(activeClip, width, height);
      compositeLayers(
        sceneCtx,
        [{
          canvas: finalCanvas,
          opacity: activeClip.opacity ?? 1,
          blendMode: resolveBlendMode(activeClip.blend),
          transform: createDefaultTransform(),
          mask,
          matte,
        }],
        width,
        height,
      );
    }
  }

  ctx.save();
  if (params.transform) {
    applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, bounds.width, bounds.height);
  }
  ctx.drawImage(sceneCanvas, 0, 0, bounds.width, bounds.height);
  ctx.restore();
}

async function drawClip(
  ctx: SKRSContext2D,
  clip: VisualClip,
  context: RenderContext,
  seed: number,
): Promise<void> {
  const bounds = getClipBounds(clip);
  const transform = getClipTransform(clip, bounds.width, bounds.height);
  const opacity = clip.opacity ?? 1;
  const blendMode = resolveBlendMode(clip.blend);
  const fill = toRgba(getClipFill(clip), opacity);
  const stroke = toStroke(getClipStroke(clip));
  const shadow = toShadow(getClipShadow(clip));
  const params: ShapeDrawParams = { transform, opacity, blendMode, fill, stroke, shadow };

  const mask = getMask(clip, bounds.width, bounds.height);

  ctx.save();
  applyBlendMode(ctx, blendMode);
  ctx.globalAlpha = opacity;
  if (clip.dropShadow) {
    ctx.shadowColor = clip.dropShadow.color;
    ctx.shadowBlur = clip.dropShadow.blur;
    ctx.shadowOffsetX = clip.dropShadow.offsetX ?? 0;
    ctx.shadowOffsetY = clip.dropShadow.offsetY ?? 8;
  }

  if (mask) {
    ctx.beginPath();
    if (mask.shape.kind === "rectangle") {
      ctx.rect(mask.shape.x, mask.shape.y, mask.shape.width, mask.shape.height);
    } else if (mask.shape.kind === "ellipse") {
      ctx.ellipse(
        mask.shape.cx,
        mask.shape.cy,
        mask.shape.radiusX,
        mask.shape.radiusY,
        0,
        0,
        Math.PI * 2,
      );
    }
    if (mask.invert) {
      ctx.rect(0, 0, bounds.width, bounds.height);
      ctx.clip("evenodd");
    } else {
      ctx.clip();
    }
  }

  const hasImageFill = (clip: VisualClip): boolean => {
    if (
      clip.type === "shape" &&
      clip.fill &&
      typeof clip.fill === "object" &&
      clip.fill.type === "image"
    )
      return true;
    if (
      clip.type === "solid" &&
      clip.color &&
      typeof clip.color === "object" &&
      clip.color.type === "image"
    )
      return true;
    return false;
  };

  const drawImageFill = async (clip: VisualClip): Promise<void> => {
    let src = "";
    if (
      clip.type === "shape" &&
      clip.fill &&
      typeof clip.fill === "object" &&
      clip.fill.type === "image"
    ) {
      src = clip.fill.src;
    } else if (
      clip.type === "solid" &&
      clip.color &&
      typeof clip.color === "object" &&
      clip.color.type === "image"
    ) {
      src = clip.color.src;
    }
    if (!src) return;
    const imgCanvas = await loadCachedImage(src);
    ctx.drawImage(imgCanvas, 0, 0, bounds.width, bounds.height);
  };

  switch (clip.type) {
    case "solid": {
      if (hasImageFill(clip)) {
        await drawImageFill(clip);
      } else {
        drawRectangle(
          {
            canvas: ctx.canvas,
            ctx,
            transform: createDefaultTransform(),
            opacity: 1,
            blendMode: "source-over",
            clipPath: null,
          },
          bounds,
          { fill, transform, opacity, blendMode, stroke, shadow },
        );
      }
      break;
    }
    case "shape": {
      if (hasImageFill(clip)) {
        await drawImageFill(clip);
      } else if (clip.shapeType === "rectangle") {
        drawRectangle(
          {
            canvas: ctx.canvas,
            ctx,
            transform: createDefaultTransform(),
            opacity: 1,
            blendMode: "source-over",
            clipPath: null,
          },
          bounds,
          params,
        );
      } else if (clip.shapeType === "rounded-rectangle") {
        drawRoundedRectangle(
          {
            canvas: ctx.canvas,
            ctx,
            transform: createDefaultTransform(),
            opacity: 1,
            blendMode: "source-over",
            clipPath: null,
          },
          bounds,
          clip.radius ?? 10,
          params,
        );
      } else if (clip.shapeType === "ellipse") {
        drawEllipse(
          {
            canvas: ctx.canvas,
            ctx,
            transform: createDefaultTransform(),
            opacity: 1,
            blendMode: "source-over",
            clipPath: null,
          },
          { x: bounds.width / 2, y: bounds.height / 2 },
          bounds.width / 2,
          bounds.height / 2,
          params,
        );
      } else if (clip.shapeType === "line") {
        drawLine(
          {
            canvas: ctx.canvas,
            ctx,
            transform: createDefaultTransform(),
            opacity: 1,
            blendMode: "source-over",
            clipPath: null,
          },
          { x: 0, y: bounds.height / 2 },
          { x: bounds.width, y: bounds.height / 2 },
          params,
        );
      } else if (clip.shapeType === "polygon" && clip.points) {
        drawPolygon(
          {
            canvas: ctx.canvas,
            ctx,
            transform: createDefaultTransform(),
            opacity: 1,
            blendMode: "source-over",
            clipPath: null,
          },
          clip.points,
          params,
        );
      } else if (clip.shapeType === "path" && clip.path) {
        drawPath(
          {
            canvas: ctx.canvas,
            ctx,
            transform: createDefaultTransform(),
            opacity: 1,
            blendMode: "source-over",
            clipPath: null,
          },
          clip.path,
          params,
        );
      }
      break;
    }
    case "text": {
      const textClip = clip as VisualClip & { width?: number };
      let maxWidth = clip.maxWidth;
      if (clip.autoFit && textClip.width) {
        maxWidth = textClip.width;
      }
      const style: TextStyle = {
        fontFamily: clip.fontFamily ?? "sans-serif",
        fontWeight: clip.fontWeight ?? "normal",
        fontStyle: clip.fontStyle ?? "normal",
        fontSize: clip.fontSize,
        lineHeight: clip.lineHeight ?? 1.2,
        letterSpacing: clip.letterSpacing ?? 0,
        align: clip.align ?? "left",
        maxWidth,
        autoFit: clip.autoFit,
        fill: clip.fill ? corePaintToTextRenderer(clip.fill) : undefined,
        stroke: clip.stroke
          ? { color: toSolidRgba(clip.stroke.color, 1)!, width: clip.stroke.width }
          : undefined,
        shadow: clip.shadow
          ? {
              color: toSolidRgba(clip.shadow.color, 1)!,
              blur: clip.shadow.blur,
              offsetX: clip.shadow.offsetX ?? 0,
              offsetY: clip.shadow.offsetY ?? 0,
            }
          : undefined,
      };
      const prepared = prepareText({
        style,
        text: clip.content,
        characterAccess: clip.characterAccess,
        wordAccess: clip.wordAccess,
        lineAccess: clip.lineAccess,
      });
      applyTransform(ctx, transform, bounds.width, bounds.height);
      prepared.draw(ctx, bounds.x, bounds.y, opacity);
      break;
    }
    case "image":
      await drawImageClip(
        ctx,
        clip as VisualClip & {
          src: string;
          fit?: string;
          crop?: { x: number; y: number; width: number; height: number };
          flipped?: boolean;
          roundedCorners?: number;
        },
        bounds,
        params,
        context,
      );
      break;
    case "video":
      await drawVideoClip(
        ctx,
        clip as VisualClip & {
          src: string;
          fit?: string;
          crop?: { x: number; y: number; width: number; height: number };
          roundedCorners?: number;
        },
        bounds,
        params,
        context,
      );
      break;
    case "group": {
      const groupCanvas = await drawGroupClip(
        ctx,
        clip as VisualClip & { children: readonly VisualClip[] },
        context,
        seed,
      );
      ctx.drawImage(groupCanvas, 0, 0);
      break;
    }
    case "scene":
      await drawSceneClip(ctx, clip as SceneClip, bounds, params, context, seed);
      break;
    case "component":
      throw createError(ErrorCode.CC3007, {
        reason: `Unsupported clip type "component" (clip "${clip.name ?? "unnamed"}"): flatten the component into the timeline or render it directly`,
      });
    case "subtitle":
      await renderSubtitles(ctx, [clip as SubtitleClip], context.time, bounds.width, bounds.height);
      break;
    case "model3d":
      await drawModel3dClip(ctx, clip as Model3dClip, bounds, params, context);
      break;
    case "multiCamera":
      await drawMultiCameraClip(ctx, clip as MultiCameraClip, bounds, params, context);
      break;
    case "svg":
      await drawSvgClip(ctx, clip, bounds, params);
      break;
    case "particle":
      drawParticleClip(ctx, clip, params, context);
      break;
    case "noise":
      drawNoiseClip(ctx, clip, params, context);
      break;
    case "audioVisualizer":
      await drawAudioVisualizerClip(ctx, clip, params, context);
      break;
    case "chromakey":
      await drawChromaKeyClip(ctx, clip, bounds, params, context);
      break;
    case "dataViz": {
      const dataVizClip = clip as VisualClip & {
        data: readonly number[] | ReadonlyArray<{ label: string; value: number }>;
        chartType: "bar" | "line" | "scatter";
        colors?: readonly string[];
        showValues?: boolean;
        animDuration?: number;
      };
      drawDataVizClip(ctx, dataVizClip, bounds, params, context);
      break;
    }
    case "sticker": {
      const stickerClip = clip as VisualClip & { emoji: string; size: number; font?: string };
      drawStickerClip(ctx, stickerClip, bounds, params);
      break;
    }
    case "gradient-mesh": {
      const meshClip = clip as GradientMeshClip;
      drawGradientMeshClip(ctx, meshClip, bounds, params);
      break;
    }
    case "meshwarp":
      await drawMeshWarpClip(ctx, clip, bounds, params, context);
      break;
    case "text3d":
      drawText3dClip(ctx, clip, bounds, params);
      break;
    default: {
      const unsupported = (clip as { type: string }).type;
      throw createError(ErrorCode.CC1014, {
        kind: "clip type",
        name: unsupported,
        available: SUPPORTED_VISUAL_CLIP_TYPES.join(", "),
      });
    }
  }
  ctx.restore();
}

/** Rejected by validation before a frame; never reach the dispatch. */
export const REJECTED_CLIP_TYPES = ["component"] as const;

/** Every clip type in the union must have a draw path or a validation rejection. */
export function clipCoverageIssues(): string[] {
  const covered = new Set<string>([...SUPPORTED_VISUAL_CLIP_TYPES, ...REJECTED_CLIP_TYPES, "audio", "sound", "tts"]);
  return [...CLIP_TYPES]
    .filter((type) => !covered.has(type))
    .map((type) => `clip type "${type}" is neither renderable nor rejected at validation`);
}

export const SUPPORTED_VISUAL_CLIP_TYPES = [
  "solid",
  "shape",
  "text",
  "image",
  "video",
  "group",
  "scene",
  "model3d",
  "multiCamera",
  "svg",
  "particle",
  "noise",
  "audioVisualizer",
  "chromakey",
  "subtitle",
  "dataViz",
  "sticker",
  "gradient-mesh",
  "meshwarp",
  "text3d",
] as const;

function isAudioClip(clip: { type: string }): clip is AudioClip | SoundClip | TtsClip {
  return clip.type === "audio" || clip.type === "sound" || clip.type === "tts";
}

function clipLocation(
  composition: Composition,
  clip: VisualClip,
  context: RenderContext,
): ErrorLocation {
  const tracks = composition.rootTimeline.tracks;
  const index = tracks.findIndex((track) => (track.clips as readonly unknown[]).includes(clip));
  return {
    clip: clip.name ?? clip.type,
    track: index >= 0 ? (tracks[index]?.name ?? `track ${index}`) : undefined,
    time: `${context.time.toFixed(3)}s (frame ${context.frame})`,
  };
}

function unknownExtensionError(
  kind: "effect" | "transition",
  name: string,
  available: readonly string[],
  location: ErrorLocation,
) {
  return createError(
    ErrorCode.CC3007,
    { kind, id: name, available: available.join(", ") || "none" },
    { location },
  );
}

function applyEffects(canvas: Canvas, clip: VisualClip, context: RenderContext): Canvas {
  if (!clip.effects || clip.effects.length === 0) return canvas;
  const runtime = context.runtime ?? getDefaultRenderRuntime();
  let current = canvas;
  for (const effectRef of clip.effects) {
    if (!isEffectActive(effectRef, context)) continue;
    const effect = runtime.resolveEffect(effectRef.name);
    if (!effect) {
      throw unknownExtensionError(
        "effect",
        effectRef.name,
        runtime.listEffects(),
        clipLocation(context.composition, clip, context),
      );
    }
    const input = createEffectInput(current, createContext(current), context.time, context.seed);
    effect.apply(input, effectRef.params ?? {});
    current = input.canvas;
  }
  return current;
}

interface ClipVisualInput {
  readonly clipCanvas: Canvas;
  readonly clip: VisualClip;
  readonly context: RenderContext;
  /** Previous active clip on the same track, or null for transparent. */
  readonly underlying: Canvas | null;
}

function transitionFrames(
  transitionRef: NonNullable<VisualClip["transitionIn"]>,
  transition: { readonly defaultDuration?: number },
  conversion: RenderContext["conversion"],
): number {
  const configured = transitionRef.duration ?? transition.defaultDuration;
  if (configured === undefined) return 30;
  const seconds = typeof configured === "number" ? configured : parseFloat(configured);
  return Math.max(0, seconds * conversion.fpsFloat);
}

/**
 * Produces a clip's visual for the current frame, including entry and exit
 * transitions. Entry blends the underlying track state into the clip over the
 * clip's opening; exit blends the clip into transparency over its closing, so
 * compositing reveals whatever sits beneath and nothing leaks past the end.
 */
function evaluateClipVisual({
  clipCanvas,
  clip,
  context,
  underlying,
}: ClipVisualInput): Canvas {
  const inRef = clip.transitionIn;
  const outRef = clip.transitionOut;
  if (!inRef && !outRef) return clipCanvas;

  const runtime = context.runtime ?? getDefaultRenderRuntime();
  const span = computeClipSpan(clip, context.conversion);
  const durationFrames = Math.max(1, span.endFrames - span.startFrames);
  const resolve = (ref: NonNullable<VisualClip["transitionIn"]>) => {
    const processor = runtime.resolveTransition(ref.name);
    if (!processor) {
      throw unknownExtensionError(
        "transition",
        ref.name,
        runtime.listTransitions(),
        clipLocation(context.composition, clip, context),
      );
    }
    return processor;
  };

  const inProcessor = inRef ? resolve(inRef) : undefined;
  const outProcessor = outRef ? resolve(outRef) : undefined;
  let entryFrames = inRef && inProcessor ? transitionFrames(inRef, inProcessor, context.conversion) : 0;
  let exitFrames = outRef && outProcessor ? transitionFrames(outRef, outProcessor, context.conversion) : 0;
  if (entryFrames + exitFrames > durationFrames) {
    const factor = durationFrames / (entryFrames + exitFrames);
    entryFrames *= factor;
    exitFrames *= factor;
  }

  const inEntry = entryFrames > 0 && context.frame < span.startFrames + entryFrames;
  const exitStart = span.endFrames - exitFrames;
  const inExit = exitFrames > 0 && context.frame >= exitStart;
  if (!inEntry && !inExit) return clipCanvas;

  const { width, height } = context;
  const transparent = getTransparentCanvas(width, height);
  const bufferPair = getTransitionBuffers(width, height);
  const fromCanvas = inEntry ? (underlying ?? transparent) : clipCanvas;
  const toCanvas = inEntry ? clipCanvas : transparent;
  const resultCanvas = bufferPair[0] === fromCanvas || bufferPair[0] === toCanvas ? bufferPair[1] : bufferPair[0];
  const progress = inEntry
    ? Math.min(1, Math.max(0, (context.frame - span.startFrames) / entryFrames))
    : Math.min(1, Math.max(0, (context.frame - exitStart) / exitFrames));

  const resultCtx = createContext(resultCanvas);
  clearCanvas(resultCtx, width, height);
  const transition = inEntry ? inProcessor! : outProcessor!;
  transition.apply(
    resultCtx,
    { progress, from: fromCanvas, to: toCanvas, width, height, seed: context.seed },
    (inEntry ? inRef! : outRef!).params ?? {},
  );
  return resultCanvas;
}

export interface RenderFrameOptions {
  readonly resolutionScale?: number;
  readonly runtime?: RenderRuntime;
  /** Per-render session state; omit to use fallback session. */
  readonly session?: RenderSession;
}

function getScaledSurface(width: number, height: number, session?: RenderSession): Canvas {
  return (session ?? getFallbackSession()).getScaledSurface(width, height);
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

async function renderCompositionFrame(
  composition: Composition,
  frame: number,
  seed: number,
  runtime: RenderRuntime,
  session?: RenderSession,
): Promise<RenderResult> {
  const s = session ?? getFallbackSession();
  s.clearTempCanvases();
  const conversion = compositionConversion(composition);
  const time = frameToSeconds(frame, conversion);
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

function splitRegionClip(
  composition: Composition,
  region: { readonly track?: string; readonly clipIndex: number },
  frame: number,
  conversion: FrameConversion,
  regionIndex: number,
): VisualClip | undefined {
  const tracks = composition.rootTimeline.tracks;
  const trackIndex =
    region.track !== undefined
      ? tracks.findIndex((track) => track.name === region.track)
      : region.clipIndex;
  const track = tracks[trackIndex];
  if (!track || track.kind === "audio" || track.kind === "subtitle") {
    recordDegradation({
      code: ErrorCode.CC3007,
      what: "split-screen region source missing",
      reason: region.track !== undefined ? `no track named "${region.track}"` : `no visual track at index ${region.clipIndex}`,
      input: `region ${regionIndex}`,
      instead: "the region renders empty",
    });
    return undefined;
  }
  const active = track.clips
    .map((clip, order) => ({ clip, order, span: computeClipSpan(clip as never, conversion) }))
    .filter((entry) => entry.span.startFrames <= frame && frame < entry.span.endFrames)
    .sort((a, b) => a.span.startFrames - b.span.startFrames || a.order - b.order);
  if (active.length === 0) {
    recordDegradation({
      code: ErrorCode.CC3007,
      what: "split-screen region has no active clip",
      reason: `track "${track.name ?? region.clipIndex}" is empty at frame ${frame}`,
      input: `region ${regionIndex}`,
      instead: "the region renders empty",
    });
    return undefined;
  }
  const selected = active[active.length - 1]!;
  if (active.length > 1) {
    recordDegradation({
      code: ErrorCode.CC3007,
      what: "split-screen region has several active clips",
      reason: `track "${track.name ?? region.clipIndex}" has ${active.length} active clips at frame ${frame}`,
      input: `region ${regionIndex}`,
      instead: `topmost clip "${selected.clip.name ?? selected.clip.type}" was used`,
    });
  }
  return selected.clip;
}

export async function renderSplitScreen(
  composition: Composition,
  context: RenderContext,
  seed: number,
): Promise<RenderResult> {
  const config = composition.splitScreen;
  if (!config) {
    return renderStandardFrame(composition, context, seed);
  }
  const regionsConfig: readonly SplitRegion[] =
    config.regions !== undefined && config.regions.length > 0
      ? config.regions
      : resolveLayout(config.layout, config.padding ?? 0);
  const regions = resolveRegions(
    composition.width,
    composition.height,
    regionsConfig,
    config.padding ?? 0,
  );
  const frame = context.frame;
  const targetCanvas = getRenderTarget(composition.width, composition.height, context.session);
  const targetCtx = createContext(targetCanvas);
  clearCanvas(targetCtx, composition.width, composition.height);
  await applySkybox(targetCtx, composition);
  const [bufA] = getDrawBuffers(composition.width, composition.height, context.session);

  for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
    const region = regions[regionIndex]!;
    const clip = splitRegionClip(composition, region, frame, context.conversion, regionIndex);
    if (clip === undefined) continue;
    drawRegionShadow(targetCtx, region);
    const clipCanvas = bufA;
    const clipCtx = createContext(clipCanvas);
    clearCanvas(clipCtx, composition.width, composition.height);
    await drawClip(clipCtx, clip, context, seed);
    const withEffects = applyEffects(clipCanvas, clip, context);
    const finalCanvas = evaluateClipVisual({ clipCanvas: withEffects, clip, context, underlying: null });
    targetCtx.save();
    applyBlendMode(targetCtx, resolveBlendMode(clip.blend));
    targetCtx.globalAlpha = clip.opacity ?? 1;
    drawSourceIntoRegion(targetCtx, finalCanvas, region);
    targetCtx.restore();
  }

  await renderSubtitleTracks(targetCtx, composition, context, seed);
  applyPostProcessing(targetCtx, composition, context, seed);
  return { canvas: targetCanvas, frame, time: context.time };
}

async function renderStandardFrame(
  composition: Composition,
  context: RenderContext,
  seed: number,
  session?: RenderSessionState,
): Promise<RenderResult> {
  const frame = context.frame;
  const index = getCompositionIndex(composition, context.session);

  const targetCanvas = getRenderTarget(composition.width, composition.height, context.session);
  const targetCtx = createContext(targetCanvas);

  const activeClips = index.activeByFrame.get(frame) ?? EMPTY_CLIPS;
  const currentRects = activeClips.map(clipScreenRect);
  const previousSurface = session?.lastFrameSurface ?? null;
  const incrementalAllowed =
    session !== undefined &&
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

  if (session) {
    if (useIncremental) session.consecutiveFullRedraws = 0;
    else session.consecutiveFullRedraws += 1;
  }

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

  // Ping-pong between two reusable draw buffers instead of allocating a fresh
  // full-screen canvas per active clip. A frame can have ~70 concurrent clips;
  // allocating ~70 native 1080p canvases per frame outpaces GC (native skia
  // memory lives outside the V8 heap) and exhausted RAM → "Create skia surface
  // failed". Two buffers keep the peak at a handful of canvases while still
  // preserving the previous layer for the next clip's transitionIn: the prior
  // content always lives in the *other* buffer, which we don't clear.
  const [bufA, bufB] = getDrawBuffers(composition.width, composition.height, context.session);
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
    const opacity = activeClip.opacity ?? 1;
    const blendMode = resolveBlendMode(activeClip.blend);
    const finalCanvas = evaluateClipVisual({ clipCanvas: withEffects, clip: activeClip, context, underlying });

    const mask = getMask(activeClip, composition.width, composition.height);
    const matte = getMatte(activeClip, composition.width, composition.height);

    // Composite this layer onto the target immediately rather than collecting
    // every active clip's full-screen canvas and flushing at the end. Drawing
    // each layer as it's produced keeps peak memory to a handful of canvases,
    // and because compositeLayers applies each layer with save/restore in clip
    // order, the result is pixel-identical.
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
    // Swap buffers so the next clip's clear doesn't clobber the underlying layer.
    drawBuffer = drawBuffer === bufA ? bufB : bufA;
  }

  await renderSubtitleTracks(targetCtx, composition, context, seed);
  applyPostProcessing(targetCtx, composition, context, seed);
  if (session) {
    session.lastFrameSurface = {
      composition: composition as unknown as object,
      frame,
      rects: currentRects,
      canvas: targetCanvas,
    };
  }
  return { canvas: targetCanvas, frame, time: context.time };
}

function applyPostProcessing(
  ctx: SKRSContext2D,
  composition: Composition,
  context: RenderContext,
  seed: number,
): void {
  const config = composition.postProcessing;
  if (!config || config.previewMode === true) return;
  const effects = config.effects;
  if (!effects || effects.length === 0) return;
  const entries: EffectBatchEntry[] = [];
  for (const definition of effects) {
    if (definition.enabled === false) continue;
    const runtime = context.runtime ?? getDefaultRenderRuntime();
    const processor = runtime.resolveEffect(definition.name);
    if (!processor) {
      throw unknownExtensionError("effect", definition.name, runtime.listEffects(), {
        clip: "postProcessing",
        time: `${context.time.toFixed(3)}s (frame ${context.frame})`,
      });
    }
    const params = definition.params ?? {};
    entries.push({
      name: definition.name,
      priority: definition.priority ?? 0,
      params,
      apply: (input) => processor.apply(input, params),
    });
  }
  if (entries.length === 0) return;
  const input = createEffectInput(ctx.canvas, ctx, context.time, seed);
  try {
    createEffectGraphOptimizer().execute(input, entries);
  } catch {
    for (const entry of entries) entry.apply(input);
  }
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

async function renderSubtitleTracks(
  ctx: SKRSContext2D,
  composition: Composition,
  context: RenderContext,
  _seed: number,
): Promise<void> {
  if (composition.burnSubtitles === false) return;
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind !== "subtitle") continue;
    await renderSubtitles(
      ctx,
      track.clips as readonly SubtitleClip[],
      context.time,
      composition.width,
      composition.height,
    );
  }
}

function drawDataVizClip(
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

function drawStickerClip(
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

function drawText3dClip(
  ctx: SKRSContext2D,
  clip: Text3dClip,
  bounds: Rect,
  params: ShapeDrawParams,
): void {
  const mesh = extrudeTextGeometry(
    clip.content,
    {
      fontFamily: clip.fontFamily,
      fontSize: clip.fontSize,
      fontWeight: clip.fontWeight,
      fontStyle: clip.fontStyle,
    },
    {
      depth: clip.extrusionDepth ?? 20,
      bevel: clip.bevel === true,
      bevelDepth: clip.bevelDepth,
      maxWidth: Math.max(64, Math.round(bounds.width)),
    },
  );
  const material = createTextStyle3d(clip.frontColor ?? "#ffffff", clip.sideColor, clip.backColor);
  const scale = Math.min(1, bounds.width / Math.max(1, mesh.width));

  ctx.save();
  applyTransform(
    ctx,
    { ...createDefaultTransform(), ...params.transform },
    bounds.width,
    bounds.height,
  );
  ctx.globalAlpha = params.opacity ?? 1;
  renderTextMesh(ctx, mesh, material, {
    x: bounds.width / 2,
    y: bounds.height / 2,
    scale,
    rotationY: clip.rotationY,
    rotationX: clip.rotationX,
  });
  ctx.restore();
}

function drawGradientMeshClip(
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

async function drawMeshWarpClip(
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
