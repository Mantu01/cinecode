import type { VideoCodec } from "./types/config.js";
import type { AudioMuxCodec, MuxContainer } from "../audio/muxer.js";
import { createError, ErrorCode } from "../errors/codes.js";

/** Every output format the framework can produce. The only format enum. */
export const OUTPUT_FORMATS = [
  "mp4",
  "webm",
  "prores",
  "mkv",
  "avi",
  "gif",
  "apng",
  "png",
  "jpg",
  "webp",
  "pdf",
  "webm-alpha",
  "prores-alpha",
] as const;

export type RenderFormat = (typeof OUTPUT_FORMATS)[number];

/** How frames reach the writer: live pipe, animation, sequence, still or document. */
export type OutputStrategy = "stream" | "animation" | "sequence" | "still" | "document";

export type OutputContainer =
  | "mp4"
  | "webm"
  | "mov"
  | "matroska"
  | "avi"
  | "apng"
  | "gif"
  | "pdf";

export interface OutputAudioPlan {
  readonly codecs: readonly AudioMuxCodec[];
  readonly defaultCodec: AudioMuxCodec;
  readonly layout: string;
  readonly muxer: MuxContainer;
}

export interface OutputPlan {
  readonly format: RenderFormat;
  readonly strategy: OutputStrategy;
  readonly extension: string;
  readonly container?: OutputContainer;
  /** Muxer used for streamed video containers. */
  readonly muxer?: MuxContainer;
  readonly codecs: readonly VideoCodec[];
  readonly defaultCodec?: VideoCodec;
  readonly pixFmt?: string;
  /** Format can carry an alpha channel. */
  readonly alpha: boolean;
  /** Format name implies alpha (webm-alpha, prores-alpha, apng, png). */
  readonly defaultAlpha?: boolean;
  readonly alphaPixFmt?: string;
  readonly audio?: OutputAudioPlan;
  readonly description: string;
}

const MP4_AUDIO: OutputAudioPlan = {
  codecs: ["aac", "ac3", "eac3", "flac"],
  defaultCodec: "aac",
  layout: "stereo",
  muxer: "mp4",
};
const MOV_AUDIO: OutputAudioPlan = {
  codecs: ["aac", "ac3", "eac3", "flac", "pcm_s24le"],
  defaultCodec: "aac",
  layout: "stereo",
  muxer: "mov",
};
const WEBM_AUDIO: OutputAudioPlan = {
  codecs: ["opus"],
  defaultCodec: "opus",
  layout: "stereo",
  muxer: "webm",
};
const MATROSKA_AUDIO: OutputAudioPlan = {
  codecs: ["aac", "opus", "ac3", "eac3", "flac", "pcm_s24le"],
  defaultCodec: "aac",
  layout: "stereo",
  muxer: "matroska",
};
const AVI_AUDIO: OutputAudioPlan = {
  codecs: ["pcm_s24le", "ac3"],
  defaultCodec: "pcm_s24le",
  layout: "stereo",
  muxer: "avi",
};

