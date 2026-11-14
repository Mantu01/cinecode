import type { RenderFormat, VideoCodec } from "../core/types/config.js";
import { validateCodecContainer } from "./index.js";

export type PlatformPresetId =
  | "youtube-1080p"
  | "youtube-4k"
  | "youtube-shorts"
  | "tiktok"
  | "instagram-reels"
  | "instagram-feed-square"
  | "instagram-feed-portrait"
  | "linkedin"
  | "twitter"
  | "vimeo-pro"
  | "broadcast-sdi"
  | "archival-master"
  | "web-gif"
  | "web-webp";

export type PlatformAudioCodec = "aac" | "pcm_s16le" | "pcm_s24le" | "none";

export interface PlatformAudioSettings {
  readonly codec: PlatformAudioCodec;
  readonly bitrateKbps: number;
  readonly sampleRate: number;
  readonly channels: number;
  /** Integrated loudness target in LUFS. */
  readonly loudnessLufs: number;
}

export interface PlatformPresetVideo {
  readonly codec: VideoCodec;
  readonly crf: number;
}

export interface FullPlatformPreset {
  readonly id: PlatformPresetId;
  readonly label: string;
  readonly description: string;
  readonly format: RenderFormat;
  readonly video: PlatformPresetVideo;
  readonly audio: PlatformAudioSettings;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly aspectRatio: string;
  readonly maxFileSizeMB?: number;
  readonly extension: string;
  readonly constraints: readonly string[];
}

export const PLATFORM_PRESET_MAP: Readonly<Record<PlatformPresetId, FullPlatformPreset>> = {
  "youtube-1080p": {
    id: "youtube-1080p",
    label: "YouTube 1080p",
    description: "Standard YouTube upload: H.264, AAC 192 kbps, 1920x1080 at 30 fps.",
    format: "mp4",
    video: { codec: "h264", crf: 18 },
    audio: { codec: "aac", bitrateKbps: 192, sampleRate: 48000, channels: 2, loudnessLufs: -14 },
    width: 1920, height: 1080, fps: 30, aspectRatio: "16:9", extension: ".mp4",
    constraints: ["Use -14 LUFS integrated loudness", "Enable faststart for streaming"],
  },
  "youtube-4k": {
    id: "youtube-4k",
    label: "YouTube 4K",
    description: "UHD YouTube upload: H.264/HEVC, AAC 384 kbps, 3840x2160 at 30 fps.",
    format: "mp4",
    video: { codec: "h265", crf: 15 },
    audio: { codec: "aac", bitrateKbps: 384, sampleRate: 48000, channels: 2, loudnessLufs: -14 },
    width: 3840, height: 2160, fps: 30, aspectRatio: "16:9", extension: ".mp4",
    constraints: ["HEVC gives smaller files at this resolution", "Requires 10-bit friendly preview"],
  },
  "youtube-shorts": {
    id: "youtube-shorts",
    label: "YouTube Shorts",
    description: "Vertical short-form video: H.264, AAC 128 kbps, 1080x1920 at 30 fps.",
    format: "mp4",
    video: { codec: "h264", crf: 20 },
    audio: { codec: "aac", bitrateKbps: 128, sampleRate: 48000, channels: 2, loudnessLufs: -14 },
    width: 1080, height: 1920, fps: 30, aspectRatio: "9:16", extension: ".mp4",
    constraints: ["Keep key content inside the central safe area"],
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    description: "TikTok upload: H.264, AAC 128 kbps, 1080x1920 at 30 fps under 287 MB.",
    format: "mp4",
    video: { codec: "h264", crf: 20 },
    audio: { codec: "aac", bitrateKbps: 128, sampleRate: 48000, channels: 2, loudnessLufs: -14 },
    width: 1080, height: 1920, fps: 30, aspectRatio: "9:16", maxFileSizeMB: 287, extension: ".mp4",
    constraints: ["Upload limit 287 MB", "Loudness target -14 LUFS"],
  },
  "instagram-reels": {
    id: "instagram-reels",
    label: "Instagram Reels",
    description: "Reels: H.264, AAC 128 kbps, 1080x1920 at 30 fps under 400 MB.",
    format: "mp4",
    video: { codec: "h264", crf: 20 },
    audio: { codec: "aac", bitrateKbps: 128, sampleRate: 48000, channels: 2, loudnessLufs: -14 },
    width: 1080, height: 1920, fps: 30, aspectRatio: "9:16", maxFileSizeMB: 400, extension: ".mp4",
    constraints: ["Upload limit 400 MB"],
  },
  "instagram-feed-square": {
    id: "instagram-feed-square",
    label: "Instagram Feed (Square)",
    description: "Square feed video: H.264, AAC 128 kbps, 1080x1080 at 30 fps.",
    format: "mp4",
    video: { codec: "h264", crf: 20 },
    audio: { codec: "aac", bitrateKbps: 128, sampleRate: 48000, channels: 2, loudnessLufs: -14 },
    width: 1080, height: 1080, fps: 30, aspectRatio: "1:1", extension: ".mp4",
    constraints: ["Square crop must keep the subject centered"],
  },
  "instagram-feed-portrait": {
    id: "instagram-feed-portrait",
    label: "Instagram Feed (Portrait)",
    description: "Portrait feed video: H.264, AAC 128 kbps, 1080x1350 at 30 fps.",
    format: "mp4",
    video: { codec: "h264", crf: 20 },
    audio: { codec: "aac", bitrateKbps: 128, sampleRate: 48000, channels: 2, loudnessLufs: -14 },
    width: 1080, height: 1350, fps: 30, aspectRatio: "4:5", extension: ".mp4",
    constraints: ["4:5 uses more vertical feed space than 1:1"],
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    description: "LinkedIn feed: H.264, AAC 128 kbps, 1920x1080 at 30 fps.",
    format: "mp4",
    video: { codec: "h264", crf: 20 },
    audio: { codec: "aac", bitrateKbps: 128, sampleRate: 48000, channels: 2, loudnessLufs: -14 },
    width: 1920, height: 1080, fps: 30, aspectRatio: "16:9", extension: ".mp4",
    constraints: ["Captions recommended: many viewers watch muted"],
  },
  twitter: {
    id: "twitter",
    label: "Twitter / X",
    description: "X video upload: H.264, AAC 128 kbps, 1920x1080 at 30 fps under 512 MB.",
    format: "mp4",
    video: { codec: "h264", crf: 20 },
    audio: { codec: "aac", bitrateKbps: 128, sampleRate: 48000, channels: 2, loudnessLufs: -14 },
    width: 1920, height: 1080, fps: 30, aspectRatio: "16:9", maxFileSizeMB: 512, extension: ".mp4",
    constraints: ["Upload limit 512 MB"],
  },
  "vimeo-pro": {
    id: "vimeo-pro",
    label: "Vimeo Pro",
    description: "High-quality Vimeo upload: H.264 (or ProRes), 1920x1080 at 24 fps.",
    format: "mp4",
    video: { codec: "h264", crf: 15 },
    audio: { codec: "aac", bitrateKbps: 320, sampleRate: 48000, channels: 2, loudnessLufs: -14 },
    width: 1920, height: 1080, fps: 24, aspectRatio: "16:9", extension: ".mp4",
    constraints: ["ProRes master can be uploaded as MOV with -format prores"],
  },
  "broadcast-sdi": {
    id: "broadcast-sdi",
    label: "Broadcast SDI (Rec.709)",
    description: "Broadcast master: ProRes 422, PCM 48 kHz, 1920x1080 at 25 fps.",
    format: "prores",
    video: { codec: "prores", crf: 0 },
    audio: { codec: "pcm_s24le", bitrateKbps: 2304, sampleRate: 48000, channels: 2, loudnessLufs: -23 },
    width: 1920, height: 1080, fps: 25, aspectRatio: "16:9", extension: ".mov",
    constraints: ["EBU R128 loudness target -23 LUFS", "Rec.709 color space", "NTSC variant: use 29.97 fps"],
  },
  "archival-master": {
    id: "archival-master",
    label: "Archival Master",
    description: "Lossless master: ProRes 4444 with alpha, PCM 24-bit 48 kHz, 24 fps.",
    format: "prores-alpha",
    video: { codec: "prores", crf: 0 },
    audio: { codec: "pcm_s24le", bitrateKbps: 2304, sampleRate: 48000, channels: 2, loudnessLufs: -23 },
    width: 1920, height: 1080, fps: 24, aspectRatio: "16:9", extension: ".mov",
    constraints: ["Preserve alpha channel", "Store original audio stems alongside"],
  },
  "web-gif": {
    id: "web-gif",
    label: "Web GIF",
    description: "Looping GIF: 500 px wide, 15 fps, 256 colors, no audio.",
    format: "gif",
    video: { codec: "h264", crf: 0 },
    audio: { codec: "none", bitrateKbps: 0, sampleRate: 0, channels: 0, loudnessLufs: 0 },
    width: 500, height: 500, fps: 15, aspectRatio: "1:1", maxFileSizeMB: 5, extension: ".gif",
    constraints: ["Max width 500 px", "No audio", "Palette limited to 256 colors"],
  },
  "web-webp": {
    id: "web-webp",
    label: "Animated WebP",
    description: "Animated WebP: max 1080 px wide, 30 fps, alpha supported, no audio.",
    format: "webp",
    video: { codec: "h264", crf: 0 },
    audio: { codec: "none", bitrateKbps: 0, sampleRate: 0, channels: 0, loudnessLufs: 0 },
    width: 1080, height: 1080, fps: 30, aspectRatio: "1:1", extension: ".webp",
    constraints: ["Max width 1080 px", "No audio", "Alpha channel supported"],
  },
};

