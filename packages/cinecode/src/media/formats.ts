import { createError, ErrorCode } from "../errors/codes.js";

export type FormatStatus = "implemented" | "planned" | "deferred";

export type FormatKind = "image" | "video" | "audio" | "document" | "other";

export interface FormatSupport {
  readonly format: string;
  readonly kind: FormatKind;
  readonly status: FormatStatus;
  readonly direction: "output" | "input" | "both";
  readonly note?: string;
}

const SUPPORT: readonly FormatSupport[] = [
  { format: "png", kind: "image", status: "implemented", direction: "both" },
  { format: "jpg", kind: "image", status: "implemented", direction: "both" },
  { format: "webp", kind: "image", status: "implemented", direction: "both" },
  { format: "gif", kind: "image", status: "implemented", direction: "both", note: "single-frame via image decode; animated GIF is a video/image output" },
  { format: "svg", kind: "image", status: "implemented", direction: "output", note: "falls back to PNG raster; SVG source is not rasterized" },
  { format: "bmp", kind: "image", status: "planned", direction: "input" },
  { format: "tiff", kind: "image", status: "planned", direction: "input" },

  { format: "mp4", kind: "video", status: "implemented", direction: "both" },
  { format: "webm", kind: "video", status: "implemented", direction: "both" },
  { format: "mov", kind: "video", status: "implemented", direction: "input" },
  { format: "mkv", kind: "video", status: "implemented", direction: "input" },
  { format: "prores", kind: "video", status: "implemented", direction: "output", note: "prores_ks via ffmpeg" },
  { format: "gif", kind: "video", status: "implemented", direction: "output", note: "animated GIF from rendered frames" },
  { format: "frames", kind: "video", status: "implemented", direction: "output", note: "PNG/JPG/WebP frame sequence for interchange" },

  { format: "wav", kind: "audio", status: "implemented", direction: "both" },
  { format: "mp3", kind: "audio", status: "implemented", direction: "both" },
  { format: "flac", kind: "audio", status: "implemented", direction: "both" },
  { format: "aac", kind: "audio", status: "implemented", direction: "both" },
  { format: "ogg", kind: "audio", status: "implemented", direction: "both" },
  { format: "opus", kind: "audio", status: "implemented", direction: "output" },
  { format: "m4a", kind: "audio", status: "implemented", direction: "input" },

  { format: "pdf", kind: "document", status: "deferred", direction: "output", note: "single/multi-page still output is not implemented" },

  { format: "sprite-sheet", kind: "other", status: "implemented", direction: "output", note: "texture atlas from rendered frames with metadata" },
  { format: "archive", kind: "other", status: "planned", direction: "output", note: "frame-sequence zip archive" },
  { format: "data-export", kind: "other", status: "implemented", direction: "output", note: "manifest JSON, clip report, timecode log" },
];

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
      { fixHint: `Supported ${kind} output formats: ${listFormatSupport(kind, "implemented").filter((f) => f.direction !== "input").map((f) => f.format).join(", ")}.` }
    );
  }
  if (entry.status === "deferred") {
    throw createError(
      ErrorCode.CC2002,
      { type: kind, path: format },
      { fixHint: `${format} is deferred: ${entry.note ?? "not implemented yet"}.` }
    );
  }
  if (entry.status === "planned") {
    throw createError(
      ErrorCode.CC2002,
      { type: kind, path: format },
      { fixHint: `${format} is planned but not yet implemented.` }
    );
  }
  if (entry.direction === "input") {
    throw createError(
      ErrorCode.CC2002,
      { type: kind, path: format },
      { fixHint: `${format} is an input-only format and cannot be used for output.` }
    );
  }
}
