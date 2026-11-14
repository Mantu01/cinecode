import { Canvas, GlobalFonts } from "@napi-rs/canvas";
import type { TextStyle } from "./engine.js";

export interface FontRun {
  readonly text: string;
  readonly fontFamily: string;
}

export interface FontFallbackEvent {
  readonly char: string;
  readonly codePoint: number;
  readonly primaryFamily: string;
  readonly resolvedFamily: string;
}

export const SYSTEM_CJK_FONTS: readonly string[] = [
  "Noto Sans CJK SC",
  "Noto Sans CJK JP",
  "Noto Sans SC",
  "Noto Sans JP",
  "PingFang SC",
  "Hiragino Sans",
  "Meiryo",
  "Yu Gothic",
  "Microsoft YaHei",
  "Malgun Gothic",
  "SimSun",
];

export const SYSTEM_EMOJI_FONTS: readonly string[] = [
  "Apple Color Emoji",
  "Segoe UI Emoji",
  "Noto Color Emoji",
  "Segoe UI Symbol",
];

export const SYSTEM_GENERIC_FONTS: readonly string[] = ["DejaVu Sans", "Liberation Sans", "Arial", "Helvetica", "sans-serif"];

export const REPLACEMENT_GLYPH = "\uFFFD";

let measureCanvas: Canvas | null = null;
let measureCtx: ReturnType<Canvas["getContext"]> | null = null;

function getMeasureContext(): ReturnType<Canvas["getContext"]> {
  if (!measureCanvas) measureCanvas = new Canvas(8, 8);
  if (!measureCtx) measureCtx = measureCanvas.getContext("2d");
  return measureCtx;
}

function availableFamilySet(): Set<string> {
  const available = new Set<string>();
  for (const family of GlobalFonts.families) {
    available.add(family.family.toLowerCase());
  }
  return available;
}

