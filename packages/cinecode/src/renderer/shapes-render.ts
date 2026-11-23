import { Canvas } from "@napi-rs/canvas";
import type { Composition, VisualClip, SceneClip } from "../core/types/index.js";
import type { Rgba, Gradient } from "./color/types.js";
import { parseColor } from "./color/index.js";
import type { BlendMode, ShapeDrawParams, Transform, Rect } from "./shapes/index.js";
import type { Mask, Matte } from "./composite/engine.js";
import { transformedAabb } from "./layout/engine.js";
import { getFallbackSession } from "./session.js";
import { UNBOUNDED_CLIP_TYPES } from "./engine-types.js";

export function corePaintToRenderer(
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

export function corePaintToTextRenderer(
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

export function getClipTransform(clip: VisualClip, _width: number, _height: number): Transform {
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

export function getClipBounds(clip: VisualClip): Rect {
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

export function toRgba(
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

export function toSolidRgba(
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

export function toStroke(
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

export function toShadow(
  shadow: { color: string | Rgba; blur: number; offsetX?: number; offsetY?: number } | undefined,
): ShapeDrawParams["shadow"] | undefined {
  if (!shadow) return undefined;
  const color = typeof shadow.color === "string" ? parseColor(shadow.color) : shadow.color;
  return { color, blur: shadow.blur, offsetX: shadow.offsetX ?? 0, offsetY: shadow.offsetY ?? 0 };
}

export function resolveBlendMode(blend: VisualClip["blend"]): BlendMode {
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

export function getClipFill(clip: VisualClip): string | Rgba | Gradient | undefined {
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

export function getClipStroke(clip: VisualClip):
  | {
      color: string | Rgba;
      width: number;
      lineCap?: string;
      lineJoin?: string;
      dashes?: readonly number[];
      dashOffset?: number;
    }
  | undefined {
  if (clip.type === "text" || clip.type === "shape") {
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

export function getClipShadow(
  clip: VisualClip,
): { color: string | Rgba; blur: number; offsetX?: number; offsetY?: number } | undefined {
  if (clip.type === "text" || clip.type === "shape") {
    return clip.shadow as
      { color: string | Rgba; blur: number; offsetX?: number; offsetY?: number } | undefined;
  }
  return undefined;
}

export function getMask(clip: VisualClip, _width: number, _height: number): Mask | undefined {
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

export function getMatte(clip: VisualClip, _width: number, _height: number): Matte | undefined {
  if (!clip.matte) return undefined;
  return { kind: clip.matte.kind, source: null as unknown as Canvas };
}

export function isIncrementallySafe(clip: VisualClip): boolean {
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

export function clipScreenRect(clip: VisualClip): Rect {
  const bounds = getClipBounds(clip);
  return transformedAabb(bounds, getClipTransform(clip, bounds.width, bounds.height));
}

export function hasSubtitleTracks(composition: Composition): boolean {
  return composition.rootTimeline.tracks.some((track) => track.kind === "subtitle");
}