/** Single source of truth for every output format the framework can produce. */
export const OUTPUT_PLANS: Readonly<Record<RenderFormat, OutputPlan>> = {
  mp4: {
    format: "mp4",
    strategy: "stream",
    extension: ".mp4",
    container: "mp4",
    muxer: "mp4",
    codecs: ["h264", "h265", "av1"],
    defaultCodec: "h264",
    pixFmt: "yuv420p",
    alpha: false,
    audio: MP4_AUDIO,
    description: "MP4 with muxed audio (H.264, H.265, AV1)",
  },
  webm: {
    format: "webm",
    strategy: "stream",
    extension: ".webm",
    container: "webm",
    muxer: "webm",
    codecs: ["vp9", "av1"],
    defaultCodec: "vp9",
    pixFmt: "yuv420p",
    alpha: true,
    alphaPixFmt: "yuva420p",
    audio: WEBM_AUDIO,
    description: "WebM with muxed Opus audio (VP9, AV1)",
  },
  prores: {
    format: "prores",
    strategy: "stream",
    extension: ".mov",
    container: "mov",
    muxer: "mov",
    codecs: ["prores"],
    defaultCodec: "prores",
    pixFmt: "yuv422p10le",
    alpha: true,
    alphaPixFmt: "yuva444p10le",
    audio: MOV_AUDIO,
    description: "ProRes 422 HQ in a QuickTime container",
  },
  mkv: {
    format: "mkv",
    strategy: "stream",
    extension: ".mkv",
    container: "matroska",
    muxer: "matroska",
    codecs: ["h264", "h265", "av1", "vp9", "ffv1", "utvideo"],
    defaultCodec: "h264",
    pixFmt: "yuv420p",
    alpha: false,
    audio: MATROSKA_AUDIO,
    description: "Matroska with muxed audio",
  },
  avi: {
    format: "avi",
    strategy: "stream",
    extension: ".avi",
    container: "avi",
    muxer: "avi",
    codecs: ["h264", "utvideo"],
    defaultCodec: "h264",
    pixFmt: "yuv420p",
    alpha: false,
    audio: AVI_AUDIO,
    description: "AVI with muxed audio (H.264, Ut Video)",
  },
  gif: {
    format: "gif",
    strategy: "animation",
    extension: ".gif",
    container: "gif",
    codecs: [],
    alpha: false,
    description: "Animated GIF with a generated 256-colour palette",
  },
  apng: {
    format: "apng",
    strategy: "animation",
    extension: ".apng",
    container: "apng",
    codecs: [],
    pixFmt: "rgba",
    alpha: true,
    defaultAlpha: true,
    alphaPixFmt: "rgba",
    description: "Animated PNG with alpha",
  },
  png: {
    format: "png",
    strategy: "sequence",
    extension: "",
    container: undefined,
    codecs: [],
    pixFmt: "rgba",
    alpha: true,
    defaultAlpha: true,
    alphaPixFmt: "rgba",
    description: "PNG frame sequence with alpha",
  },
  jpg: {
    format: "jpg",
    strategy: "still",
    extension: ".jpg",
    codecs: [],
    alpha: false,
    description: "Single JPEG still of the first requested frame",
  },
  webp: {
    format: "webp",
    strategy: "still",
    extension: ".webp",
    codecs: [],
    pixFmt: "yuva420p",
    alpha: true,
    alphaPixFmt: "yuva420p",
    description: "Single WebP still with alpha",
  },
  pdf: {
    format: "pdf",
    strategy: "document",
    extension: ".pdf",
    container: "pdf",
    codecs: [],
    alpha: false,
    description: "Multi-page PDF, one page per frame",
  },
  "webm-alpha": {
    format: "webm-alpha",
    strategy: "stream",
    extension: ".webm",
    container: "webm",
    muxer: "webm",
    codecs: ["vp9"],
    defaultCodec: "vp9",
    pixFmt: "yuva420p",
    alpha: true,
    defaultAlpha: true,
    alphaPixFmt: "yuva420p",
    audio: WEBM_AUDIO,
    description: "WebM with a VP9 alpha channel and muxed audio",
  },
  "prores-alpha": {
    format: "prores-alpha",
    strategy: "stream",
    extension: ".mov",
    container: "mov",
    muxer: "mov",
    codecs: ["prores"],
    defaultCodec: "prores",
    pixFmt: "yuva444p10le",
    alpha: true,
    defaultAlpha: true,
    alphaPixFmt: "yuva444p10le",
    audio: MOV_AUDIO,
    description: "ProRes 4444 with alpha in a QuickTime container",
  },
};

export const ALPHA_FORMATS = OUTPUT_FORMATS.filter((format) => OUTPUT_PLANS[format].alpha);
export const STILL_FORMATS = OUTPUT_FORMATS.filter((format) => OUTPUT_PLANS[format].strategy === "still");
export const STREAM_FORMATS = OUTPUT_FORMATS.filter((format) => OUTPUT_PLANS[format].strategy === "stream");

export function outputPlanFor(format: RenderFormat | undefined): OutputPlan {
  const resolved = format ?? "mp4";
  const plan = OUTPUT_PLANS[resolved];
  if (!plan) {
    throw createError(ErrorCode.CC1008, {
      format: String(resolved),
      supported: OUTPUT_FORMATS.join(", "),
    });
  }
  return plan;
}

