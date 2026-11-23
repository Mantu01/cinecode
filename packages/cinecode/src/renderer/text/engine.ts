import { Canvas } from "@napi-rs/canvas";
import type { CanvasRenderingContext2D } from "@napi-rs/canvas";
import type { Rgba, Gradient } from "../color/types.js";
import { getDefaultFontFallbackResolver } from "./font-fallback.js";

export interface FontFace {
  readonly family: string;
  readonly src: string;
  readonly weight?: number | string;
  readonly style?: string;
}

export interface TextStyle {
  readonly fontFamily: string;
  readonly fontWeight: number | string;
  readonly fontStyle: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly align: "left" | "center" | "right";
  readonly maxWidth?: number;
  readonly autoFit?: boolean;
  readonly fill?: Rgba | Gradient;
  readonly stroke?: { color: Rgba; width: number };
  readonly shadow?: { color: Rgba; blur: number; offsetX: number; offsetY: number };
}

export interface TextMetricsResult {
  readonly width: number;
  readonly height: number;
  readonly ascent: number;
  readonly descent: number;
  readonly lines: readonly LineMetrics[];
}

export interface LineMetrics {
  readonly text: string;
  readonly width: number;
  readonly height: number;
  readonly baseline: number;
  readonly x: number;
  readonly y: number;
}

export interface GlyphPosition {
  readonly char: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly index: number;
}

export interface TextLayoutOptions {
  readonly style: TextStyle;
  readonly text: string;
  readonly characterAccess?: boolean;
  readonly wordAccess?: boolean;
  readonly lineAccess?: boolean;
}

export interface PreparedText {
  readonly metrics: TextMetricsResult;
  readonly glyphs: readonly GlyphPosition[];
  readonly words: readonly { text: string; x: number; y: number; width: number; height: number }[];
  readonly lines: readonly LineMetrics[];
  readonly draw: (ctx: CanvasRenderingContext2D, x: number, y: number, opacity?: number) => void;
}

const fontCache = new Map<string, FontFace>();

interface TextRun {
  readonly text: string;
  readonly fontFamily: string;
  readonly width: number;
}

interface LayoutCacheEntry {
  readonly metrics: TextMetricsResult;
  readonly glyphs: readonly GlyphPosition[];
  readonly words: readonly { text: string; x: number; y: number; width: number; height: number }[];
  readonly lineRuns: ReadonlyArray<readonly TextRun[]>;
}

const TEXT_LAYOUT_CACHE_MAX = 500;
const textLayoutCache = new Map<string, LayoutCacheEntry>();
let textLayoutCacheHits = 0;
let textLayoutCacheMisses = 0;

export function clearTextLayoutCache(): void {
  textLayoutCache.clear();
}

export function getTextLayoutCacheStats(): { size: number; hits: number; misses: number } {
  return { size: textLayoutCache.size, hits: textLayoutCacheHits, misses: textLayoutCacheMisses };
}

/** Pooled 1×1 measurement canvas — reused across all text measurements to avoid per-call native allocation. */
let _measureCanvas: Canvas | null = null;
function _measureCtx(): CanvasRenderingContext2D {
  if (!_measureCanvas) {
    _measureCanvas = new Canvas(1, 1);
  }
  return _measureCanvas.getContext("2d");
}

export function registerFont(face: FontFace): void {
  const key = `${face.family}-${face.weight ?? "normal"}-${face.style ?? "normal"}`;
  fontCache.set(key, face);
  clearTextLayoutCache();
}

export function getFontKey(style: TextStyle): string {
  return `${style.fontFamily}-${style.fontWeight}-${style.fontStyle}`;
}

