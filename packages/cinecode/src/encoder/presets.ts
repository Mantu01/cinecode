import type {
  AspectRatio,
  EncoderPreset,
  PlatformPresetName,
  RenderFormat,
  VideoCodec,
} from "../core/types/config.js";

export interface PlatformPreset {
  readonly name: Exclude<PlatformPresetName, "custom">;
  readonly label: string;
  readonly description: string;
  readonly format: RenderFormat;
  readonly codec: VideoCodec;
  readonly crf: number;
  readonly preset: EncoderPreset;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly maxFileSizeMB?: number;
  readonly recommendedAspect: AspectRatio;
  readonly audioCodec: "aac" | "opus";
  readonly audioBitrateKbps: number;
}

export const PLATFORM_PRESETS: Readonly<Record<Exclude<PlatformPresetName, "custom">, PlatformPreset>> = {
  "youtube-1080p": {
    name: "youtube-1080p",
    label: "YouTube 1080p",
    description: "Standard 16:9 upload, H.264 at high quality.",
    format: "mp4",
    codec: "h264",
    crf: 20,
    preset: "fast",
    maxWidth: 1920,
    maxHeight: 1080,
    recommendedAspect: "16:9",
    audioCodec: "aac",
    audioBitrateKbps: 384,
  },
  "youtube-4k": {
    name: "youtube-4k",
    label: "YouTube 4K",
    description: "UHD 16:9 upload for maximum detail.",
    format: "mp4",
    codec: "h264",
    crf: 18,
    preset: "medium",
    maxWidth: 3840,
    maxHeight: 2160,
    recommendedAspect: "16:9",
    audioCodec: "aac",
    audioBitrateKbps: 384,
  },
  tiktok: {
    name: "tiktok",
    label: "TikTok",
    description: "Vertical 9:16 short-form video under the 287 MB upload limit.",
    format: "mp4",
    codec: "h264",
    crf: 22,
    preset: "veryfast",
    maxWidth: 1080,
    maxHeight: 1920,
    maxFileSizeMB: 287,
    recommendedAspect: "9:16",
    audioCodec: "aac",
    audioBitrateKbps: 128,
  },
  "instagram-reels": {
    name: "instagram-reels",
    label: "Instagram Reels",
    description: "Vertical 9:16 reel under the 400 MB upload limit.",
    format: "mp4",
    codec: "h264",
    crf: 20,
    preset: "fast",
    maxWidth: 1080,
    maxHeight: 1920,
    maxFileSizeMB: 400,
    recommendedAspect: "9:16",
    audioCodec: "aac",
    audioBitrateKbps: 128,
  },
  "instagram-post": {
    name: "instagram-post",
    label: "Instagram Post",
    description: "Square 1:1 feed video.",
    format: "mp4",
    codec: "h264",
    crf: 20,
    preset: "fast",
    maxWidth: 1080,
    maxHeight: 1080,
    recommendedAspect: "1:1",
    audioCodec: "aac",
    audioBitrateKbps: 128,
  },
  twitter: {
    name: "twitter",
    label: "Twitter / X",
    description: "16:9 clip sized for the X video upload limit.",
    format: "mp4",
    codec: "h264",
    crf: 24,
    preset: "superfast",
    maxWidth: 1920,
    maxHeight: 1200,
    maxFileSizeMB: 512,
    recommendedAspect: "16:9",
    audioCodec: "aac",
    audioBitrateKbps: 128,
  },
};

export interface MediaFormatPreset {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly format: RenderFormat;
  readonly codec?: VideoCodec;
  readonly crf?: number;
  readonly lossless?: boolean;
  readonly alpha?: boolean;
  readonly stillImage?: boolean;
  readonly extension: string;
  readonly audioCodec?: "aac" | "opus" | "pcm_s16le" | "pcm_s24le" | "none";
}

