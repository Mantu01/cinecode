import { spawn } from "node:child_process";
import { extname } from "node:path";
import { resolveBinary } from "../binary/resolver.js";
import { recordProcessSpawn } from "./instrumentation.js";
import type { MediaMetadata, MediaCache } from "./cache.js";

export interface InspectorOptions {
  cache: MediaCache;
  sourceDir: string;
}

export interface ProbeResult {
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly hasAudio: boolean;
  readonly sampleRate?: number;
  readonly videoCodec?: string;
  readonly audioCodec?: string;
  readonly pixelFormat?: string;
  readonly streamCount: number;
  readonly videoDuration?: number;
  readonly audioDuration?: number;
  readonly audioChannels?: number;
  readonly audioBitDepth?: number;
  readonly audioSampleFormat?: string;
}

export function normalizeMediaCodec(codec: string | undefined): string | undefined {
  if (!codec) return undefined;
  const aliases: Readonly<Record<string, string>> = {
    libx264: "h264",
    h264: "h264",
    libx265: "h265",
    h265: "h265",
    hevc: "h265",
    libaom_av1: "av1",
    libsvtav1: "av1",
    av1: "av1",
    aprores: "prores",
    prores: "prores",
    libvpx_vp9: "vp9",
    vp9: "vp9",
    ffv1: "ffv1",
    utvideo: "utvideo",
    libopus: "opus",
    opus: "opus",
    ac3: "ac3",
    eac3: "eac3",
    flac: "flac",
    pcm_s16le: "pcm_s16le",
    pcm_s24le: "pcm_s24le",
    pcm_s32le: "pcm_s32le",
  };
  return aliases[codec.toLowerCase()] ?? codec.toLowerCase();
}

function parseFps(rate: string): number {
  const parts = rate.split("/");
  const num = Number(parts[0]);
  const den = Number(parts[1]);
  if (parts.length === 2 && den !== 0) {
    return num / den;
  }
  return parseFloat(rate) || 30;
}

export async function inspectMedia(
  filePath: string,
  options: InspectorOptions
): Promise<MediaMetadata> {
  const cached = await options.cache.getMetadata(filePath);
  if (cached) return cached;

  const result = await probeMediaFile(filePath);
  const metadata: MediaMetadata = {
    duration: result.duration,
    width: result.width,
    height: result.height,
    fps: result.fps,
    hasAudio: result.hasAudio,
    sampleRate: result.sampleRate,
    videoCodec: result.videoCodec,
    audioCodec: result.audioCodec,
    pixelFormat: result.pixelFormat,
  };

  await options.cache.setMetadata(filePath, metadata);
  return metadata;
}

export function probeMediaFile(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ];

    recordProcessSpawn();
    const child = spawn(resolveBinary("ffprobe").path, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed with code ${code}: ${stderr}`));
        return;
      }
      try {
        const data = JSON.parse(stdout);
        const result = parseProbeData(data);
        resolve(result);
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe output: ${e}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn ffprobe: ${err.message}`));
    });
  });
}

function parseProbeData(data: Record<string, unknown>): ProbeResult {
  const format = data.format as Record<string, unknown> | undefined;
  const streams = (data.streams as unknown[]) ?? [];

  const videoStream = streams.find(s => (s as Record<string, unknown>).codec_type === "video") as Record<string, unknown> | undefined;
  const audioStream = streams.find(s => (s as Record<string, unknown>).codec_type === "audio") as Record<string, unknown> | undefined;

  const duration = parseFloat(String(format?.duration ?? "0")) || 0;

  let width = 0;
  let height = 0;
  let fps = 30;
  let videoCodec: string | undefined;
  let videoDuration: number | undefined;
  let pixelFormat: string | undefined;
  let hasAudio = false;
  let sampleRate: number | undefined;
  let audioCodec: string | undefined;
  let audioDuration: number | undefined;
  let audioChannels: number | undefined;
  let audioBitDepth: number | undefined;
  let audioSampleFormat: string | undefined;

  if (videoStream) {
    width = Number(videoStream.width ?? 0);
    height = Number(videoStream.height ?? 0);
    fps = parseFps(String(videoStream.r_frame_rate ?? videoStream.avg_frame_rate ?? "30/1"));
    videoCodec = String(videoStream.codec_name ?? "");
    videoDuration = Number(videoStream.duration ?? "") || undefined;
    pixelFormat = videoStream.pix_fmt ? String(videoStream.pix_fmt) : undefined;
  }

  if (audioStream) {
    hasAudio = true;
    sampleRate = Number(audioStream.sample_rate ?? 0) || undefined;
    audioCodec = String(audioStream.codec_name ?? "");
    audioDuration = Number(audioStream.duration ?? "") || undefined;
    audioChannels = Number(audioStream.channels ?? 0) || undefined;
    audioBitDepth = Number(audioStream.bits_per_raw_sample ?? audioStream.bits_per_sample ?? 0) || undefined;
    audioSampleFormat = audioStream.sample_fmt === undefined ? undefined : String(audioStream.sample_fmt);
  }

  return {
    duration,
    width,
    height,
    fps,
    hasAudio,
    sampleRate,
    videoCodec,
    audioCodec,
    pixelFormat,
    streamCount: streams.length,
    videoDuration,
    audioDuration,
    audioChannels,
    audioBitDepth,
    audioSampleFormat,
  };
}

export function isSupportedVideoExtension(ext: string): boolean {
  return ["mp4", "mov", "mkv", "webm", "avi", "m4v"].includes(ext.toLowerCase());
}

export function isSupportedImageExtension(ext: string): boolean {
  return ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "tiff"].includes(ext.toLowerCase());
}

export function isSupportedAudioExtension(ext: string): boolean {
  return ["wav", "mp3", "m4a", "aac", "ogg", "flac"].includes(ext.toLowerCase());
}

export function isSupportedFontExtension(ext: string): boolean {
  return ["ttf", "otf", "woff", "woff2"].includes(ext.toLowerCase());
}

export function isSupportedLutExtension(ext: string): boolean {
  return ["cube", "3dl"].includes(ext.toLowerCase());
}

export type MediaFileType = "video" | "image" | "audio" | "font" | "lut" | "unknown";

function extractNormalizedExtension(filePath: string): string {
  const ext = extname(filePath);
  return ext ? ext.slice(1).toLowerCase() : "";
}

export function getMediaType(filePath: string): "video" | "image" | "audio" | "unknown" {
  const ext = extractNormalizedExtension(filePath);
  if (isSupportedVideoExtension(ext)) return "video";
  if (isSupportedImageExtension(ext)) return "image";
  if (isSupportedAudioExtension(ext)) return "audio";
  return "unknown";
}

export function getExtendedMediaType(filePath: string): MediaFileType {
  const ext = extractNormalizedExtension(filePath);
  if (isSupportedVideoExtension(ext)) return "video";
  if (isSupportedImageExtension(ext)) return "image";
  if (isSupportedAudioExtension(ext)) return "audio";
  if (isSupportedFontExtension(ext)) return "font";
  if (isSupportedLutExtension(ext)) return "lut";
  return "unknown";
}