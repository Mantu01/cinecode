import type { SKRSContext2D } from "@napi-rs/canvas";
import { prepareText, type TextStyle } from "../renderer/text/engine.js";

export const EMOJI_FONT_CANDIDATES: readonly string[] = [
  "Apple Color Emoji",
  "Segoe UI Emoji",
  "Noto Color Emoji",
  "Twitter Color Emoji",
  "Android Emoji",
];

export function detectEmojiFont(): string {
  return `${EMOJI_FONT_CANDIDATES.join(", ")}, sans-serif`;
}

export function emojiTextStyle(size: number, fontFamily?: string): TextStyle {
  return {
    fontFamily: fontFamily ?? detectEmojiFont(),
    fontWeight: "normal",
    fontStyle: "normal",
    fontSize: size,
    lineHeight: 1.2,
    letterSpacing: 0,
    align: "center",
    fill: { r: 255, g: 255, b: 255, a: 1 },
    stroke: { color: { r: 0, g: 0, b: 0, a: 0.25 }, width: 1 },
  };
}

export interface StickerMeasure {
  readonly width: number;
  readonly height: number;
}

export function measureSticker(emoji: string, size: number, fontFamily?: string): StickerMeasure {
  const style = emojiTextStyle(size, fontFamily);
  const prepared = prepareText({ style, text: emoji });
  return { width: prepared.metrics.width, height: size };
}

export function drawSticker(
  ctx: SKRSContext2D,
  emoji: string,
  x: number,
  y: number,
  size: number,
  fontFamily?: string,
  opacity = 1,
): void {
  const style = emojiTextStyle(size, fontFamily);
  const prepared = prepareText({ style, text: emoji });
  const offsetX = (size - prepared.metrics.width) / 2;
  prepared.draw(ctx, x + offsetX, y - size * 0.15, opacity);
}
