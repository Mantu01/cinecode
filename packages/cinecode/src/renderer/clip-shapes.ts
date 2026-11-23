import type { SKRSContext2D } from "@napi-rs/canvas";
import type { VisualClip } from "../core/types/index.js";
import type { Rect, ShapeDrawParams } from "./shapes/index.js";
import {
  createDefaultTransform,
  drawRectangle,
  drawRoundedRectangle,
  drawEllipse,
  drawLine,
  drawPolygon,
  drawPath,
} from "./shapes/index.js";
import { loadCachedImage } from "./video-cache.js";

export async function drawSolidOrShapeClip(
  ctx: SKRSContext2D,
  clip: VisualClip,
  bounds: Rect,
  params: ShapeDrawParams,
): Promise<void> {
  const hasImageFill = (c: VisualClip): boolean => {
    if (c.type === "shape" && c.fill && typeof c.fill === "object" && c.fill.type === "image") return true;
    if (c.type === "solid" && c.color && typeof c.color === "object" && c.color.type === "image") return true;
    return false;
  };

  const drawImageFill = async (c: VisualClip): Promise<void> => {
    let src = "";
    if (c.type === "shape" && c.fill && typeof c.fill === "object" && c.fill.type === "image") {
      src = c.fill.src ?? "";
    } else if (c.type === "solid" && c.color && typeof c.color === "object" && c.color.type === "image") {
      src = c.color.src ?? "";
    }
    if (!src) return;
    const imgCanvas = await loadCachedImage(src);
    ctx.drawImage(imgCanvas, 0, 0, bounds.width, bounds.height);
  };

  if (clip.type === "solid") {
    if (hasImageFill(clip)) {
      await drawImageFill(clip);
    } else {
      drawRectangle(
        { canvas: ctx.canvas, ctx, transform: createDefaultTransform(), opacity: 1, blendMode: "source-over", clipPath: null },
        bounds,
        params,
      );
    }
    return;
  }

  if (clip.type === "shape") {
    if (hasImageFill(clip)) {
      await drawImageFill(clip);
    } else if (clip.shapeType === "rectangle") {
      drawRectangle(
        { canvas: ctx.canvas, ctx, transform: createDefaultTransform(), opacity: 1, blendMode: "source-over", clipPath: null },
        bounds,
        params,
      );
    } else if (clip.shapeType === "rounded-rectangle") {
      drawRoundedRectangle(
        { canvas: ctx.canvas, ctx, transform: createDefaultTransform(), opacity: 1, blendMode: "source-over", clipPath: null },
        bounds,
        clip.radius ?? 10,
        params,
      );
    } else if (clip.shapeType === "ellipse") {
      drawEllipse(
        { canvas: ctx.canvas, ctx, transform: createDefaultTransform(), opacity: 1, blendMode: "source-over", clipPath: null },
        { x: bounds.width / 2, y: bounds.height / 2 },
        bounds.width / 2,
        bounds.height / 2,
        params,
      );
    } else if (clip.shapeType === "line") {
      drawLine(
        { canvas: ctx.canvas, ctx, transform: createDefaultTransform(), opacity: 1, blendMode: "source-over", clipPath: null },
        { x: 0, y: bounds.height / 2 },
        { x: bounds.width, y: bounds.height / 2 },
        params,
      );
    } else if (clip.shapeType === "polygon" && clip.points) {
      drawPolygon(
        { canvas: ctx.canvas, ctx, transform: createDefaultTransform(), opacity: 1, blendMode: "source-over", clipPath: null },
        clip.points,
        params,
      );
    } else if (clip.shapeType === "path" && clip.path) {
      drawPath(
        { canvas: ctx.canvas, ctx, transform: createDefaultTransform(), opacity: 1, blendMode: "source-over", clipPath: null },
        clip.path,
        params,
      );
    }
  }
}