const PRESET_ALIASES: Readonly<Record<string, PlatformPresetId>> = {
  shorts: "youtube-shorts",
  reels: "instagram-reels",
  x: "twitter",
  "twitter-x": "twitter",
  "instagram-feed": "instagram-feed-square",
  "instagram-square": "instagram-feed-square",
  "instagram-portrait": "instagram-feed-portrait",
  "web-webp-animation": "web-webp",
  "animated-webp": "web-webp",
  gif: "web-gif",
};

export function getPreset(id: string): FullPlatformPreset | null {
  const normalized = id.toLowerCase().trim();
  const resolvedId = PRESET_ALIASES[normalized] ?? (normalized as PlatformPresetId);
  return PLATFORM_PRESET_MAP[resolvedId] ?? null;
}

export function listPresets(): readonly FullPlatformPreset[] {
  return Object.values(PLATFORM_PRESET_MAP);
}

export function listPresetIds(): readonly string[] {
  return Object.keys(PLATFORM_PRESET_MAP);
}

export function validatePreset(id: string): string | null {
  const preset = getPreset(id);
  if (!preset) return `Unknown platform preset "${id}". Available: ${listPresetIds().join(", ")}`;
  if (preset.format === "gif" || preset.format === "webp") return null;
  return validateCodecContainer(preset.format, preset.video.codec);
}

export function presetResolution(id: string): { width: number; height: number } | null {
  const preset = getPreset(id);
  return preset ? { width: preset.width, height: preset.height } : null;
}
