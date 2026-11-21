import { createError, ErrorCode } from "../errors/codes.js";
import {
  INPUT_ONLY_FORMATS,
  OUTPUT_FORMATS,
  OUTPUT_PLANS,
  STILL_FORMATS,
  formatTableMarkdown,
} from "../core/output-plan.js";

export type FormatStatus = "implemented" | "planned" | "deferred";

export type FormatKind = "image" | "video" | "audio" | "document" | "other";

export interface FormatSupport {
  readonly format: string;
  readonly kind: FormatKind;
  readonly status: FormatStatus;
  readonly direction: "output" | "input" | "both";
  /** Module that actually writes this format; required for every implemented output. */
  readonly producer?: string;
  /** Command that writes the format when no render pipeline path does. */
  readonly command?: string;
  readonly note?: string;
}

export interface FormatCapabilityReport {
  /** Render output formats, in the order of the single output table. */
  readonly output: readonly FormatSupport[];
  /** Formats accepted as media input, including formats that are not render outputs. */
  readonly input: readonly FormatSupport[];
  /** Command-produced artefacts that are not render formats. */
  readonly helpers: readonly FormatSupport[];
  readonly planned: readonly FormatSupport[];
}

/** Input-only media and helper artifacts that are not render formats. */
const INPUT_SUPPORT: readonly FormatSupport[] = [
  { format: "png", kind: "image", status: "implemented", direction: "both", note: "raster still and frame sequence" },
  { format: "jpg", kind: "image", status: "implemented", direction: "both" },
  { format: "webp", kind: "image", status: "implemented", direction: "both" },
  { format: "gif", kind: "image", status: "implemented", direction: "both", note: "single-frame decode; animated GIF is a render output" },
  { format: "svg", kind: "image", status: "implemented", direction: "input", note: "SVG clip input; `export-svg` writes vector frames" },
  { format: "bmp", kind: "image", status: "planned", direction: "input" },
  { format: "tiff", kind: "image", status: "planned", direction: "input" },
  { format: "wav", kind: "audio", status: "implemented", direction: "both", producer: "src/cli/generate.ts", command: "generate audio", note: "generated beds are always WAV" },
  { format: "mp3", kind: "audio", status: "implemented", direction: "input" },
  { format: "flac", kind: "audio", status: "implemented", direction: "input" },
  { format: "aac", kind: "audio", status: "implemented", direction: "input" },
  { format: "ogg", kind: "audio", status: "implemented", direction: "input" },
  { format: "opus", kind: "audio", status: "implemented", direction: "input" },
  { format: "m4a", kind: "audio", status: "implemented", direction: "input" },
  { format: "frames", kind: "video", status: "implemented", direction: "output", producer: "src/pipeline/image-output.ts", note: "PNG/JPG/WebP frame sequence for interchange" },
  { format: "sprite-sheet", kind: "other", status: "implemented", direction: "output", producer: "src/encoder/outputs.ts", note: "texture atlas from rendered frames with metadata" },
  { format: "archive", kind: "other", status: "planned", direction: "output", note: "frame-sequence zip archive" },
  { format: "data-export", kind: "other", status: "implemented", direction: "output", producer: "src/encoder/data-export.ts", note: "manifest JSON, clip report, timecode log" },
];

function kindForOutput(format: (typeof OUTPUT_FORMATS)[number]): FormatKind {
  if (STILL_FORMATS.includes(format)) return "image";
  const plan = OUTPUT_PLANS[format];
  if (plan.strategy === "document") return "document";
  if (plan.strategy === "stream") return "video";
  return "image";
}

/** Module that writes a render output: the encoder for streams, the image writer otherwise. */
function producerFor(format: (typeof OUTPUT_FORMATS)[number]): string {
  return OUTPUT_PLANS[format].strategy === "stream"
    ? "src/encoder/index.ts"
    : "src/pipeline/image-output.ts";
}

/** Output formats come from the output plan table, never from a second list. */
const OUTPUT_SUPPORT: readonly FormatSupport[] = OUTPUT_FORMATS.map((format) => ({
  format,
  kind: kindForOutput(format),
  status: "implemented" as const,
  direction: "output" as const,
  producer: producerFor(format),
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
      producer: existing.producer ?? entry.producer,
      command: existing.command ?? entry.command,
      note: existing.note ?? entry.note,
    });
  }
  return [...merged.values()];
})();

function isRenderOutput(format: string): boolean {
  return (OUTPUT_FORMATS as readonly string[]).includes(format);
}

