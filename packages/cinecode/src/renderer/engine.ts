import { Canvas, loadImage } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import type { Composition, VisualClip, AudioClip, SoundClip, EffectRef, VideoClip, SvgClip, ParticleClip, NoiseClip, AudioTrack, AudioVisualizerClip, ChromaKeyClip, Clip, GradientMeshClip, MeshWarpClip, Model3dClip, Text3dClip, MultiCameraClip } from "../core/types/index.js";
import type { FrameConversion } from "../core/time/index.js";
import { createConversion, createVfrConversion, frameToSeconds } from "../core/time/index.js";
import { computeClipSpan, validateTimeline } from "../core/validation/index.js";
import { extractFramesInMemory, type ExtractedFrame } from "../media/frames.js";
import {
  calculateSourceFrame,
  type ConformParams,
} from "../media/conform.js";
import type { Rgba, Gradient } from "./color/types.js";
import { parseColor } from "./color/index.js";
import type { BlendMode, ShapeDrawParams, Transform, Rect } from "./shapes/primitives.js";
import { createDefaultTransform, applyBlendMode, applyTransform } from "./shapes/primitives.js";
import { drawRectangle, drawRoundedRectangle, drawEllipse, drawLine, drawPolygon, drawPath } from "./shapes/draw.js";
import type { TextStyle } from "./text/engine.js";
import { prepareText, checkMissingGlyphs } from "./text/engine.js";
import type { CompositedLayer, Mask, Matte } from "./composite/engine.js";
import { createCanvas, createContext, clearCanvas, compositeLayers } from "./composite/engine.js";
import { createEffectInput, clearEffectCache } from "../effects/engine.js";
import { resolveEffect, resolveTransition, listTransitions } from "../extensions/index.js";
import { UnknownTransitionError } from "../transitions/engine.js";
import { parseSvgSource } from "../svg/parser.js";
import { drawSvg } from "../svg/renderer.js";
import { resolveEmitterConfig } from "../particles/types.js";
import { getParticleContext, updateParticleContext } from "../particles/context.js";
import { renderParticles } from "../particles/render.js";
import { generateNoiseTexture } from "../noise/generator.js";
import {
  layoutBars, layoutWaveform, layoutRadial, resolveAudioTrack, smoothBands,
  type VisualizerLayout,
} from "../audio/visualizer.js";
import { getAnalysisBuffer, extractVisualizerSample, setVisualizerMediaCache } from "../audio/visualizerSample.js";
import { fft, magnitude, extractBands, extractBandsLogarithmic } from "../audio/fft.js";
import { chromaKeyEffect } from "../effects/chroma-key.js";
import { renderSubtitles } from "../subtitles/render.js";
import type { SubtitleClip } from "../core/types/index.js";
import { layoutChart, interpolateChartData, drawChart, drawNoData } from "../dataviz/index.js";
import { drawSticker } from "../stickers/index.js";
import { drawMeshGradient, generateRegularAnchors, type MeshAnchor } from "../gradients/index.js";
import { createWarpGrid, applyWarpDisplacements, computeAnimatedWarp, applyWarp, isIdentityWarp } from "../warp/index.js";
import { extrudeTextGeometry } from "../text-3d/mesh.js";
import { createTextStyle3d } from "../text-3d/material.js";
import { renderTextMesh } from "../text-3d/render.js";
import { resolveRegions, resolveLayout, drawRegionShadow, drawSourceIntoRegion, type SplitRegion } from "./pip.js";
import { loadCubeMap, loadEquirectangular } from "../model-3d/environment/cubeMap.js";
import { createProceduralSkybox, renderSkybox } from "../model-3d/environment/skybox.js";
import type { CubeTexture } from "../model-3d/environment/cubeMap.js";
import { resolveGlobalEffect } from "./postprocess/resolve.js";
import { createEffectGraphOptimizer, type EffectBatchEntry } from "./postprocess/batch.js";
import { computeDirtyRect, isFullFrameRect, rectArea, rectsOverlap, transformedAabb } from "./layout/engine.js";
import { clampResolutionScale, scaleComposition } from "./scale.js";
import { renderMultiCameraFrame } from "./multi-camera.js";


export interface RenderContext {
  readonly composition: Composition;
  readonly conversion: FrameConversion;
  readonly frame: number;
  readonly time: number;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly background: string | Rgba | Gradient;
}

export interface RenderResult {
  readonly canvas: Canvas;
  readonly frame: number;
  readonly time: number;
}

const imageCache = new Map<string, Canvas>();

/**
 * Per-thread RGBA buffers cached by resolution to avoid reallocating on every
 * frame. A 1920×1080 buffer is 8 MB — with many active clips and frequent
 * draws the previous approach (creating a Canvas + ImageData per frame) was
 * exhausting skia's native heap. Each worker thread now keeps one 1920×1080
 * RGBA buffer and reuses it across all video-frame draws in a chunk.
 */
const rgbaBufferCache = new Map<string, Uint8ClampedArray>();

function getRgbaBuffer(resolution: string, byteSize: number): Uint8ClampedArray {
  let buf = rgbaBufferCache.get(resolution);
  if (!buf || buf.length !== byteSize) {
    buf = new Uint8ClampedArray(byteSize);
    rgbaBufferCache.set(resolution, buf);
  }
  return buf;
}

/**
 * In-memory video frame cache. Frames are raw RGBA (a 720×1280 source is
 * 3.7MB each), so the cache is a small LRU: a worker renders chunks in source
 * order, and `primeVideoFramesForRange` seeds the chunk's frames right before
 * they are drawn, so a handful of slots is enough and a full-length video can
 * never pin gigabytes of heap.
 */
const VIDEO_FRAME_CACHE_MAX = 512;
const videoFrameCache = new Map<string, ExtractedFrame>();
const videoFrameOrigin = new Map<string, string>();

/** Module-level media cache for video frame extraction (set by pipeline). */
let _mediaCache: import("../media/cache.js").MediaCache | null = null;

/** Set the media cache for video frame extraction. Called by the pipeline. */
export function setMediaCacheForRenderer(cache: import("../media/cache.js").MediaCache): void {
  _mediaCache = cache;
  setVisualizerMediaCache(cache);
}

function videoFrameKey(src: string, sourceFrame: number): string {
  return `${src}@${sourceFrame}`;
}