export function measureText(ctx: CanvasRenderingContext2D, text: string, style: TextStyle): TextMetricsResult {
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px "${style.fontFamily}"`;
  ctx.textBaseline = "alphabetic";
  ctx.letterSpacing = `${style.letterSpacing ?? 0}px`;
  const lines = wrapText(text, style, ctx);
  let maxWidth = 0;
  let totalHeight = 0;
  const lineMetrics: LineMetrics[] = [];
  const resolver = getDefaultFontFallbackResolver();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const width = resolver.measure(style, line);
    const height = style.fontSize * style.lineHeight;
    const baseline = style.fontSize;
    maxWidth = Math.max(maxWidth, width);
    totalHeight += height;
    const alignOffset = getAlignOffset(width, style.align, style.maxWidth ?? maxWidth);
    lineMetrics.push({
      text: line,
      width,
      height,
      baseline,
      x: alignOffset,
      y: i * height + baseline,
    });
  }
  return { width: maxWidth, height: totalHeight, ascent: style.fontSize, descent: style.fontSize * (style.lineHeight - 1), lines: lineMetrics };
}

function wrapText(text: string, style: TextStyle, ctx: CanvasRenderingContext2D): string[] {
  if (!style.maxWidth) return text.split("\n");
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    const testLine = currentLine + word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > style.maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function getAlignOffset(width: number, align: TextStyle["align"], maxWidth: number): number {
  switch (align) {
    case "center":
      return (maxWidth - width) / 2;
    case "right":
      return maxWidth - width;
    default:
      return 0;
  }
}

export function prepareText(options: TextLayoutOptions): PreparedText {
  const { style, text, characterAccess, wordAccess } = options;
  const cacheKey = `${text}::${style.fontFamily}::${style.fontSize}::${style.fontWeight}::${style.fontStyle}::${style.letterSpacing ?? 0}::${style.lineHeight ?? 1.2}::${style.maxWidth ?? 0}::${style.align ?? "left"}::${characterAccess ? 1 : 0}::${wordAccess ? 1 : 0}`;

  let entry = textLayoutCache.get(cacheKey);
  if (entry) {
    textLayoutCacheHits++;
    textLayoutCache.delete(cacheKey);
    textLayoutCache.set(cacheKey, entry);
  } else {
    textLayoutCacheMisses++;
    const ctx = _measureCtx();
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px "${style.fontFamily}"`;
    ctx.textBaseline = "alphabetic";
    ctx.letterSpacing = `${style.letterSpacing ?? 0}px`;
    const metrics = measureText(ctx, text, style);
    const glyphs: GlyphPosition[] = [];
    const words: { text: string; x: number; y: number; width: number; height: number }[] = [];
    let charIndex = 0;
    const resolver = getDefaultFontFallbackResolver();
    const lineRuns: TextRun[][] = [];

    for (const line of metrics.lines) {
      const lineWords = line.text.split(/(\s+)/);
      let wordX = line.x;
      for (const word of lineWords) {
        const wordMetrics = ctx.measureText(word);
        if (wordAccess) {
          words.push({ text: word, x: wordX, y: line.y - line.baseline, width: wordMetrics.width, height: line.height });
        }
        for (const char of word) {
          const charWidth = resolver.measure(style, char);
          if (characterAccess) {
            glyphs.push({
              char,
              x: wordX,
              y: line.y - line.baseline,
              width: charWidth,
              height: line.height,
              index: charIndex++,
            });
          }
          wordX += charWidth;
        }
      }

      const runs: TextRun[] = [];
      for (const run of resolver.segment(line.text, style)) {
        ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px "${run.fontFamily}"`;
        runs.push({ text: run.text, fontFamily: run.fontFamily, width: ctx.measureText(run.text).width });
      }
      lineRuns.push(runs);
    }

    entry = { metrics, glyphs, words, lineRuns };
    if (textLayoutCache.size >= TEXT_LAYOUT_CACHE_MAX) {
      const first = textLayoutCache.keys().next().value;
      if (first !== undefined) textLayoutCache.delete(first);
    }
    textLayoutCache.set(cacheKey, entry);
  }

  const { metrics, glyphs, words, lineRuns } = entry;
  const draw = (drawCtx: CanvasRenderingContext2D, x: number, y: number, opacity = 1): void => {
    drawCtx.save();
    drawCtx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px "${style.fontFamily}"`;
    drawCtx.textBaseline = "alphabetic";
    drawCtx.letterSpacing = `${style.letterSpacing ?? 0}px`;
    drawCtx.globalAlpha = opacity;
    if (style.shadow) {
      drawCtx.shadowColor = `rgba(${style.shadow.color.r}, ${style.shadow.color.g}, ${style.shadow.color.b}, ${style.shadow.color.a})`;
      drawCtx.shadowBlur = style.shadow.blur;
      drawCtx.shadowOffsetX = style.shadow.offsetX;
      drawCtx.shadowOffsetY = style.shadow.offsetY;
    }
    if (style.stroke) {
      drawCtx.strokeStyle = `rgba(${style.stroke.color.r}, ${style.stroke.color.g}, ${style.stroke.color.b}, ${style.stroke.color.a})`;
      drawCtx.lineWidth = style.stroke.width;
    }
    if (style.fill) {
      if ("r" in style.fill) {
        drawCtx.fillStyle = `rgba(${style.fill.r}, ${style.fill.g}, ${style.fill.b}, ${style.fill.a})`;
      }
    }
    for (let i = 0; i < metrics.lines.length; i++) {
      const line = metrics.lines[i]!;
      const runs = lineRuns[i] ?? [];
      const lineX = x + line.x;
      const lineY = y + line.y;
      let offset = 0;
      for (const run of runs) {
        drawCtx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px "${run.fontFamily}"`;
        const runX = lineX + offset;
        if (style.fill) {
          drawCtx.fillText(run.text, runX, lineY);
        }
        if (style.stroke) {
          drawCtx.strokeText(run.text, runX, lineY);
        }
        offset += run.width;
      }
    }
    drawCtx.restore();
  };
  return { metrics, glyphs, words, lines: metrics.lines, draw };
}

export function checkMissingGlyphs(text: string, style: TextStyle): string[] {
  const missing = getDefaultFontFallbackResolver().missingGlyphs(style, text);
  const ctx = _measureCtx();
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px "${style.fontFamily}"`;
  for (const char of text) {
    if (char.trim() && ctx.measureText(char).width === 0 && !missing.includes(char)) missing.push(char);
  }
  return missing;
}

export { getDefaultFontFallbackResolver, flushFontFallbackWarnings, FontFallbackResolver } from "./font-fallback.js";
export type { FontRun, FontFallbackEvent } from "./font-fallback.js";