function isInputOnly(format: string): boolean {
  return (INPUT_ONLY_FORMATS as readonly string[]).includes(format);
}

export function listFormatSupport(kind?: FormatKind, status?: FormatStatus): readonly FormatSupport[] {
  return SUPPORT.filter((s) => (kind ? s.kind === kind : true) && (status ? s.status === status : true));
}

export function findFormatSupport(format: string, kind?: FormatKind): FormatSupport | undefined {
  const needle = format.toLowerCase();
  return SUPPORT.find((s) => s.format === needle && (kind ? s.kind === kind : true));
}

/** Problems that would make the report lie; empty means the table is honest. */
export function formatSupportIssues(): string[] {
  const issues: string[] = [];
  for (const format of OUTPUT_FORMATS) {
    const support = findFormatSupport(format, kindForOutput(format));
    if (!support || support.status !== "implemented" || support.direction === "input") {
      issues.push(`output format ${format} is not reported as implemented output`);
    }
    if (support && !support.producer) issues.push(`output format ${format} names no producer`);
  }
  for (const format of INPUT_ONLY_FORMATS) {
    if (isRenderOutput(format)) issues.push(`format ${format} is listed as input-only and as a render output`);
    const support = findFormatSupport(format);
    if (!support || support.status !== "implemented" || support.direction === "output") {
      issues.push(`input format ${format} is not reported as implemented input`);
    }
  }
  for (const entry of SUPPORT) {
    if (
      entry.status === "implemented" &&
      entry.direction !== "input" &&
      !isRenderOutput(entry.format) &&
      !isInputOnly(entry.format) &&
      !entry.producer
    ) {
      issues.push(`format ${entry.format} claims output without a producer`);
    }
    if (entry.status === "planned" && isRenderOutput(entry.format) && entry.direction !== "input") {
      issues.push(`planned format ${entry.format} is also reported as an output`);
    }
  }
  return issues;
}

/** Machine report for `cinecode formats`, derived from this table only. */
export function formatCapabilityReport(): FormatCapabilityReport {
  return {
    output: OUTPUT_FORMATS.map((format) => findFormatSupport(format, kindForOutput(format))!),
    input: SUPPORT.filter((entry) => entry.status === "implemented" && entry.direction !== "output"),
    helpers: SUPPORT.filter(
      (entry) =>
        entry.status === "implemented" &&
        entry.direction !== "input" &&
        !isRenderOutput(entry.format) &&
        !isInputOnly(entry.format),
    ),
    planned: SUPPORT.filter((entry) => entry.status !== "implemented"),
  };
}

/** Generated docs: output plans plus the input, helper and planned capability lists. */
export function formatsReferenceMarkdown(): string {
  const row = (entry: FormatSupport): string =>
    `| \`${entry.format}\` | ${entry.kind} | ${entry.status} | ${entry.direction} | ${
      entry.command ? `\`${entry.command}\`` : entry.producer ? `\`${entry.producer}\`` : "—"
    } | ${entry.note ?? "—"} |`;
  const report = formatCapabilityReport();
  return [
    "# Output formats",
    "",
    "Generated from `OUTPUT_PLANS` in `src/core/output-plan.ts` and `INPUT_SUPPORT` in `src/media/formats.ts` — do not edit by hand.",
    "",
    formatTableMarkdown(),
    "",
    "## Input formats",
    "",
    "Accepted as media input, including formats that are not render outputs.",
    "",
    "| Format | Kind | Status | Direction | Producer | Note |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.input.map(row),
    "",
    "## Command-produced formats",
    "",
    "Written by a command, not by the render output table.",
    "",
    "| Format | Kind | Status | Direction | Producer | Note |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.helpers.map(row),
    "",
    "## Planned formats",
    "",
    "Not accepted by any command; asking for one is a `CC1008` unsupported-format error.",
    "",
    "| Format | Kind | Status | Direction | Producer | Note |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.planned.map(row),
    "",
  ].join("\n");
}

export function isFormatSupported(format: string, kind: FormatKind, direction: "output" | "input" = "output"): boolean {
  if (direction === "output" && isInputOnly(format)) return false;
  const entry = findFormatSupport(format, kind);
  if (!entry) return false;
  if (entry.status !== "implemented") return false;
  return entry.direction === "both" || entry.direction === direction;
}

export function assertOutputFormat(format: string, kind: FormatKind): void {
  if (isInputOnly(format)) {
    throw createError(
      ErrorCode.CC2002,
      { type: kind, path: format },
      { fixHint: `${format} is an input format; output formats: ${OUTPUT_FORMATS.join(", ")}.` },
    );
  }
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
