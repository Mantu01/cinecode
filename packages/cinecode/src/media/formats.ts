import { createError, ErrorCode } from "../errors/codes.js";
import { OUTPUT_FORMATS, OUTPUT_PLANS, STILL_FORMATS } from "../core/output-plan.js";

export type FormatStatus = "implemented" | "planned" | "deferred";

export type FormatKind = "image" | "video" | "audio" | "document" | "other";

export interface FormatSupport {
  readonly format: string;
  readonly kind: FormatKind;
  readonly status: FormatStatus;
  readonly direction: "output" | "input" | "both";
  readonly note?: string;
}

/** Input-only media and helper artifacts that are not render formats. */
const INPUT_SUPPORT: readonly FormatSupport[] = [
  { format: "png", kind: "image", status: "implemented", direction: "both", note: "raster still and frame sequence" },
  { format: "jpg", kind: "image", status: "implemented", direction: "both" },
  { format: "webp", kind: "image", status: "implemented", direction: "both" },
  { format: "gif", kind: "image", status: "implemented", direction: "both", note: "single-frame decode; animated GIF is a render output" },
  { format: "svg", kind: "image", status: "implemented", direction: "output", note: "vector export via `cinecode export-svg`; never silently rasterized" },
  { format: "bmp", kind: "image", status: "planned", direction: "input" },
  { format: "tiff", kind: "image", status: "planned", direction: "input" },
  { format: "wav", kind: "audio", status: "implemented", direction: "both" },
  { format: "mp3", kind: "audio", status: "implemented", direction: "both" },
  { format: "flac", kind: "audio", status: "implemented", direction: "both" },
  { format: "aac", kind: "audio", status: "implemented", direction: "both" },
  { format: "ogg", kind: "audio", status: "implemented", direction: "both" },
  { format: "opus", kind: "audio", status: "implemented", direction: "output" },
  { format: "m4a", kind: "audio", status: "implemented", direction: "input" },
  { format: "frames", kind: "video", status: "implemented", direction: "output", note: "PNG/JPG/WebP frame sequence for interchange" },
  { format: "sprite-sheet", kind: "other", status: "implemented", direction: "output", note: "texture atlas from rendered frames with metadata" },
  { format: "archive", kind: "other", status: "planned", direction: "output", note: "frame-sequence zip archive" },
  { format: "data-export", kind: "other", status: "implemented", direction: "output", note: "manifest JSON, clip report, timecode log" },
];

function kindForOutput(format: (typeof OUTPUT_FORMATS)[number]): FormatKind {
  if (STILL_FORMATS.includes(format)) return "image";
  const plan = OUTPUT_PLANS[format];
  if (plan.strategy === "document") return "document";
  if (plan.strategy === "stream") return "video";
  return "image";
}

/** Output formats come from the output plan table, never from a second list. */
const OUTPUT_SUPPORT: readonly FormatSupport[] = OUTPUT_FORMATS.map((format) => ({
  format,
  kind: kindForOutput(format),
  status: "implemented" as const,
  direction: "output" as const,
  note: OUTPUT_PLANS[format].description,
}));

const SUPPORT: readonly FormatSupport[] = (() => {
  const merged = new Map<string, FormatSupport>();
  for (const entry of [...INPUT_SUPPORT, ...OUTPUT_SUPPORT]) {
    const key = `${entry.format}:${entry.kind}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, entry);
      continue;
    }
    merged.set(key, {
      ...existing,
      direction: existing.direction === entry.direction ? existing.direction : "both",
      note: existing.note ?? entry.note,
    });
  }
  return [...merged.values()];
})();

export function listFormatSupport(kind?: FormatKind, status?: FormatStatus): readonly FormatSupport[] {
  return SUPPORT.filter((s) => (kind ? s.kind === kind : true) && (status ? s.status === status : true));
}

export function findFormatSupport(format: string, kind?: FormatKind): FormatSupport | undefined {
  const needle = format.toLowerCase();
  return SUPPORT.find((s) => s.format === needle && (kind ? s.kind === kind : true));
}

export function isFormatSupported(format: string, kind: FormatKind, direction: "output" | "input" = "output"): boolean {
  const entry = findFormatSupport(format, kind);
  if (!entry) return false;
  if (entry.status !== "implemented") return false;
  return entry.direction === "both" || entry.direction === direction;
}

export function assertOutputFormat(format: string, kind: FormatKind): void {
  const entry = findFormatSupport(format, kind);
  if (!entry) {
    throw createError(
      ErrorCode.CC2002,
      { type: kind, path: format },
      { fixHint: `Supported ${kind} output formats: ${listFormatSupport(kind, "implemented").filter((f) => f.direction !== "input").map((f) => f.format).join(", ")}.` },
    );
  }
  if (entry.status === "deferred") {
    throw createError(
      ErrorCode.CC2002,
      { type: kind, path: format },
      { fixHint: `${format} is deferred: ${entry.note ?? "not implemented yet"}.` },
    );
  }
  if (entry.status === "planned") {
    throw createError(
      ErrorCode.CC2002,
      { type: kind, path: format },
      { fixHint: `${format} is planned but not yet implemented.` },
    );
  }
  if (entry.direction === "input") {
    throw createError(
      ErrorCode.CC2002,
      { type: kind, path: format },
      { fixHint: `${format} is an input-only format and cannot be used for output.` },
    );
  }
}
