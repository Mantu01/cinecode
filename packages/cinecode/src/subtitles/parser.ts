export interface SubtitleEntry {
  readonly id: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly text: string;
  readonly rawText?: string;
}

export interface SubtitleCueStyle {
  readonly color?: string;
  readonly backgroundColor?: string;
  readonly align?: "left" | "center" | "right";
}

const TIMESTAMP_LINE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;

function toSeconds(h: string, m: string, s: string, ms: string): number {
  const millis = Number.parseInt(ms.padEnd(3, "0"), 10);
  return Number.parseInt(h, 10) * 3600 + Number.parseInt(m, 10) * 60 + Number.parseInt(s, 10) + millis / 1000;
}

function stripInlineMarkup(text: string): string {
  return text.replace(HTML_TAG, "");
}

function parseTimestamps(line: string): { start: number; end: number } | null {
  const match = TIMESTAMP_LINE.exec(line);
  if (!match) return null;
  const startHours = match[1] ?? "0";
  const startMinutes = match[2]!;
  const startSeconds = match[3]!;
  const startMillis = match[4]!;
  const endHours = match[5] ?? "0";
  const endMinutes = match[6]!;
  const endSeconds = match[7]!;
  const endMillis = match[8]!;
  return {
    start: toSeconds(startHours, startMinutes, startSeconds, startMillis),
    end: toSeconds(endHours, endMinutes, endSeconds, endMillis),
  };
}

export function parseSrt(text: string): SubtitleEntry[] {
  const entries: SubtitleEntry[] = [];
  const blocks = text.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "").trim().split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;
    let id = 0;
    let cursor = 0;
    const firstLine = lines[0]!.trim();
    if (/^\d+$/.test(firstLine)) {
      id = Number.parseInt(firstLine, 10);
      cursor = 1;
    }
    const timestamps = parseTimestamps(lines[cursor] ?? "");
    if (!timestamps) continue;
    const textLines = lines.slice(cursor + 1);
    if (textLines.length === 0) continue;
    const raw = textLines.join("\n").trim();
    entries.push({
      id,
      startTime: timestamps.start,
      endTime: timestamps.end,
      text: stripInlineMarkup(raw),
      rawText: raw,
    });
  }
  return entries;
}

export function parseVtt(text: string): SubtitleEntry[] {
  const entries: SubtitleEntry[] = [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  const blocks = normalized.trim().split(/\n{2,}/);
  let autoId = 0;
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;
    if (lines[0]!.trim().startsWith("WEBVTT")) continue;
    if (lines[0]!.trim().startsWith("NOTE") || lines[0]!.trim().startsWith("STYLE") || lines[0]!.trim().startsWith("REGION")) continue;
    let cursor = 0;
    if (!lines[0]!.includes("-->")) cursor = 1;
    const timestamps = parseTimestamps(lines[cursor] ?? "");
    if (!timestamps) continue;
    const textLines = lines.slice(cursor + 1);
    if (textLines.length === 0) continue;
    const raw = textLines.join("\n").trim();
    entries.push({
      id: ++autoId,
      startTime: timestamps.start,
      endTime: timestamps.end,
      text: stripInlineMarkup(raw),
      rawText: raw,
    });
  }
  return entries;
}

const CUE_BLOCK = /::cue\s*(?:\([^)]*\))?\s*{([^}]*)}/;
const CSS_DECLARATION = /([a-zA-Z-]+)\s*:\s*([^;]+);?/g;
const CSS_COLOR_PROPERTIES = new Set(["color", "background", "background-color"]);

export function parseVttCueStyles(raw: string): SubtitleCueStyle | undefined {
  const match = CUE_BLOCK.exec(raw.replace(/\r\n/g, "\n"));
  if (!match) return undefined;
  const style: { color?: string; backgroundColor?: string; align?: "left" | "center" | "right" } = {};
  const declarations = match[1] ?? "";
  for (const [, property, value] of declarations.matchAll(CSS_DECLARATION)) {
    applyCueDeclaration(style, property!.trim().toLowerCase(), value!.trim());
  }
  if (style.color === undefined && style.backgroundColor === undefined && style.align === undefined) return undefined;
  return style;
}

function applyCueDeclaration(style: { color?: string; backgroundColor?: string; align?: "left" | "center" | "right" }, property: string, value: string): void {
  if (CSS_COLOR_PROPERTIES.has(property) && isCssColor(value)) {
    if (property === "color") {
      style.color = value;
    } else {
      style.backgroundColor = value;
    }
    return;
  }
  if (property === "text-align") {
    const alignment = value.trim().toLowerCase();
    if (alignment === "left" || alignment === "center" || alignment === "right") {
      style.align = alignment;
    }
  }
}

const NAMED_COLORS = new Set(["white", "black", "red", "green", "blue", "yellow", "cyan", "magenta", "gray", "grey", "transparent"]);

function isCssColor(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.startsWith("#") || v.startsWith("rgb") || v.startsWith("hsl")) return true;
  return NAMED_COLORS.has(v);
}
