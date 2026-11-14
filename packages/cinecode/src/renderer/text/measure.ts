import { Canvas } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";

export interface TextMeasureStyle {
  readonly fontFamily?: string;
  readonly fontWeight?: number | string;
  readonly fontStyle?: string;
  readonly fontSize: number;
  readonly letterSpacing?: number;
}

export interface TextLetter {
  readonly ch: string;
  readonly x: number;
  readonly width: number;
  readonly center: number;
}

export interface TextLetterLayout {
  readonly totalWidth: number;
  readonly letters: readonly TextLetter[];
}

let measureContext: SKRSContext2D | null = null;

function context(): SKRSContext2D {
  if (!measureContext) {
    measureContext = new Canvas(1, 1).getContext("2d");
  }
  return measureContext;
}

function fontString(style: TextMeasureStyle): string {
  const family = style.fontFamily ?? "Arial";
  const weight = style.fontWeight ?? "normal";
  const posture = style.fontStyle ?? "normal";
  return `${posture} ${weight} ${style.fontSize}px "${family}"`;
}

export function measureTextWidth(text: string, style: TextMeasureStyle): number {
  const ctx = context();
  ctx.font = fontString(style);
  const spacing = style.letterSpacing ?? 0;
  let width = 0;
  for (const ch of text) width += ctx.measureText(ch).width + spacing;
  if (text.length > 0) width -= spacing;
  return width;
}

export function layoutTextLetters(word: string, style: TextMeasureStyle): TextLetterLayout {
  const ctx = context();
  ctx.font = fontString(style);
  const spacing = style.letterSpacing ?? 0;
  const letters: TextLetter[] = [];
  let x = 0;
  for (const ch of word) {
    const width = ctx.measureText(ch).width;
    letters.push({ ch, x, width, center: x + width / 2 });
    x += width + spacing;
  }
  const totalWidth = letters.length > 0 ? x - spacing : 0;
  return { totalWidth, letters };
}