/** Pixel format ffmpeg receives on stdin; the transport always carries RGBA. */
/** ffmpeg input format matching the canonical RGBA frame buffer. */
export function frameInputPixFmt(alpha: boolean): "rgba" | "rgb0" {
  return alpha ? "rgba" : "rgb0";
}

export function outputExtensionFor(format: RenderFormat | undefined): string {
  return outputPlanFor(format).extension;
}

export interface OutputRequest {
  readonly format?: RenderFormat;
  readonly codec?: VideoCodec;
  readonly alpha?: boolean;
}

export interface ResolvedOutputPlan {
  readonly format: RenderFormat;
  readonly plan: OutputPlan;
  readonly codec?: VideoCodec;
  readonly alpha: boolean;
  /** Pixel format fed to ffmpeg stdin. */
  readonly inputPixFmt: "rgba" | "rgb0";
}

/** Validates format, codec and alpha against the table before any frame renders. */
export function resolveOutputPlan(request: OutputRequest): ResolvedOutputPlan {
  const plan = outputPlanFor(request.format);
  const format = plan.format;
  const alpha = request.alpha === true || plan.defaultAlpha === true;

  if (request.alpha === true && !plan.alpha) {
    throw createError(ErrorCode.CC1008, {
      format,
      supported: ALPHA_FORMATS.join(", "),
      reason: `format "${format}" cannot carry an alpha channel; alpha-capable formats are ${ALPHA_FORMATS.join(", ")}`,
    });
  }
  if (plan.codecs.length === 0) {
    if (request.codec !== undefined) {
      throw createError(ErrorCode.CC1008, {
        format,
        supported: STREAM_FORMATS.join(", "),
        reason: `format "${format}" has no video codec; it is ${plan.description.toLowerCase()}`,
      });
    }
    return { format, plan, alpha, inputPixFmt: frameInputPixFmt(alpha) };
  }
  if (request.codec !== undefined && !plan.codecs.includes(request.codec)) {
    throw createError(ErrorCode.CC1008, {
      format,
      supported: plan.codecs.join(", "),
      reason: `format "${format}" cannot encode codec "${request.codec}"; supported codecs are ${plan.codecs.join(", ")}`,
    });
  }
  return {
    format,
    plan,
    codec: request.codec ?? plan.defaultCodec,
    alpha,
    inputPixFmt: frameInputPixFmt(alpha),
  };
}

/** Audio codec and container the plan permits for a format. */
export function resolveAudioPlan(format: RenderFormat | undefined, codec?: AudioMuxCodec): OutputAudioPlan | null {
  const plan = outputPlanFor(format);
  if (!plan.audio) return null;
  if (codec !== undefined && !plan.audio.codecs.includes(codec)) {
    throw createError(ErrorCode.CC1008, {
      format: plan.format,
      supported: plan.audio.codecs.join(", "),
      reason: `format "${plan.format}" cannot carry audio codec "${codec}"; supported codecs are ${plan.audio.codecs.join(", ")}`,
    });
  }
  return plan.audio;
}

/** Generated documentation for the output plan table. */
export function formatReferenceMarkdown(): string {
  return [
    "# Output formats",
    "",
    "Generated from `OUTPUT_PLANS` in `src/core/output-plan.ts` — do not edit by hand.",
    "",
    formatTableMarkdown(),
    "",
  ].join("\n");
}

/** Markdown table of the plan, generated into the docs so they cannot drift. */
export function formatTableMarkdown(): string {
  const rows = OUTPUT_FORMATS.map((format) => {
    const plan = OUTPUT_PLANS[format];
    const codecs = plan.codecs.length > 0 ? plan.codecs.join(", ") : "—";
    const alpha = plan.alpha ? `yes (${plan.alphaPixFmt ?? plan.pixFmt})` : "no";
    const audio = plan.audio ? `${plan.audio.defaultCodec} (${plan.audio.codecs.join(", ")})` : "—";
    const container = plan.container ?? (plan.strategy === "still" ? "file" : "directory");
    return `| \`${format}\` | ${plan.strategy} | \`${container}\` | ${codecs} | ${alpha} | ${audio} | ${plan.extension || "—"} |`;
  });
  return [
    "| Format | Strategy | Container | Video codecs | Alpha | Audio | Extension |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}
