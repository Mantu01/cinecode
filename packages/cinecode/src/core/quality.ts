import type {
  CinecodeConfig,
  EncoderPreset,
  HardwareAcceleration,
  QualityPreset,
  QualitySetting,
  RenderConfig,
  VideoCodec,
} from "./types/config.js";

/** Which physical encoder family a codec runs on. */
export type EncoderBackend = "software" | "nvenc" | "videotoolbox" | "qsv";

/**
 * Detects available hardware encoders by probing the system.
 * On Windows/Linux: checks nvidia-smi availability.
 * On macOS: Videotoolbox is always available.
 */
export function detectHardwareAcceleration(): EncoderBackend {
  const hasNvidia = process.platform === "win32"
    ? checkNvidiaWindows()
    : process.platform === "linux"
      ? checkNvidiaLinux()
      : false;

  if (hasNvidia) return "nvenc";
  if (process.platform === "darwin") return "videotoolbox";
  return "software";
}

function checkNvidiaWindows(): boolean {
  try {
    const { execSync } = require("node:child_process");
    const out = execSync("nvidia-smi --query-gpu=name --format=csv,noheader", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function checkNvidiaLinux(): boolean {
  try {
    const { execSync } = require("node:child_process");
    const out = execSync("nvidia-smi --query-gpu=name --format=csv,noheader", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export interface VideoEncoding {
  /** Logical codec requested by the user. */
  readonly codec: VideoCodec;
  /** Hardware/software backend that will actually encode. */
  readonly backend: EncoderBackend;
  /** Constant Rate Factor used for software encoders. */
  readonly crf: number;
  readonly preset: EncoderPreset;
  readonly pixFmt: string;
  /** The normalized quality profile this came from. */
  readonly profile: QualityPreset;
}

interface ProfileDefaults {
  readonly crf: number;
  readonly preset: EncoderPreset;
}

/**
 * Quality profiles are intentionally *high*. The framework never silently
 * downgrades a render: every value here can be overridden from
 * `cinecode.config.ts` (`render.crf`, `render.preset`, `render.codec`,
 * `render.quality`). Higher `crf` = smaller/lower quality, 0 = lossless.
 */
export const VIDEO_QUALITY_PROFILES: Readonly<Record<QualityPreset, ProfileDefaults>> = {
  draft: { crf: 30, preset: "ultrafast" },
  preview: { crf: 26, preset: "fast" },
  medium: { crf: 22, preset: "medium" },
  final: { crf: 17, preset: "slow" },
  lossless: { crf: 0, preset: "veryslow" },
};

/**
 * AV1 uses its own CRF scale (0-63) and SVT-AV1 preset scale (0-13, lower is
 * slower). These values are tuned per profile instead of reusing the H.264 table.
 */
export const AV1_QUALITY_PROFILES: Readonly<Record<QualityPreset, { readonly crf: number; readonly svtPreset: number }>> = {
  draft: { crf: 35, svtPreset: 8 },
  preview: { crf: 28, svtPreset: 6 },
  medium: { crf: 22, svtPreset: 4 },
  final: { crf: 18, svtPreset: 2 },
  lossless: { crf: 0, svtPreset: 0 },
};

const LEGACY_QUALITY_MAP: Readonly<Record<string, QualityPreset>> = {
  low: "draft",
  medium: "medium",
  high: "final",
  draft: "draft",
  preview: "preview",
  final: "final",
  lossless: "lossless",
};

/** Normalizes any accepted quality spelling to a modern profile name. */
export function normalizeQuality(setting: QualitySetting | undefined): QualityPreset {
  if (!setting) return "final";
  return LEGACY_QUALITY_MAP[setting] ?? "final";
}

const DEFAULT_PIX_FMT: Readonly<Record<VideoCodec, string>> = {
  h264: "yuv420p",
  h265: "yuv420p",
  av1: "yuv420p",
  vp9: "yuv420p",
  prores: "yuv422p10le",
  ffv1: "yuv444p10le",
  utvideo: "yuv422p",
};

function backendFor(
  accel: HardwareAcceleration | undefined,
  codec: VideoCodec,
): EncoderBackend {
  if (codec === "prores" || codec === "ffv1" || codec === "utvideo") return "software";
  switch (accel) {
    case "nvenc":
      return "nvenc";
    case "videotoolbox":
      return "videotoolbox";
    case "qsv":
      return "qsv";
    case "auto":
      break;
    case "off":
    case undefined:
    default:
      return "software";
  }
  return detectHardwareAcceleration();
}

export interface ResolveEncodingOptions {
  readonly render?: RenderConfig;
  /** Explicit override from the CLI (`--quality`). */
  readonly quality?: QualitySetting;
}

/**
 * Resolves the effective encoding settings for a render. Precedence:
 * explicit `options.quality` → `render.quality` → `"final"`; then any explicit
 * `render.crf` / `render.preset` / `render.codec` override the profile defaults.
 */
export function resolveVideoEncoding(options: ResolveEncodingOptions = {}): VideoEncoding {
  const render = options.render ?? {};
  const profile = normalizeQuality(options.quality ?? render.quality);
  const defaults = VIDEO_QUALITY_PROFILES[profile];

  const codec = render.codec ?? "h264";
  const av1Defaults = codec === "av1" ? AV1_QUALITY_PROFILES[profile] : undefined;
  const crf = clampCrf(render.crf ?? av1Defaults?.crf ?? defaults.crf, codec);
  const preset = render.preset ?? defaults.preset;
  const pixFmt = DEFAULT_PIX_FMT[codec];

  // Auto-detect hardware acceleration when not explicitly configured
  let backend: HardwareAcceleration | undefined = render.hardwareAcceleration;
  if (backend === "auto" || backend === undefined) {
    backend = detectHardwareAcceleration() as HardwareAcceleration;
  }

  return {
    codec,
    backend: backendFor(backend, codec),
    crf,
    preset,
    pixFmt,
    profile,
  };
}

export function clampCrf(value: number, codec: VideoCodec): number {
  const max = codec === "vp9" || codec === "av1" ? 63 : 51;
  return Math.max(0, Math.min(max, Math.round(value)));
}

export interface ImageEncoding {
  readonly format: "png" | "jpg" | "webp";
  /** 0-100, only meaningful for lossy formats. */
  readonly quality: number;
  readonly scaleFactor: number;
}

export interface ResolveImageEncodingOptions {
  readonly images?: CinecodeConfig["images"];
  readonly format?: "png" | "jpg" | "webp" | "svg";
  readonly quality?: number;
  readonly scaleFactor?: number;
}

/** Resolves still-image encoding, defaulting to lossless PNG at 1x. */
export function resolveImageEncoding(options: ResolveImageEncodingOptions = {}): ImageEncoding {
  const requested = options.format ?? options.images?.defaultFormat ?? "png";
  const format = requested === "svg" ? "png" : requested;
  return {
    format,
    quality: Math.max(1, Math.min(100, Math.round(options.quality ?? options.images?.quality ?? 90))),
    scaleFactor: Math.max(0.1, options.scaleFactor ?? options.images?.scaleFactor ?? 1),
  };
}

/** A stable string describing an encoding, used for cache hashing. */
export function containerCompatibilityWarning(format: string | undefined, codec: VideoCodec): string | null {
  if (codec === "av1" && format === "mp4") {
    return "AV1 in MP4 has limited player support. Prefer format \"webm\" for AV1 output.";
  }
  if (codec === "vp9" && format === "mp4") {
    return "VP9 in MP4 is non-standard. Prefer format \"webm\" for VP9 output.";
  }
  return null;
}

export function encodingCacheKey(encoding: VideoEncoding): string {
  return `${encoding.profile}-${encoding.codec}-${encoding.backend}-${encoding.crf}-${encoding.preset}-${encoding.pixFmt}`;
}
