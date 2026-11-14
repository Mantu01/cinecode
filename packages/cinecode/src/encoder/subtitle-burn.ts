import type { SKRSContext2D } from "@napi-rs/canvas";
import type { Composition, SubtitleClip } from "../core/types/index.js";
import { getSubtitleEntries, type SubtitleEntry } from "../subtitles/index.js";

export interface ActiveSubtitle extends SubtitleEntry {
  readonly clipIndex: number;
  readonly style: BurnSubtitleOptions;
}

export interface BurnSubtitleOptions {
  readonly fontSize?: number;
  readonly fontFamily?: string;
  readonly fillColor?: string;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly outline?: boolean;
  readonly paddingBottom?: number;
  readonly customY?: number;
}

export const DEFAULT_BURN_SUBTITLE_STYLE: Required<Omit<BurnSubtitleOptions, "customY">> = {
  fontSize: 36,
  fontFamily: "sans-serif",
  fillColor: "#ffffff",
  strokeColor: "#000000",
  strokeWidth: 2,
  outline: true,
  paddingBottom: 40,
};

/** Loads every subtitle file referenced by the composition before rendering. */
export async function preloadSubtitlesForRender(composition: Composition): Promise<void> {
  const files = new Set<string>();
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind !== "subtitle") continue;
    for (const clip of track.clips) {
      const subtitle = clip as SubtitleClip;
      if (typeof subtitle.src === "string" && subtitle.src.length > 0) files.add(subtitle.src);
    }
  }
  await Promise.all([...files].map((file) => getSubtitleEntries(file).catch(() => [])));
}

export async function getActiveSubtitles(
  composition: Composition,
  timeSeconds: number,
): Promise<ActiveSubtitle[]> {
  const active: ActiveSubtitle[] = [];
  let clipIndex = 0;
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind !== "subtitle") continue;
    for (const clip of track.clips) {
      const subtitle = clip as SubtitleClip;
      clipIndex += 1;
      const entries = await getSubtitleEntries(subtitle.src).catch(() => []);
      for (const entry of entries) {
        if (timeSeconds < entry.startTime || timeSeconds >= entry.endTime) continue;
        active.push({
          ...entry,
          clipIndex,
          style: {
            fontSize: subtitle.style?.fontSize,
            fontFamily: subtitle.style?.fontFamily,
            fillColor: subtitle.style?.fillColor,
            strokeColor: subtitle.style?.strokeColor,
            strokeWidth: subtitle.style?.strokeWidth,
            outline: subtitle.style?.outline,
            customY: subtitle.customY,
          },
        });
      }
    }
  }
  return active.sort((left, right) => left.clipIndex - right.clipIndex || left.startTime - right.startTime);
}

export function drawBurnedSubtitles(
  ctx: SKRSContext2D,
  subtitles: readonly ActiveSubtitle[],
  width: number,
  height: number,
  overrides: BurnSubtitleOptions = {},
): void {
  if (subtitles.length === 0) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  let lineOffset = 0;
  for (const subtitle of subtitles) {
    const style = { ...DEFAULT_BURN_SUBTITLE_STYLE, ...overrides, ...stripUndefined(subtitle.style) };
    const bottom = style.customY ?? height - style.paddingBottom - lineOffset;
    ctx.font = `${style.fontSize}px ${style.fontFamily}`;
    const x = width / 2;
    if (style.outline) {
      ctx.lineWidth = style.strokeWidth;
      ctx.strokeStyle = style.strokeColor;
      ctx.lineJoin = "round";
      ctx.strokeText(subtitle.text, x, bottom);
    }
    ctx.fillStyle = style.fillColor;
    ctx.fillText(subtitle.text, x, bottom);
    lineOffset += style.fontSize * 1.3;
  }
  ctx.restore();
}

function stripUndefined(options: BurnSubtitleOptions): BurnSubtitleOptions {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) as BurnSubtitleOptions;
}
