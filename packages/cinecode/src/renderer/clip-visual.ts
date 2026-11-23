import { readFileSync } from "node:fs";
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { VisualClip, SvgClip } from "../core/types/index.js";
import type { Rect, ShapeDrawParams } from "./shapes/index.js";
import { createDefaultTransform, applyTransform } from "./shapes/index.js";
import { createError, ErrorCode } from "../errors/index.js";
import { parseSvgSource } from "../svg/parser.js";
import { drawSvg } from "../svg/renderer.js";
import type { RenderContext } from "./engine-types.js";
import { loadCachedImage, extractVideoFrameCanvas } from "./video-cache.js";

export async function drawImageClip(
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

export async function drawVideoClip(
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

export async function drawSvgClip(
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
      }, {
        location: { clip: clip.name ?? "svg" },
        fixHint: "Check the SVG path resolves inside the media root.",
      });
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
