import type { SKRSContext2D } from "@napi-rs/canvas";
import type { Composition, VisualClip, SubtitleClip } from "../core/types/index.js";
import type { Rect, Transform } from "./shapes/index.js";
import { applyTransform } from "./shapes/index.js";
import { prepareText, type TextStyle } from "./text/engine.js";
import { renderSubtitles } from "../subtitles/render.js";
import { corePaintToTextRenderer, toSolidRgba } from "./shapes-render.js";
import type { RenderContext } from "./engine-types.js";

export function drawTextClip(
  ctx: SKRSContext2D,
  clip: VisualClip,
  bounds: Rect,
  transform: Transform,
  opacity: number,
): void {
  const textClip = clip as VisualClip & {
    width?: number;
    fontFamily?: string;
    fontWeight?: string | number;
    fontStyle?: string;
    fontSize: number;
    lineHeight?: number;
    letterSpacing?: number;
    align?: "left" | "center" | "right";
    maxWidth?: number;
    autoFit?: boolean;
    content: string;
    characterAccess?: boolean;
    wordAccess?: boolean;
    lineAccess?: boolean;
    fill?: unknown;
    stroke?: { color: string; width: number };
    shadow?: { color: string; blur: number; offsetX?: number; offsetY?: number };
  };
  let maxWidth = textClip.maxWidth;
  if (textClip.autoFit && textClip.width) {
    maxWidth = textClip.width;
  }
  const style: TextStyle = {
    fontFamily: textClip.fontFamily ?? "sans-serif",
    fontWeight: textClip.fontWeight ?? "normal",
    fontStyle: textClip.fontStyle ?? "normal",
    fontSize: textClip.fontSize,
    lineHeight: textClip.lineHeight ?? 1.2,
    letterSpacing: textClip.letterSpacing ?? 0,
    align: textClip.align ?? "left",
    maxWidth,
    autoFit: textClip.autoFit,
    fill: textClip.fill ? corePaintToTextRenderer(textClip.fill as never) : undefined,
    stroke: textClip.stroke
      ? { color: toSolidRgba(textClip.stroke.color, 1)!, width: textClip.stroke.width }
      : undefined,
    shadow: textClip.shadow
      ? {
          color: toSolidRgba(textClip.shadow.color, 1)!,
          blur: textClip.shadow.blur,
          offsetX: textClip.shadow.offsetX ?? 0,
          offsetY: textClip.shadow.offsetY ?? 0,
        }
      : undefined,
  };
  const prepared = prepareText({
    style,
    text: textClip.content,
    characterAccess: textClip.characterAccess,
    wordAccess: textClip.wordAccess,
    lineAccess: textClip.lineAccess,
  });
  applyTransform(ctx, transform, bounds.width, bounds.height);
  prepared.draw(ctx, bounds.x, bounds.y, opacity);
}

export async function renderSubtitleTracks(
  ctx: SKRSContext2D,
  composition: Composition,
  context: RenderContext,
  _seed: number,
): Promise<void> {
  if (composition.burnSubtitles === false) return;
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind !== "subtitle") continue;
    if (track.muted === true) continue;
    await renderSubtitles(
      ctx,
      track.clips as readonly SubtitleClip[],
      context.time,
      composition.width,
      composition.height,
    );
  }
}
