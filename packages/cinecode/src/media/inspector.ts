import { spawn } from "node:child_process";
import ffprobeStatic from "@ffprobe-installer/ffprobe";
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

  const result = await probeWithFfprobe(filePath);
  const metadata: MediaMetadata = {
    duration: result.duration,
    width: result.width,
    height: result.height,
    fps: result.fps,
    hasAudio: result.hasAudio,
    sampleRate: result.sampleRate,
    videoCodec: result.videoCodec,
    audioCodec: result.audioCodec,
  };

  await options.cache.setMetadata(filePath, metadata);
  return metadata;
}

function probeWithFfprobe(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ];

    const child = spawn(ffprobeStatic.path, args, { windowsHide: true });
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
  let hasAudio = false;
  let sampleRate: number | undefined;
  let audioCodec: string | undefined;

  if (videoStream) {
    width = Number(videoStream.width ?? 0);
    height = Number(videoStream.height ?? 0);
    fps = parseFps(String(videoStream.r_frame_rate ?? videoStream.avg_frame_rate ?? "30/1"));
    videoCodec = String(videoStream.codec_name ?? "");
  }

  if (audioStream) {
    hasAudio = true;
    sampleRate = Number(audioStream.sample_rate ?? 0) || undefined;
    audioCodec = String(audioStream.codec_name ?? "");
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
  };
}

export function isSupportedVideoExtension(ext: string): boolean {
  return ["mp4", "mov", "mkv", "webm"].includes(ext.toLowerCase());
}

export function isSupportedImageExtension(ext: string): boolean {
  return ["png", "jpg", "jpeg", "webp", "gif"].includes(ext.toLowerCase());
}

export function isSupportedAudioExtension(ext: string): boolean {
  return ["wav", "mp3", "m4a", "aac", "ogg", "flac"].includes(ext.toLowerCase());
}

export function getMediaType(filePath: string): "video" | "image" | "audio" | "unknown" {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (isSupportedVideoExtension(ext)) return "video";
  if (isSupportedImageExtension(ext)) return "image";
  if (isSupportedAudioExtension(ext)) return "audio";
  return "unknown";
}