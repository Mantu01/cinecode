import type { SKRSContext2D } from "@napi-rs/canvas";
import { parseColor } from "../renderer/color/parse.js";
import type { Rgba } from "../renderer/color/types.js";
import { prepareText, type TextStyle } from "../renderer/text/engine.js";
import type { SubtitleClip } from "../core/types/clips.js";
import type { SubtitleEntry, SubtitleCueStyle } from "./parser.js";
import { getSubtitleEntries } from "./cache.js";
import { parseVttCueStyles } from "./parser.js";
import { readFile } from "node:fs/promises";

export interface SubtitleDisplayState {
  readonly visible: boolean;
  readonly progress: number;
  readonly displayText: string;
}

const FADE_SECONDS = 0.2;

export function computeSubtitleDisplay(entry: SubtitleEntry, currentTime: number, charReveal = false): SubtitleDisplayState {
  const visible = currentTime >= entry.startTime && currentTime < entry.endTime;
  if (!visible) {
    return { visible: false, progress: 0, displayText: "" };
  }
  const duration = Math.max(1e-6, entry.endTime - entry.startTime);
  const progress = Math.min(1, Math.max(0, (currentTime - entry.startTime) / duration));
  const displayText = charReveal ? entry.text.slice(0, Math.ceil(progress * entry.text.length)) : entry.text;
  return { visible: true, progress, displayText };
}

export interface SubtitleRenderStyle {
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly fillColor: string;
  readonly strokeColor: string;
  readonly strokeWidth: number;
  readonly outline: boolean;
  readonly align: "left" | "center" | "right";
  readonly position: "bottom" | "top" | "custom";
  readonly customY?: number;
}

export function subtitleRenderStyle(
  clip: SubtitleClip,
  cueStyle: SubtitleCueStyle | undefined,
): SubtitleRenderStyle {
  const style = clip.style ?? {};
  return {
    fontSize: style.fontSize ?? 36,
    fontFamily: style.fontFamily ?? "sans-serif",
    fillColor: style.fillColor ?? cueStyle?.color ?? "#ffffff",
    strokeColor: style.strokeColor ?? "#000000",
    strokeWidth: style.strokeWidth ?? 2,
    outline: style.outline ?? true,
    align: cueStyle?.align ?? "center",
    position: clip.position ?? "bottom",
    customY: clip.customY,
  };
}

export function renderSubtitle(
  ctx: SKRSContext2D,
  entry: SubtitleEntry,
  bounds: { readonly width: number; readonly height: number },
  style: SubtitleRenderStyle,
  currentTime: number,
  charReveal = false,
  yOffset = 0,
): void {
  const display = computeSubtitleDisplay(entry, currentTime, charReveal);
  if (!display.visible) return;
  const opacity = fadeOpacity(entry, currentTime);
  if (opacity <= 0) return;

  const textStyle = buildTextStyle(entry, style, bounds.width);
  const prepared = prepareText({ style: textStyle, text: display.displayText });
  const x = alignOffset(prepared.metrics.width, style.align, bounds.width);
  const y = verticalOffset(style, bounds.height, prepared.metrics.height) + yOffset;
  prepared.draw(ctx, x, y, opacity);
}

function fadeOpacity(entry: SubtitleEntry, currentTime: number): number {
  const fadeIn = Math.min(1, (currentTime - entry.startTime) / FADE_SECONDS);
  const fadeOut = Math.min(1, (entry.endTime - currentTime) / FADE_SECONDS);
  return Math.max(0, Math.min(fadeIn, fadeOut));
}

function buildTextStyle(entry: SubtitleEntry, style: SubtitleRenderStyle, width: number): TextStyle {
  const raw = entry.rawText ?? "";
  const weight: number | string = /<b\b/i.test(raw) ? "bold" : "normal";
  const italic = /<i\b/i.test(raw) ? "italic" : "normal";
  const fill = parseColor(style.fillColor);
  const stroke: TextStyle["stroke"] = style.outline
    ? { color: rgbaWithAlpha(parseColor(style.strokeColor), 1), width: style.strokeWidth }
    : undefined;
  return {
    fontFamily: style.fontFamily,
    fontWeight: weight,
    fontStyle: italic,
    fontSize: style.fontSize,
    lineHeight: 1.2,
    letterSpacing: 0,
    align: style.align,
    maxWidth: Math.max(40, Math.round(width * 0.9)),
    fill: rgbaWithAlpha(fill, 1),
    stroke,
  };
}

function rgbaWithAlpha(rgba: Rgba, alpha: number): Rgba {
  return { ...rgba, a: alpha };
}

function alignOffset(textWidth: number, align: "left" | "center" | "right", boundsWidth: number): number {
  const margin = Math.max(8, boundsWidth * 0.05);
  if (align === "left") return margin;
  if (align === "right") return boundsWidth - margin - textWidth;
  return (boundsWidth - textWidth) / 2;
}

function verticalOffset(style: SubtitleRenderStyle, boundsHeight: number, textHeight: number): number {
  const padding = Math.max(16, boundsHeight * 0.06);
  if (style.position === "top") return padding;
  if (style.position === "custom" && style.customY !== undefined) return style.customY;
  return boundsHeight - textHeight - padding;
}

export async function renderSubtitles(
  ctx: SKRSContext2D,
  clips: readonly SubtitleClip[],
  time: number,
  width: number,
  height: number,
): Promise<void> {
  for (const clip of clips) {
    const spanStart = typeof clip.start === "number" ? clip.start : 0;
    const spanEnd = typeof clip.end === "number"
      ? clip.end
      : typeof clip.duration === "number" ? spanStart + clip.duration : time + 1;
    if (time < spanStart || time >= spanEnd) continue;
    const currentTime = time - spanStart;
    let entries: SubtitleEntry[];
    let cueStyle: SubtitleCueStyle | undefined;
    try {
      entries = await getSubtitleEntries(clip.src);
      if (clip.src.toLowerCase().endsWith(".vtt")) {
        cueStyle = parseVttCueStyles(await readFile(clip.src, "utf-8"));
      }
    } catch (error) {
      throw new Error(`Subtitle file "${clip.src}" could not be loaded: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    const style = subtitleRenderStyle(clip, cueStyle);
    const active: SubtitleEntry[] = [];
    for (const entry of entries) {
      if (computeSubtitleDisplay(entry, currentTime).visible) active.push(entry);
    }
    let stackOffset = 0;
    for (const entry of active) {
      renderSubtitle(ctx, entry, { width, height }, style, currentTime, clip.charReveal === true, stackOffset);
      stackOffset += style.fontSize * 1.4;
    }
  }
}