function fontSpec(style: Pick<TextStyle, "fontStyle" | "fontWeight" | "fontSize">, family: string): string {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px "${family}"`;
}

function isPlainSpace(char: string): boolean {
  return char.trim().length === 0;
}

function isEmojiCandidate(codePoint: number): boolean {
  return (
    (codePoint >= 0x1f000 && codePoint <= 0x1faff) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    codePoint === 0x200d
  );
}

export class FontFallbackResolver {
  private readonly fallbackFamilies: readonly string[];
  private readonly emojiFamilies: readonly string[];
  private readonly availability: Set<string>;
  private readonly glyphCache = new Map<string, boolean>();
  private readonly familyCache = new Map<string, string>();
  private readonly events: FontFallbackEvent[] = [];
  private readonly warnOnFallback: boolean;
  private warnedFamilies = new Set<string>();

  constructor(options: { fallbackFamilies?: readonly string[]; emojiFamilies?: readonly string[]; warnOnFallback?: boolean } = {}) {
    this.fallbackFamilies = [...(options.fallbackFamilies ?? [...SYSTEM_CJK_FONTS, ...SYSTEM_GENERIC_FONTS])];
    this.emojiFamilies = [...(options.emojiFamilies ?? SYSTEM_EMOJI_FONTS)];
    this.availability = availableFamilySet();
    this.warnOnFallback = options.warnOnFallback !== false;
  }

  private isAvailable(family: string): boolean {
    const normalized = family.toLowerCase();
    if (normalized === "sans-serif" || normalized === "serif" || normalized === "monospace") return true;
    return this.availability.has(normalized);
  }

  private hasGlyph(family: string, char: string, style: Pick<TextStyle, "fontStyle" | "fontWeight" | "fontSize">): boolean {
    const key = `${family.toLowerCase()}|${style.fontWeight}|${style.fontStyle}|${char}`;
    const cached = this.glyphCache.get(key);
    if (cached !== undefined) return cached;
    const ctx = getMeasureContext();
    ctx.font = fontSpec(style, family);
    const width = ctx.measureText(char).width;
    const result = Number.isFinite(width) && width > 0;
    this.glyphCache.set(key, result);
    return result;
  }

  private chainFor(char: string, primary: string): readonly string[] {
    const codePoint = char.codePointAt(0) ?? 0;
    const chain: string[] = [primary];
    if (isEmojiCandidate(codePoint)) chain.push(...this.emojiFamilies);
    chain.push(...this.fallbackFamilies);
    return chain;
  }

  resolveFamily(style: Pick<TextStyle, "fontFamily" | "fontStyle" | "fontWeight" | "fontSize">, char: string): string {
    const primary = style.fontFamily;
    if (isPlainSpace(char) || char === "\n") return primary;
    const cached = this.familyCache.get(`${primary}|${char}`);
    if (cached !== undefined) return cached;

    let resolved = primary;
    if (!this.hasGlyph(primary, char, style)) {
      resolved = REPLACEMENT_GLYPH;
      for (const candidate of this.chainFor(char, primary)) {
        if (candidate === primary) continue;
        if (!this.isAvailable(candidate)) continue;
        if (!this.hasGlyph(candidate, char, style)) continue;
        resolved = candidate;
        break;
      }
      const codePoint = char.codePointAt(0) ?? 0;
      this.events.push({ char, codePoint, primaryFamily: primary, resolvedFamily: resolved });
      if (this.warnOnFallback) this.warnedFamilies.add(primary);
    }
    this.familyCache.set(`${primary}|${char}`, resolved);
    return resolved;
  }

  segment(text: string, style: Pick<TextStyle, "fontFamily" | "fontStyle" | "fontWeight" | "fontSize">): FontRun[] {
    const runs: { text: string; fontFamily: string }[] = [];
    for (const char of text) {
      const family = this.resolveFamily(style, char);
      const last = runs[runs.length - 1];
      if (last && last.fontFamily === family) {
        runs[runs.length - 1] = { text: last.text + char, fontFamily: family };
      } else {
        runs.push({ text: char, fontFamily: family });
      }
    }
    return runs;
  }

  measure(style: Pick<TextStyle, "fontFamily" | "fontStyle" | "fontWeight" | "fontSize">, text: string): number {
    const ctx = getMeasureContext();
    let width = 0;
    for (const run of this.segment(text, style)) {
      ctx.font = fontSpec(style, run.fontFamily);
      width += ctx.measureText(run.text).width;
    }
    return width;
  }

  missingGlyphs(style: Pick<TextStyle, "fontFamily" | "fontStyle" | "fontWeight" | "fontSize">, text: string): string[] {
    const missing: string[] = [];
    for (const char of text) {
      if (isPlainSpace(char)) continue;
      if (this.resolveFamily(style, char) === REPLACEMENT_GLYPH) missing.push(char);
    }
    return missing;
  }

  getEvents(): readonly FontFallbackEvent[] {
    return this.events;
  }

  clearEvents(): void {
    this.events.length = 0;
    this.warnedFamilies.clear();
  }

  flushWarnings(): string | null {
    if (this.events.length === 0) return null;
    const families = [...this.warnedFamilies];
    const sample = this.events.slice(0, 6).map((event) => `U+${event.codePoint.toString(16).toUpperCase().padStart(4, "0")} -> ${event.resolvedFamily}`);
    const summary = [
      `[CC3006] ${this.events.length} glyph fallback event(s) across ${families.length} font family(ies) this render`,
      families.length > 0 ? `families: ${families.join(", ")}` : "",
      sample.length > 0 ? `samples: ${sample.join(", ")}` : "",
      this.events.length > sample.length ? `... ${this.events.length - sample.length} more` : "",
    ].filter((line) => line.length > 0);
    this.clearEvents();
    return summary.join("\n");
  }
}

let defaultResolver: FontFallbackResolver | null = null;

export function getDefaultFontFallbackResolver(): FontFallbackResolver {
  if (!defaultResolver) defaultResolver = new FontFallbackResolver();
  return defaultResolver;
}

export function flushFontFallbackWarnings(): string | null {
  return defaultResolver ? defaultResolver.flushWarnings() : null;
}

export function resetFontFallbackResolver(): void {
  defaultResolver = null;
}