function rememberVideoFrame(src: string, sourceFrame: number, frame: ExtractedFrame): void {
  const key = videoFrameKey(src, sourceFrame);
  videoFrameCache.delete(key);
  if (videoFrameCache.size >= VIDEO_FRAME_CACHE_MAX) {
    const oldest = videoFrameCache.keys().next().value;
    if (oldest !== undefined) {
      videoFrameCache.delete(oldest);
      videoFrameOrigin.delete(oldest);
    }
  }
  videoFrameCache.set(key, frame);
  videoFrameOrigin.set(key, src);
}

function recallVideoFrame(src: string, sourceFrame: number): ExtractedFrame | undefined {
  const key = videoFrameKey(src, sourceFrame);
  const cached = videoFrameCache.get(key);
  if (!cached) return undefined;
  // Refresh recency so LRU eviction drops the coldest frame first.
  videoFrameCache.delete(key);
  videoFrameCache.set(key, cached);
  return cached;
}

/** Most recently drawn frame for `src` — a safe fallback when a seek fails. */
function latestVideoFrame(src: string): ExtractedFrame | undefined {
  const keys = Array.from(videoFrameOrigin.keys()).reverse();
  for (const key of keys) {
    if (videoFrameOrigin.get(key) === src) {
      const frame = videoFrameCache.get(key);
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
): Promise<void> {
  if (!_mediaCache || frames.length === 0) return;

  const seen = new Set<string>();
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind === "audio") continue;
    for (const clip of track.clips) {
      if (clip.type !== "video") continue;
      const src = clip.src;
      if (!src || seen.has(src)) continue;
      seen.add(src);

      const metadata = await getVideoMetadata(src, _mediaCache);
      if (!metadata) continue;
      const clampedMax = maxSourceFrameOf(metadata);

      const media = clip as import("../core/types/clips.js").VideoClip;
      const trimStart = typeof media.trimStart === "number" ? media.trimStart : parseFloat(media.trimStart as string);
      const trimEnd = typeof media.trimEnd === "number" ? media.trimEnd : parseFloat(media.trimEnd as string);
      const conformParams: ConformParams = {
        trim: !isNaN(trimStart) || !isNaN(trimEnd)
          ? { trimStart: isNaN(trimStart) ? 0 : trimStart, trimEnd: isNaN(trimEnd) ? 0 : trimEnd }
          : undefined,
        speed: media.speed !== undefined || media.reverse !== undefined
          ? { speed: media.speed ?? 1, reverse: media.reverse ?? false }
          : undefined,
      };

      const sourceFrames = frames.map((frame) =>
        Math.min(
          clampedMax,
          calculateSourceFrame(frame, metadata, { fps: composition.fps, width: composition.width, height: composition.height }, conformParams),
        ),
      );
      const first = Math.min(...sourceFrames);
      const last = Math.max(...sourceFrames);
      if (first > last) continue;

      // Avoid priming scattered frames (heavy trim/speed ramps) — only
      // contiguous runs make sense for a single decode pass.
      if (last - first + 1 > frames.length * 5) continue;
      if (videoFrameCache.has(videoFrameKey(src, first)) && videoFrameCache.has(videoFrameKey(src, last))) continue;

      try {
        const extracted = await extractFramesInMemory(src, first, last - first + 1, undefined, metadata.fps);
        for (let i = 0; i < extracted.length; i++) {
          rememberVideoFrame(src, first + i, extracted[i]!);
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
  /** frame -> clips active on that frame, in track/clip order. */
  readonly activeByFrame: Map<number, VisualClip[]>;
  readonly validated: boolean;
}
const indexCache = new WeakMap<object, CompositionIndex>();
const EMPTY_CLIPS: VisualClip[] = [];

/**
 * Two reusable full-screen draw buffers, ping-ponged per clip inside
 * `renderFrame`. Rendering is one-frame-at-a-time per thread, so a single
 * size-keyed pair is enough; reusing them across frames removes the
 * per-clip native allocation that previously exhausted skia's heap.
 */
const drawBufferCache = new Map<string, [Canvas, Canvas]>();
function getDrawBuffers(width: number, height: number): [Canvas, Canvas] {
  const key = `${width}x${height}`;
  let pair = drawBufferCache.get(key);
  if (!pair) {
    pair = [createCanvas(width, height), createCanvas(width, height)];
    drawBufferCache.set(key, pair);
  }
  return pair;
}

/** Pooled full-screen canvas for renderFrame output — one per resolution. */
const renderTargetCache = new Map<string, Canvas>();
function getRenderTarget(width: number, height: number): Canvas {
  const key = `${width}x${height}`;
  let c = renderTargetCache.get(key);
  if (!c) {
    c = createCanvas(width, height);
    renderTargetCache.set(key, c);
  }
  return c;
}

/** Pooled canvas for group clips — keyed by bounds size. */
const groupCanvasCache = new Map<string, Canvas>();
function getGroupCanvas(width: number, height: number): Canvas {
  const key = `${width}x${height}`;
  let c = groupCanvasCache.get(key);
  if (!c) {
    c = createCanvas(width, height);
    groupCanvasCache.set(key, c);
  }
  return c;
}

/** Pooled canvas for transition blending — one per resolution. */
interface FrameSurfaceState {
  readonly composition: object;
  readonly frame: number;
  readonly rects: readonly Rect[];
  readonly canvas: Canvas;
}

let lastFrameSurface: FrameSurfaceState | null = null;

const DIRTY_RECT_AREA_LIMIT = 0.6;

function clipScreenRect(clip: VisualClip): Rect {
  const bounds = getClipBounds(clip);
  return transformedAabb(bounds, getClipTransform(clip, bounds.width, bounds.height));
}

function fillBackgroundRegion(ctx: SKRSContext2D, rect: Rect, background: string | Rgba | Gradient): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (typeof background === "string") {
    ctx.fillStyle = background;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  } else if ("r" in background) {
    ctx.fillStyle = `rgba(${background.r}, ${background.g}, ${background.b}, ${background.a})`;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  } else {
    ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
  }
  ctx.restore();
}

function hasSubtitleTracks(composition: Composition): boolean {
  return composition.rootTimeline.tracks.some((track) => track.kind === "subtitle");
}

const transitionCanvasCache = new Map<string, Canvas>();
function getTransitionCanvas(width: number, height: number): Canvas {
  const key = `${width}x${height}`;
  let c = transitionCanvasCache.get(key);
  if (!c) {
    c = createCanvas(width, height);
    transitionCanvasCache.set(key, c);
  }
  return c;
}

/** Pooled canvas for particle clips — keyed by bounds size. */
const particleCanvasCache = new Map<string, Canvas>();
function getParticleCanvas(width: number, height: number): Canvas {
  const key = `${width}x${height}`;
  let c = particleCanvasCache.get(key);
  if (!c) {
    c = createCanvas(width, height);
    particleCanvasCache.set(key, c);
  }
  return c;
}

/** Cached generated noise textures keyed by params and 10fps time bucket. */
const NOISE_CACHE_MAX = 32;
const noiseTextureCache = new Map<string, Canvas>();

function getNoiseTexture(width: number, height: number, clip: NoiseClip, time: number): Canvas {
  const bucket = Math.floor(time * 10);
  const key = `${width}x${height}-${clip.params.kind}-${clip.params.dimensions}-${clip.params.scale}-${clip.params.offsetX ?? 0}-${clip.params.offsetY ?? 0}-${clip.params.animationSpeed ?? 0}-${clip.params.seed ?? 0}-${clip.params.outputType ?? "luminance"}-${bucket}`;
  let canvas = noiseTextureCache.get(key);
  if (canvas === undefined) {
    if (noiseTextureCache.size >= NOISE_CACHE_MAX) {
      noiseTextureCache.clear();
    }
    canvas = generateNoiseTexture(width, height, { ...clip.params, time: bucket / 10 });
    noiseTextureCache.set(key, canvas);
  }
  return canvas;
}

const skyboxCache = new Map<string, Promise<CubeTexture>>();

function resolveSkyboxTexture(composition: Composition): Promise<CubeTexture> | null {
  const config = composition.skybox;
  if (!config) return null;
  const key = JSON.stringify(config);
  const cached = skyboxCache.get(key);
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
  skyboxCache.set(key, loading);
  return loading;
}

async function applySkybox(ctx: SKRSContext2D, composition: Composition): Promise<CubeTexture | null> {
  const texture = await resolveSkyboxTexture(composition);
  if (!texture) return null;
  renderSkybox(ctx, texture, composition.width, composition.height, {
    exposure: composition.skybox?.exposure,
    yaw: composition.skybox?.yaw,
    pitch: composition.skybox?.pitch,
  });
  return texture;
}

export function compositionConversion(composition: Composition): FrameConversion {
  return composition.tempo && composition.tempo.length > 0
    ? createVfrConversion(composition.tempo, composition.fps)
    : createConversion(composition.fps);
}

function buildCompositionIndex(composition: Composition): CompositionIndex {
  const conversion = compositionConversion(composition);
  const activeByFrame = new Map<number, VisualClip[]>();
  let totalFrames = 0;

  for (const track of composition.rootTimeline.tracks) {
    if (track.kind === "audio") continue;
    for (const clip of track.clips) {
      const span = computeClipSpan(clip as never, conversion);
      if (span.endFrames > totalFrames) totalFrames = span.endFrames;
      for (let f = span.startFrames; f < span.endFrames; f++) {
        let bucket = activeByFrame.get(f);
        if (!bucket) { bucket = []; activeByFrame.set(f, bucket); }
        bucket.push(clip);
      }
    }
  }

  if (composition.duration !== undefined) {
    const dur = typeof composition.duration === "number"
      ? composition.duration
      : parseFloat(composition.duration as string);
    const durFrames = Math.ceil(dur * conversion.fpsFloat);
    totalFrames = composition.boundaryBehavior === "extend"
      ? Math.max(totalFrames, durFrames)
      : durFrames;
  }

  return { totalFrames, activeByFrame, validated: false };
}

function getCompositionIndex(composition: Composition): CompositionIndex {
  let index = indexCache.get(composition as unknown as object);
  if (!index) {
    index = buildCompositionIndex(composition);
    indexCache.set(composition as unknown as object, index);
  }
  return index;
}

async function loadCachedImage(src: string): Promise<Canvas> {
  if (imageCache.has(src)) return imageCache.get(src)!;
  const img = await loadImage(src);
  const canvas = new Canvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  imageCache.set(src, canvas);
  return canvas;
}

function corePaintToRenderer(paint: string | { type: string; color?: string; stops?: readonly { color: string; offset: number }[]; angle?: number; center?: { x: number; y: number }; radius?: number; src?: string } | undefined): string | Rgba | Gradient | Canvas | undefined {
  if (!paint) return undefined;
  if (typeof paint === "string") return paint;
  if (paint.type === "solid") return parseColor(paint.color ?? "#000000");
  if (paint.type === "linear") {
    return {
      type: "linear",
      angle: paint.angle ?? 0,
      stops: (paint.stops ?? []).map(s => ({ offset: s.offset, color: parseColor(s.color) })),
    };
  }
  if (paint.type === "radial") {
    return {
      type: "radial",
      centerX: paint.center?.x ?? 0.5,
      centerY: paint.center?.y ?? 0.5,
      radius: paint.radius ?? 0.5,
      stops: (paint.stops ?? []).map(s => ({ offset: s.offset, color: parseColor(s.color) })),
    };
  }
  if (paint.type === "conic") {
    return {
      type: "conic",
      angle: paint.angle ?? 0,
      centerX: paint.center?.x ?? 0.5,
      centerY: paint.center?.y ?? 0.5,
      stops: (paint.stops ?? []).map(s => ({ offset: s.offset, color: parseColor(s.color) })),
    };
  }
  if (paint.type === "image") {
    const src = paint.src ?? "";
    if (src) {
      const cached = imageCache.get(src);
      if (cached) return cached;
    }
    return "#000000";
  }
  return "#000000";
}

function corePaintToTextRenderer(paint: string | { type: string; color?: string; stops?: readonly { color: string; offset: number }[]; angle?: number; center?: { x: number; y: number }; radius?: number; src?: string } | undefined): Rgba | Gradient | undefined {
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
    anchorX: (t.anchor === "top-left" || t.anchor === "left" || t.anchor === "bottom-left") ? 0 :
             (t.anchor === "top-right" || t.anchor === "right" || t.anchor === "bottom-right") ? 1 : 0.5,
    anchorY: (t.anchor === "top-left" || t.anchor === "top" || t.anchor === "top-right") ? 0 :
             (t.anchor === "bottom-left" || t.anchor === "bottom" || t.anchor === "bottom-right") ? 1 : 0.5,
  };
}

function getClipBounds(clip: VisualClip): Rect {
  if (clip.type === "shape" || clip.type === "solid") {
    return { x: 0, y: 0, width: clip.width ?? 100, height: clip.height ?? 100 };
  }
  if (clip.type === "text") {
    return { x: 0, y: 0, width: clip.maxWidth ?? 200, height: clip.fontSize * (clip.lineHeight ?? 1.2) };
  }
  if (clip.type === "text3d") {
    return { x: 0, y: 0, width: clip.width ?? 600, height: clip.height ?? clip.fontSize * 1.5 };
  }
  if (clip.type === "image" || clip.type === "video" || clip.type === "svg" || clip.type === "noise" || clip.type === "audioVisualizer" || clip.type === "chromakey" || clip.type === "gradient-mesh") {
    const imageClip = clip as VisualClip & { width?: number; height?: number };
    return { x: 0, y: 0, width: imageClip.width ?? 100, height: imageClip.height ?? 100 };
  }
  return { x: 0, y: 0, width: 100, height: 100 };
}

function toRgba(color: string | Rgba | Gradient | undefined, opacity: number): Rgba | Gradient | undefined {
  if (!color) return undefined;
  if (typeof color === "string") { const p = parseColor(color); return { ...p, a: p.a * opacity }; }
  if ("r" in color) return { ...color, a: color.a * opacity };
  return { ...color, stops: color.stops.map(s => ({ ...s, color: { ...s.color, a: s.color.a * opacity } })) };
}

function toSolidRgba(color: string | Rgba | Gradient | undefined, opacity: number): Rgba | undefined {
  if (!color) return undefined;
  if (typeof color === "string") { const p = parseColor(color); return { ...p, a: p.a * opacity }; }
  if ("r" in color) return { ...color, a: color.a * opacity };
  return undefined;
}

function toStroke(stroke: { color: string | Rgba; width: number; lineCap?: string; lineJoin?: string; dashes?: readonly number[]; dashOffset?: number } | undefined): ShapeDrawParams["stroke"] | undefined {
  if (!stroke) return undefined;
  const color = typeof stroke.color === "string" ? parseColor(stroke.color) : stroke.color;
  return { color, width: stroke.width, lineCap: (stroke.lineCap as "butt" | "round" | "square") ?? "butt", lineJoin: (stroke.lineJoin as "miter" | "round" | "bevel") ?? "miter", dashArray: stroke.dashes ?? [], dashOffset: stroke.dashOffset ?? 0 };
}

function toShadow(shadow: { color: string | Rgba; blur: number; offsetX?: number; offsetY?: number } | undefined): ShapeDrawParams["shadow"] | undefined {
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

function getClipStroke(clip: VisualClip): { color: string | Rgba; width: number; lineCap?: string; lineJoin?: string; dashes?: readonly number[]; dashOffset?: number } | undefined {
  if (clip.type === "text") {
    return clip.stroke as { color: string | Rgba; width: number; lineCap?: string; lineJoin?: string; dashes?: readonly number[]; dashOffset?: number } | undefined;
  }
  if (clip.type === "shape") {
    return clip.stroke as { color: string | Rgba; width: number; lineCap?: string; lineJoin?: string; dashes?: readonly number[]; dashOffset?: number } | undefined;
  }
  return undefined;
}

function getClipShadow(clip: VisualClip): { color: string | Rgba; blur: number; offsetX?: number; offsetY?: number } | undefined {
  if (clip.type === "text") {
    return clip.shadow as { color: string | Rgba; blur: number; offsetX?: number; offsetY?: number } | undefined;
  }
  if (clip.type === "shape") {
    return clip.shadow as { color: string | Rgba; blur: number; offsetX?: number; offsetY?: number } | undefined;
  }
  return undefined;
}

function isEffectActive(effectRef: EffectRef, context: RenderContext): boolean {
  if (effectRef.enabled === false) return false;
  const conversion = context.conversion;
  if (effectRef.from !== undefined) {
    const startFrame = typeof effectRef.from === "number" ? effectRef.from : parseFloat(effectRef.from as string) * conversion.fpsFloat;
    if (context.frame < startFrame) return false;
  }
  if (effectRef.to !== undefined) {
    const endFrame = typeof effectRef.to === "number" ? effectRef.to : parseFloat(effectRef.to as string) * conversion.fpsFloat;
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
      shape: { kind: "rectangle", x: mask.shape.x, y: mask.shape.y, width: mask.shape.width, height: mask.shape.height },
      invert: mask.invert ?? false,
    };
  }
  if (mask.shape.kind === "ellipse") {
    return {
      kind: "shape",
      shape: { kind: "ellipse", cx: mask.shape.cx, cy: mask.shape.cy, radiusX: mask.shape.radiusX, radiusY: mask.shape.radiusY },
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
const videoFrameCanvasPool = new Map<string, Canvas>();
function getVideoFrameCanvas(width: number, height: number): Canvas {
  const key = `${width}x${height}`;
  let c = videoFrameCanvasPool.get(key);
  if (!c) {
    c = new Canvas(width, height);
    videoFrameCanvasPool.set(key, c);
  }
  return c;
}

async function drawImageClip(ctx: SKRSContext2D, clip: VisualClip & { src: string; fit?: string; crop?: { x: number; y: number; width: number; height: number }; flipped?: boolean; roundedCorners?: number }, bounds: Rect, params: ShapeDrawParams, _context: RenderContext): Promise<void> {
  const imgCanvas = await loadCachedImage(clip.src);
  const imgWidth = imgCanvas.width;
  const imgHeight = imgCanvas.height;

  let sx = 0, sy = 0, sw = imgWidth, sh = imgHeight;
  if (clip.crop) {
    sx = clip.crop.x;
    sy = clip.crop.y;
    sw = clip.crop.width;
    sh = clip.crop.height;
  }

  let dx = 0, dy = 0, dw = bounds.width, dh = bounds.height;
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
  if (params.transform) applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, bounds.width, bounds.height);
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
  clip: VisualClip & { src: string; fit?: string; crop?: { x: number; y: number; width: number; height: number }; roundedCorners?: number },
  bounds: Rect,
  params: ShapeDrawParams,
  context: RenderContext,
): Promise<void> {
  const src = clip.src;

  if (!_mediaCache) {
    throw new Error(`Video clip "${src}" requires a media cache — call setMediaCacheForRenderer() before rendering.`);
  }

  const extracted = await extractVideoFrameCanvas(src, context, clip as VisualClip & import("../core/types/clips.js").MediaProps);
  const frameCanvas = extracted.canvas;

  // Apply fit/crop
  let sx = 0, sy = 0, sw = extracted.width, sh = extracted.height;
  if (clip.crop) {
    sx = clip.crop.x;
    sy = clip.crop.y;
    sw = clip.crop.width;
    sh = clip.crop.height;
  }

  let dx = 0, dy = 0, dw = bounds.width, dh = bounds.height;
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
  if (params.transform) applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, bounds.width, bounds.height);
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
  let renderer = model3dRendererCache.get(clip.src);
  if (!renderer) {
    renderer = new Model3dRenderer();
    await renderer.loadModel(clip.src);
    model3dRendererCache.set(clip.src, renderer);
  }

  const camera = clip.camera;
  const environment = await resolveSkyboxTexture(composition);
  const canvas = await renderer.renderFrame(context.frame, composition.fps, {
    src: clip.src,
    width: clip.width ?? bounds.width,
    height: clip.height ?? bounds.height,
    environment: environment ?? undefined,
    camera: camera?.orbit === true
      ? { position: [0, 0, (camera.radius ?? 5) * 2], target: [0, 0, 0] }
      : undefined,
    animation: camera?.orbit === true
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
  if (params.transform) applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, bounds.width, bounds.height);
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
  if (params.transform) applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, bounds.width, bounds.height);
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
    source = readFileSync(clip.src, "utf8");
  } else {
    throw new Error("SVG clip requires either 'content' or 'src' property");
  }
  const element = parseSvgSource(source);
  drawSvg(ctx, element, bounds, { ...createDefaultTransform(), ...params.transform }, params.opacity ?? 1);
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
  const state = updateParticleContext(particleContext, elapsed, context.frame, config, { width, height });

  const temp = getParticleCanvas(width, height);
  const tempCtx = createContext(temp);
  clearCanvas(tempCtx, width, height);
  renderParticles(tempCtx, state, config.blending);

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

function buildVisualizerLayout(clip: AudioVisualizerClip, bands: Float32Array, width: number, height: number): VisualizerLayout {
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

async function computeVisualizerBands(clip: AudioVisualizerClip, context: RenderContext): Promise<Float32Array> {
  const bandCount = Math.max(1, clip.barCount ?? 32);
  const empty = new Float32Array(bandCount);
  const track = resolveAudioTrack(clip.trackRef, context.composition.rootTimeline);
  if (track === undefined) {
    throw new Error(`Audio visualizer references unknown audio track: ${clip.trackRef}`);
  }
  const span = computeClipSpan(clip, context.conversion);
  const activeClip = findActiveAudioClip(track, context.frame, span.startFrames, span.endFrames, context.conversion);
  if (activeClip === undefined) return empty;
  const buffer = await getAnalysisBuffer(activeClip.src);
  if (buffer === undefined) return empty;
  const sampleTime = (context.frame - span.startFrames) / context.conversion.fpsFloat
    + (typeof activeClip.trimStart === "number" ? activeClip.trimStart : 0);
  const window = extractVisualizerSample(buffer, sampleTime * buffer.sampleRate, FFT_WINDOW_SIZE);
  const mags = magnitude(fft(window));
  const bands = clip.frequencyScale === "logarithmic"
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

function findActiveAudioClip(track: AudioTrack, frame: number, visualizerStart: number, visualizerEnd: number, conversion: FrameConversion): AudioClip | undefined {
  for (const clip of track.clips) {
    if (clip.type !== "audio") continue;
    const span = computeClipSpan(clip, conversion);
    if (span.startFrames <= frame && frame < span.endFrames && span.startFrames >= visualizerStart - 1 && span.endFrames <= visualizerEnd + 1) {
      return clip;
    }
  }
  return undefined;
}

function drawWaveformPath(ctx: SKRSContext2D, points: readonly { x: number; y: number }[], color: string): void {
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

function drawRadialLines(ctx: SKRSContext2D, layout: VisualizerLayout, color: string, width: number, height: number): void {
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
  mediaProps: { readonly trimStart?: number | string; readonly trimEnd?: number | string; readonly speed?: number; readonly reverse?: boolean },
): Promise<{ canvas: Canvas; width: number; height: number }> {
  const { composition, frame } = context;
  const metadata = await getVideoMetadata(src, _mediaCache!);
  if (!metadata) {
    throw new Error(`Could not read video metadata for "${src}" — check the path and that the file is a valid video.`);
  }

  const trimStart = typeof mediaProps.trimStart === "number" ? mediaProps.trimStart : parseFloat(mediaProps.trimStart as string);
  const trimEnd = typeof mediaProps.trimEnd === "number" ? mediaProps.trimEnd : parseFloat(mediaProps.trimEnd as string);
  const conformParams: ConformParams = {
    trim: !isNaN(trimStart) || !isNaN(trimEnd)
      ? { trimStart: isNaN(trimStart) ? 0 : trimStart, trimEnd: isNaN(trimEnd) ? 0 : trimEnd }
      : undefined,
    speed: mediaProps.speed !== undefined || mediaProps.reverse !== undefined
      ? { speed: mediaProps.speed ?? 1, reverse: mediaProps.reverse ?? false }
      : undefined,
  };

  const sourceFrame = Math.min(
    maxSourceFrameOf(metadata),
    calculateSourceFrame(frame, metadata, { fps: composition.fps, width: composition.width, height: composition.height }, conformParams),
  );

  let extractedFrame = recallVideoFrame(src, sourceFrame);
  if (!extractedFrame) {
    let decoded: ExtractedFrame[] | null;
    try {
      decoded = await extractFramesInMemory(src, sourceFrame, 1, { width: metadata.width, height: metadata.height }, metadata.fps);
    } catch {
      decoded = null;
    }
    const first = decoded && decoded.length > 0 ? decoded[0] : undefined;
    if (first) {
      rememberVideoFrame(src, sourceFrame, first);
      extractedFrame = first;
    } else {
      extractedFrame = latestVideoFrame(src);
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

const chromaKeyCanvasCache = new Map<string, Canvas>();
function getChromaKeyCanvas(width: number, height: number): Canvas {
  const key = `${width}x${height}`;
  let c = chromaKeyCanvasCache.get(key);
  if (!c) {
    c = createCanvas(width, height);
    chromaKeyCanvasCache.set(key, c);
  }
  return c;
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
  const isVideo = _mediaCache !== null && (await getVideoMetadata(src, _mediaCache)) !== null;
  if (isVideo) {
    const extracted = await extractVideoFrameCanvas(src, context, clip as { trimStart?: number | string });
    sourceCanvas = extracted.canvas;
    srcWidth = extracted.width;
    srcHeight = extracted.height;
  } else {
    const imgCanvas = await loadCachedImage(src);
    srcWidth = imgCanvas.width;
    srcHeight = imgCanvas.height;
    sourceCanvas = getChromaKeyCanvas(srcWidth, srcHeight);
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

  let sx = 0, sy = 0, sw = srcWidth, sh = srcHeight;
  if (clip.crop) {
    sx = clip.crop.x;
    sy = clip.crop.y;
    sw = clip.crop.width;
    sh = clip.crop.height;
  }

  let dx = 0, dy = 0, dw = bounds.width, dh = bounds.height;
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
  if (params.transform) applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, bounds.width, bounds.height);
  ctx.beginPath();
  ctx.rect(0, 0, bounds.width, bounds.height);
  ctx.clip();
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

function drawGroupClip(ctx: SKRSContext2D, clip: VisualClip & { children: readonly VisualClip[] }, context: RenderContext, seed: number): Canvas {
  const bounds = getClipBounds(clip);
  const groupCanvas = getGroupCanvas(bounds.width, bounds.height);
  const groupCtx = createContext(groupCanvas);

  for (const child of clip.children) {
    if (!isAudioClip(child)) {
      drawClip(groupCtx, child as VisualClip, context, seed);
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

async function drawClip(ctx: SKRSContext2D, clip: VisualClip, context: RenderContext, seed: number): Promise<void> {
  const bounds = getClipBounds(clip);
  const transform = getClipTransform(clip, bounds.width, bounds.height);
  const opacity = (clip.opacity ?? 1);
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
      ctx.ellipse(mask.shape.cx, mask.shape.cy, mask.shape.radiusX, mask.shape.radiusY, 0, 0, Math.PI * 2);
    }
    if (mask.invert) {
      ctx.rect(0, 0, bounds.width, bounds.height);
      ctx.clip("evenodd");
    } else {
      ctx.clip();
    }
  }

  const hasImageFill = (clip: VisualClip): boolean => {
    if (clip.type === "shape" && clip.fill && typeof clip.fill === "object" && clip.fill.type === "image") return true;
    if (clip.type === "solid" && clip.color && typeof clip.color === "object" && clip.color.type === "image") return true;
    return false;
  };

  const drawImageFill = async (clip: VisualClip): Promise<void> => {
    let src = "";
    if (clip.type === "shape" && clip.fill && typeof clip.fill === "object" && clip.fill.type === "image") {
      src = clip.fill.src;
    } else if (clip.type === "solid" && clip.color && typeof clip.color === "object" && clip.color.type === "image") {
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
        drawRectangle({ canvas: ctx.canvas, ctx, transform: createDefaultTransform(), opacity: 1, blendMode: "source-over", clipPath: null },
          bounds, { fill, transform, opacity, blendMode, stroke, shadow });
      }
      break;
    }
    case "shape": {
      if (hasImageFill(clip)) {
        await drawImageFill(clip);
      } else if (clip.shapeType === "rectangle") {
        drawRectangle({ canvas: ctx.canvas, ctx, transform: createDefaultTransform(), opacity: 1, blendMode: "source-over", clipPath: null }, bounds, params);
      } else if (clip.shapeType === "rounded-rectangle") {
        drawRoundedRectangle({ canvas: ctx.canvas, ctx, transform: createDefaultTransform(), opacity: 1, blendMode: "source-over", clipPath: null }, bounds, clip.radius ?? 10, params);
      } else if (clip.shapeType === "ellipse") {
        drawEllipse({ canvas: ctx.canvas, ctx, transform: createDefaultTransform(), opacity: 1, blendMode: "source-over", clipPath: null }, { x: bounds.width / 2, y: bounds.height / 2 }, bounds.width / 2, bounds.height / 2, params);
      } else if (clip.shapeType === "line") {
        drawLine({ canvas: ctx.canvas, ctx, transform: createDefaultTransform(), opacity: 1, blendMode: "source-over", clipPath: null }, { x: 0, y: bounds.height / 2 }, { x: bounds.width, y: bounds.height / 2 }, params);
      } else if (clip.shapeType === "polygon" && clip.points) {
        drawPolygon({ canvas: ctx.canvas, ctx, transform: createDefaultTransform(), opacity: 1, blendMode: "source-over", clipPath: null }, clip.points, params);
      } else if (clip.shapeType === "path" && clip.path) {
        drawPath({ canvas: ctx.canvas, ctx, transform: createDefaultTransform(), opacity: 1, blendMode: "source-over", clipPath: null }, clip.path, params);
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
        stroke: clip.stroke ? { color: toSolidRgba(clip.stroke.color, 1)!, width: clip.stroke.width } : undefined,
        shadow: clip.shadow ? { color: toSolidRgba(clip.shadow.color, 1)!, blur: clip.shadow.blur, offsetX: clip.shadow.offsetX ?? 0, offsetY: clip.shadow.offsetY ?? 0 } : undefined,
      };
      const prepared = prepareText({ style, text: clip.content, characterAccess: clip.characterAccess, wordAccess: clip.wordAccess, lineAccess: clip.lineAccess });
      const missing = checkMissingGlyphs(clip.content, style);
      if (missing.length > 0) {
        console.warn(`CC3006: Missing glyphs in text clip: ${missing.join(", ")}`);
      }
      applyTransform(ctx, transform, bounds.width, bounds.height);
      prepared.draw(ctx, bounds.x, bounds.y, opacity);
      break;
    }
    case "image":
      await drawImageClip(ctx, clip as VisualClip & { src: string; fit?: string; crop?: { x: number; y: number; width: number; height: number }; flipped?: boolean; roundedCorners?: number }, bounds, params, context);
      break;
    case "video":
      await drawVideoClip(ctx, clip as VisualClip & { src: string; fit?: string; crop?: { x: number; y: number; width: number; height: number }; roundedCorners?: number }, bounds, params, context);
      break;
    case "group": {
      const groupCanvas = await drawGroupClip(ctx, clip as VisualClip & { children: readonly VisualClip[] }, context, seed);
      ctx.drawImage(groupCanvas, 0, 0);
      break;
    }
    case "scene":
    case "component":
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
  }
  ctx.restore();
}

function isAudioClip(clip: { type: string }): clip is AudioClip | SoundClip {
  return clip.type === "audio" || clip.type === "sound";
}

function applyEffects(canvas: Canvas, clip: VisualClip, context: RenderContext): Canvas {
  if (!clip.effects || clip.effects.length === 0) return canvas;
  let current = canvas;
  for (const effectRef of clip.effects) {
    if (!isEffectActive(effectRef, context)) continue;
    const effect = resolveEffect(effectRef.name);
    if (!effect) continue;
    const input = createEffectInput(current, createContext(current), context.time, context.seed);
    effect.apply(input, effectRef.params ?? {});
    current = input.canvas;
  }
  return current;
}

function applyTransition(fromCanvas: Canvas, toCanvas: Canvas, transitionRef: VisualClip["transitionIn"], context: RenderContext, width: number, height: number, clip: VisualClip): Canvas {
  if (!transitionRef) return toCanvas;
  const transition = resolveTransition(transitionRef.name);
  if (!transition) throw new UnknownTransitionError(transitionRef.name, listTransitions());

  const conversion = context.conversion;
  const configuredDuration = transitionRef.duration ?? transition.defaultDuration;
  const duration = configuredDuration !== undefined
    ? typeof configuredDuration === "number"
      ? configuredDuration * conversion.fpsFloat
      : parseFloat(configuredDuration) * conversion.fpsFloat
    : 30;
  const clipStart = computeClipSpan({ ...clip, start: 0, duration: 0 } as VisualClip, conversion);
  const progress = Math.min(1, Math.max(0, (context.frame - clipStart.startFrames) / duration));

  const resultCanvas = getTransitionCanvas(width, height);
  const resultCtx = createContext(resultCanvas);
  const transitionContext = { progress, from: fromCanvas, to: toCanvas, width, height, seed: context.seed };
  transition.apply(resultCtx, transitionContext, transitionRef.params ?? {});
  return resultCanvas;
}

export interface RenderFrameOptions {
  readonly resolutionScale?: number;
}

export async function renderFrame(
  composition: Composition,
  frame: number,
  seed: number,
  options: RenderFrameOptions = {},
): Promise<RenderResult> {
  const scale = options.resolutionScale === undefined ? 1 : clampResolutionScale(options.resolutionScale);
  const target = scale === 1 ? composition : scaleComposition(composition, scale);
  return renderCompositionFrame(target, frame, seed);
}

async function renderCompositionFrame(composition: Composition, frame: number, seed: number): Promise<RenderResult> {
  // Clear effect cache each frame so parametric effects (DoF, bloom) stay fresh
  clearEffectCache();
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
  };
  if (composition.splitScreen) {
    return renderSplitScreen(composition, context, seed);
  }
  return renderStandardFrame(composition, context, seed);
}

export async function renderSplitScreen(composition: Composition, context: RenderContext, seed: number): Promise<RenderResult> {
  const config = composition.splitScreen;
  if (!config) {
    return renderStandardFrame(composition, context, seed);
  }
  const regionsConfig: readonly SplitRegion[] = config.regions !== undefined && config.regions.length > 0
    ? config.regions
    : resolveLayout(config.layout, config.padding ?? 0);
  const regions = resolveRegions(composition.width, composition.height, regionsConfig, config.padding ?? 0);
  const frame = context.frame;
  const index = getCompositionIndex(composition);
  const targetCanvas = getRenderTarget(composition.width, composition.height);
  const targetCtx = createContext(targetCanvas);
  clearCanvas(targetCtx, composition.width, composition.height);
  await applySkybox(targetCtx, composition);
  const activeClips = [...(index.activeByFrame.get(frame) ?? EMPTY_CLIPS)];
  const [bufA] = getDrawBuffers(composition.width, composition.height);

  for (const region of regions) {
    const clip = activeClips[region.clipIndex];
    if (clip === undefined) continue;
    drawRegionShadow(targetCtx, region);
    const clipCanvas = bufA;
    const clipCtx = createContext(clipCanvas);
    clearCanvas(clipCtx, composition.width, composition.height);
    await drawClip(clipCtx, clip, context, seed);
    const withEffects = applyEffects(clipCanvas, clip, context);
    targetCtx.save();
    applyBlendMode(targetCtx, resolveBlendMode(clip.blend));
    targetCtx.globalAlpha = clip.opacity ?? 1;
    drawSourceIntoRegion(targetCtx, withEffects, region);
    targetCtx.restore();
  }

  await renderSubtitleTracks(targetCtx, composition, context, seed);
  applyPostProcessing(targetCtx, composition, context, seed);
  return { canvas: targetCanvas, frame, time: context.time };
}

async function renderStandardFrame(composition: Composition, context: RenderContext, seed: number): Promise<RenderResult> {
  const frame = context.frame;
  const timeline = composition.rootTimeline;
  // Validate once per composition (not per frame) — validation walks every
  // clip/track and is identical across frames.
  const index = getCompositionIndex(composition);
  if (!index.validated) {
    const validation = validateTimeline(timeline, {
      conversion: context.conversion,
      compositionWidth: composition.width,
      compositionHeight: composition.height,
      durationFrames: index.totalFrames,
      boundaryBehavior: composition.boundaryBehavior,
    });
    for (const issue of validation) {
      console.warn(`[${issue.code}] ${issue.message}`);
    }
    (index as { validated: boolean }).validated = true;
  }

  const targetCanvas = getRenderTarget(composition.width, composition.height);
  const targetCtx = createContext(targetCanvas);

  const activeClips = index.activeByFrame.get(frame) ?? EMPTY_CLIPS;
  const currentRects = activeClips.map(clipScreenRect);
  const previousSurface = lastFrameSurface;
  const incrementalAllowed =
    previousSurface !== null &&
    previousSurface.composition === (composition as unknown as object) &&
    previousSurface.canvas === targetCanvas &&
    previousSurface.frame === frame - 1 &&
    composition.skybox === undefined &&
    (composition.postProcessing?.effects?.length ?? 0) === 0 &&
    !hasSubtitleTracks(composition) &&
    activeClips.every((clip) => clip.transitionIn === undefined && clip.transitionOut === undefined);
  const dirtyRect = incrementalAllowed && previousSurface
    ? computeDirtyRect(previousSurface.rects, currentRects, composition.width, composition.height, 2)
    : null;
  const useIncremental = dirtyRect !== null &&
    !isFullFrameRect(dirtyRect, composition.width, composition.height) &&
    rectArea(dirtyRect) <= composition.width * composition.height * DIRTY_RECT_AREA_LIMIT;

  if (useIncremental && dirtyRect) {
    fillBackgroundRegion(targetCtx, dirtyRect, context.background);
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
  const [bufA, bufB] = getDrawBuffers(composition.width, composition.height);
  let drawBuffer: Canvas = bufA;
  let previousLayerCanvas: Canvas | null = null;

  for (const clip of activeClips) {
    if (compositeClip && !rectsOverlap(clipScreenRect(clip), compositeClip)) continue;
    const clipCanvas = drawBuffer;
    const clipCtx = createContext(clipCanvas);
    clearCanvas(clipCtx, composition.width, composition.height);
    await drawClip(clipCtx, clip, context, seed);
    const withEffects = applyEffects(clipCanvas, clip, context);
    const opacity = clip.opacity ?? 1;
    const blendMode = resolveBlendMode(clip.blend);

    let finalCanvas = withEffects;
    if (clip.transitionIn && previousLayerCanvas) {
      finalCanvas = applyTransition(previousLayerCanvas, withEffects, clip.transitionIn, context, composition.width, composition.height, clip);
    }

    const mask = getMask(clip, composition.width, composition.height);
    const matte = getMatte(clip, composition.width, composition.height);

    // Composite this layer onto the target immediately rather than collecting
    // every active clip's full-screen canvas and flushing at the end. Drawing
    // each layer as it's produced keeps peak memory to a handful of canvases,
    // and because compositeLayers applies each layer with save/restore in clip
    // order, the result is pixel-identical.
    compositeLayers(
      targetCtx,
      [{ canvas: finalCanvas, opacity, blendMode, transform: createDefaultTransform(), mask, matte }],
      composition.width,
      composition.height,
      compositeClip ?? undefined,
    );

    previousLayerCanvas = finalCanvas;
    // Swap buffers so the next clip's clear doesn't clobber previousLayerCanvas.
    drawBuffer = drawBuffer === bufA ? bufB : bufA;
  }

  await renderSubtitleTracks(targetCtx, composition, context, seed);
  applyPostProcessing(targetCtx, composition, context, seed);
  lastFrameSurface = { composition: composition as unknown as object, frame, rects: currentRects, canvas: targetCanvas };
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
    const processor = resolveGlobalEffect(definition.name);
    if (!processor) continue;
    const params = definition.params ?? {};
    entries.push({
      name: definition.name,
      priority: definition.priority ?? 0,
      params,
      apply: (input) => processor.apply(input, params),
    });
  }
  if (entries.length === 0) return;
  createEffectGraphOptimizer().execute(createEffectInput(ctx.canvas, ctx, context.time, seed), entries);
}

export async function renderStill(composition: Composition, frame: number, seed: number = 0): Promise<Canvas> {
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
    await renderSubtitles(ctx, track.clips as readonly SubtitleClip[], context.time, composition.width, composition.height);
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
  const progress = animDuration <= 0 ? 1 : Math.min(1, (context.time - span.startFrames / context.conversion.fpsFloat) / animDuration);
  const layout = layoutChart(clip.data, clip.chartType, bounds.width, bounds.height, { showValues: clip.showValues });
  const animated = interpolateChartData(layout, progress);

  ctx.save();
  applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, bounds.width, bounds.height);
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
  applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, bounds.width, bounds.height);
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
  applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, bounds.width, bounds.height);
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
  const anchors = clip.anchors.length > 0
    ? clip.anchors
    : generateRegularAnchors(Math.max(1, clip.gridCols), Math.max(1, clip.gridRows), ["#2196f3", "#4caf50", "#ff9800", "#e91e63"]);
  ctx.save();
  applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, bounds.width, bounds.height);
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
  const metadata = _mediaCache !== null ? await getVideoMetadata(src, _mediaCache) : null;
  if (metadata !== null) {
    const extracted = await extractVideoFrameCanvas(src, context, clip as { trimStart?: number | string });
    sourceCanvas = extracted.canvas;
  } else {
    sourceCanvas = await loadCachedImage(src);
  }

  const cols = Math.max(1, Math.round(clip.cols));
  const rows = Math.max(1, Math.round(clip.rows));
  const grid = clip.animated === true
    ? computeAnimatedWarp(context.time, cols, rows, sourceCanvas.width, sourceCanvas.height)
    : applyWarpDisplacements(createWarpGrid(cols, rows, sourceCanvas.width, sourceCanvas.height), clip.warpPoints ?? []);

  ctx.save();
  applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, bounds.width, bounds.height);
  ctx.beginPath();
  ctx.rect(0, 0, bounds.width, bounds.height);
  ctx.clip();
  ctx.globalAlpha = params.opacity ?? 1;
  if (isIdentityWarp(grid)) {
    ctx.drawImage(sourceCanvas, 0, 0, bounds.width, bounds.height);
  } else {
    const warped = applyWarp(sourceCanvas, grid, Math.round(bounds.width), Math.round(bounds.height));
    ctx.drawImage(warped, 0, 0, bounds.width, bounds.height);
  }
  ctx.restore();
}
