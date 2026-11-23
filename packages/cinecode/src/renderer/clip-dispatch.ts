import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import type {
  VisualClip,
  SceneClip,
  Timeline,
  Clip,
  AudioClip,
  SoundClip,
  TtsClip,
  SubtitleClip,
  Model3dClip,
  MultiCameraClip,
  GradientMeshClip,
  MeshWarpClip,
  Text3dClip,
} from "../core/types/index.js";
import { computeClipSpan, CLIP_TYPES } from "../core/validation/index.js";
import { resolveClipKeyframes } from "../core/keyframes/engine.js";
import { createError, ErrorCode } from "../errors/index.js";
import { applyBlendMode, applyTransform, createDefaultTransform, type ShapeDrawParams, type Rect } from "./shapes/index.js";
import { createCanvas, createContext, clearCanvas, compositeLayers } from "./composite/engine.js";
import { renderSubtitles } from "../subtitles/render.js";
import { getFallbackSession } from "./session.js";
import {
  type RenderContext,
  REJECTED_CLIP_TYPES,
  SUPPORTED_VISUAL_CLIP_TYPES,
} from "./engine-types.js";
import {
  getClipBounds,
  getClipTransform,
  resolveBlendMode,
  toRgba,
  toStroke,
  toShadow,
  getClipFill,
  getClipStroke,
  getClipShadow,
  getMask,
  getMatte,
} from "./shapes-render.js";
import { drawSolidOrShapeClip } from "./clip-shapes.js";
import { drawImageClip, drawVideoClip, drawSvgClip } from "./clip-visual.js";
import { drawTextClip } from "./clip-text.js";
import { drawModel3dClip, drawMultiCameraClip, drawText3dClip } from "./clip-3d.js";
import { drawAudioVisualizerClip } from "./clip-audio-reactive.js";
import {
  drawParticleClip,
  drawNoiseClip,
  drawChromaKeyClip,
  drawDataVizClip,
  drawStickerClip,
  drawGradientMeshClip,
  drawMeshWarpClip,
} from "./clip-generators.js";
import { applyEffects, evaluateClipVisual } from "./clip-effects.js";

export function isAudioClip(clip: { type: string }): clip is AudioClip | SoundClip | TtsClip {
  return clip.type === "audio" || clip.type === "sound" || clip.type === "tts";
}

export async function drawGroupClip(
  ctx: SKRSContext2D,
  clip: VisualClip & { children: readonly VisualClip[] },
  context: RenderContext,
  seed: number,
): Promise<Canvas> {
  const bounds = getClipBounds(clip);
  const groupCanvas = (context.session ?? getFallbackSession()).getGroupCanvas(bounds.width, bounds.height);
  const groupCtx = createContext(groupCanvas);

  for (const child of clip.children) {
    if (!isAudioClip(child)) {
      await drawClip(groupCtx, child as VisualClip, context, seed);
    }
  }

  const opacity = clip.opacity ?? 1;
  if (opacity < 1) {
    const result = (context.session ?? getFallbackSession()).getGroupCanvas(bounds.width, bounds.height);
    const resultCtx = createContext(result);
    resultCtx.globalAlpha = opacity;
    resultCtx.drawImage(groupCanvas, 0, 0);
    return result;
  }

  return groupCanvas;
}

export async function drawSceneClip(
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
  const speed = nestedTimeline.speed ?? 1;
  const offsetSeconds = typeof nestedTimeline.offset === "number"
    ? nestedTimeline.offset
    : typeof nestedTimeline.offset === "string"
      ? parseFloat(nestedTimeline.offset) || 0
      : 0;
  const offsetFrames = Math.round(offsetSeconds * context.conversion.fpsFloat);
  const nestedFrame = Math.max(0, Math.floor((context.frame - span.startFrames) * speed) + offsetFrames);
  const nestedContext: RenderContext = {
    ...context,
    frame: nestedFrame,
    time: (nestedFrame / context.conversion.fpsFloat) * speed + offsetSeconds,
    width,
    height,
  };

  const sceneCanvas = createCanvas(width, height);
  const sceneCtx = createContext(sceneCanvas);
  clearCanvas(sceneCtx, width, height);
  const clipBuffer = createCanvas(width, height);

  for (const track of nestedTimeline.tracks) {
    if (track.kind === "audio" || track.kind === "subtitle") continue;
    if (track.muted === true) continue;
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
      const trackOpacity = typeof track.opacity === "number" ? track.opacity : 1;
      compositeLayers(
        sceneCtx,
        [{
          canvas: finalCanvas,
          opacity: (activeClip.opacity ?? 1) * trackOpacity,
          blendMode: resolveBlendMode(activeClip.blend ?? track.blend),
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

export async function drawClip(
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

  switch (clip.type) {
    case "solid":
    case "shape":
      await drawSolidOrShapeClip(ctx, clip, bounds, params);
      break;
    case "text":
      drawTextClip(ctx, clip, bounds, transform, opacity);
      break;
    case "image":
      await drawImageClip(ctx, clip as VisualClip & { src: string }, bounds, params, context);
      break;
    case "video":
      await drawVideoClip(ctx, clip as VisualClip & { src: string }, bounds, params, context);
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
    case "dataViz":
      drawDataVizClip(ctx, clip as never, bounds, params, context);
      break;
    case "sticker":
      drawStickerClip(ctx, clip as never, bounds, params);
      break;
    case "gradient-mesh":
      drawGradientMeshClip(ctx, clip as GradientMeshClip, bounds, params);
      break;
    case "meshwarp":
      await drawMeshWarpClip(ctx, clip as MeshWarpClip, bounds, params, context);
      break;
    case "text3d":
      drawText3dClip(ctx, clip as Text3dClip, bounds, params);
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

export function clipCoverageIssues(): string[] {
  const covered = new Set<string>([...SUPPORTED_VISUAL_CLIP_TYPES, ...REJECTED_CLIP_TYPES, "audio", "sound", "tts"]);
  return [...CLIP_TYPES]
    .filter((type) => !covered.has(type))
    .map((type) => `clip type "${type}" is neither renderable nor rejected at validation`);
}