export const MEDIA_FORMAT_PRESETS: Readonly<Record<string, MediaFormatPreset>> = {
  "avif-still": {
    name: "avif-still",
    label: "AVIF Still",
    description: "AV1 still image, 10-bit HDR capable, quality 24/63.",
    format: "avif",
    crf: 24,
    stillImage: true,
    alpha: true,
    extension: ".avif",
  },
  "webp-still": {
    name: "webp-still",
    label: "WebP Still",
    description: "Lossy WebP still with alpha, quality 90.",
    format: "webp",
    stillImage: true,
    alpha: true,
    extension: ".webp",
  },
  "webp-animated": {
    name: "webp-animated",
    label: "Animated WebP",
    description: "Animated WebP at 30 fps with alpha support.",
    format: "webp",
    alpha: true,
    extension: ".webp",
    audioCodec: "none",
  },
  apng: {
    name: "apng",
    label: "Animated PNG",
    description: "APNG animation with lossless frames and alpha.",
    format: "apng",
    lossless: true,
    alpha: true,
    extension: ".apng",
    audioCodec: "none",
  },
  "ffv1-archival": {
    name: "ffv1-archival",
    label: "FFV1 Archival (MKV)",
    description: "Lossless FFV1 level 3 in Matroska for archival mastering.",
    format: "mkv",
    codec: "ffv1",
    lossless: true,
    extension: ".mkv",
    audioCodec: "pcm_s24le",
  },
  utvideo: {
    name: "utvideo",
    label: "Ut Video (AVI)",
    description: "Fast Windows-friendly lossless Ut Video in AVI.",
    format: "avi",
    codec: "utvideo",
    lossless: true,
    extension: ".avi",
    audioCodec: "pcm_s16le",
  },
  "av1-mkv": {
    name: "av1-mkv",
    label: "AV1 (MKV)",
    description: "SVT-AV1 in Matroska with chapter and track support.",
    format: "mkv",
    codec: "av1",
    crf: 30,
    extension: ".mkv",
    audioCodec: "opus",
  },
  "av1-webm": {
    name: "av1-webm",
    label: "AV1 (WebM)",
    description: "SVT-AV1 in WebM for the web.",
    format: "webm",
    codec: "av1",
    crf: 30,
    extension: ".webm",
    audioCodec: "opus",
  },
  "hdr10-hevc": {
    name: "hdr10-hevc",
    label: "HDR10 (HEVC)",
    description: "10-bit HEVC with BT.2020/PQ and HDR10 mastering metadata.",
    format: "mp4",
    codec: "h265",
    crf: 18,
    extension: ".mp4",
    audioCodec: "aac",
  },
};

export function getMediaFormatPreset(name: string): MediaFormatPreset | null {
  return MEDIA_FORMAT_PRESETS[name] ?? null;
}

export function listMediaFormatPresets(): readonly MediaFormatPreset[] {
  return Object.values(MEDIA_FORMAT_PRESETS);
}

export function resolvePlatformPreset(name: PlatformPresetName | undefined): PlatformPreset | null {
  if (!name || name === "custom") return null;
  return PLATFORM_PRESETS[name] ?? null;
}

export function listPlatformPresets(): readonly PlatformPreset[] {
  return Object.values(PLATFORM_PRESETS);
}

export function fitToPreset(width: number, height: number, preset: PlatformPreset): { width: number; height: number } {
  const maxWidth = preset.maxWidth ?? width;
  const maxHeight = preset.maxHeight ?? height;
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(2, Math.round((width * scale) / 2) * 2),
    height: Math.max(2, Math.round((height * scale) / 2) * 2),
  };
}

export function aspectRatioValue(aspect: AspectRatio): number {
  const [width, height] = aspect.split(":").map((part) => Number(part));
  return width && height ? width / height : 16 / 9;
}

export function matchesRecommendedAspect(width: number, height: number, preset: PlatformPreset, tolerance = 0.02): boolean {
  return Math.abs(width / height - aspectRatioValue(preset.recommendedAspect)) <= tolerance;
}

export interface FileSizeCompliance {
  readonly compliant: boolean;
  readonly limitBytes?: number;
  readonly actualBytes: number;
  readonly message?: string;
}

export function checkFileSizeCompliance(fileSizeBytes: number, preset: PlatformPreset | null): FileSizeCompliance {
  if (!preset?.maxFileSizeMB) return { compliant: true, actualBytes: fileSizeBytes };
  const limitBytes = preset.maxFileSizeMB * 1024 * 1024;
  if (fileSizeBytes <= limitBytes) return { compliant: true, limitBytes, actualBytes: fileSizeBytes };
  const actualMb = (fileSizeBytes / (1024 * 1024)).toFixed(1);
  return {
    compliant: false,
    limitBytes,
    actualBytes: fileSizeBytes,
    message: `[CC8001] output is ${actualMb} MB, above the ${preset.label} limit of ${preset.maxFileSizeMB} MB — raise CRF or lower the resolution`,
  };
}
