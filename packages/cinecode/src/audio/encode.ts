import { spawn } from "node:child_process";
import ffmpegStatic from "@ffmpeg-installer/ffmpeg";
import { encodeWavBuffer } from "./muxer.js";
import type { AudioBuffer } from "./types.js";

export type AudioEncodeFormat =
  | "wav"
  | "mp3"
  | "flac"
  | "ogg"
  | "aac"
  | "he-aac"
  | "opus"
  | "ac3"
  | "eac3"
  | "pcm";

export type AudioContainer = "wav" | "mp4" | "mkv" | "webm" | "mov" | "flac" | "ogg";

export type PcmBitDepth = 16 | 24 | 32;

export interface AudioEncodeOptions {
  readonly format: AudioEncodeFormat;
  readonly bitrate?: string;
  readonly overwrite?: boolean;
  readonly sampleRate?: number;
  readonly channels?: number;
  readonly bitDepth?: PcmBitDepth;
  readonly container?: AudioContainer;
  readonly channelLayout?: string;
}

export interface AudioEncodeResult {
  readonly success: boolean;
  readonly outputPath: string;
  readonly duration: number;
  readonly error?: string;
}

export interface AudioEncodingSupport {
  readonly supported: boolean;
  readonly codec: string;
  readonly container: AudioContainer;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

const LOSSLESS_FORMATS: ReadonlySet<AudioEncodeFormat> = new Set(["wav", "flac", "pcm"]);

export function audioCodecFor(format: AudioEncodeFormat, bitDepth: PcmBitDepth = 16): string {
  switch (format) {
    case "mp3":
      return "libmp3lame";
    case "flac":
      return "flac";
    case "ogg":
      return "libvorbis";
    case "aac":
      return "aac";
    case "he-aac":
      return "aac";
    case "opus":
      return "libopus";
    case "ac3":
      return "ac3";
    case "eac3":
      return "eac3";
    case "pcm":
      return bitDepth === 32 ? "pcm_f32le" : bitDepth === 24 ? "pcm_s24le" : "pcm_s16le";
    default:
      return `pcm_s${bitDepth}le`;
  }
}

const FORMAT_CONTAINERS: Readonly<Record<AudioEncodeFormat, readonly AudioContainer[]>> = {
  wav: ["wav", "mkv", "mov"],
  mp3: ["mp4", "mkv"],
  flac: ["flac", "mkv", "mov"],
  ogg: ["ogg", "webm"],
  aac: ["mp4", "mkv", "mov"],
  "he-aac": ["mp4", "mkv"],
  opus: ["webm", "mkv", "ogg"],
  ac3: ["mp4", "mkv", "mov"],
  eac3: ["mp4", "mkv"],
  pcm: ["wav", "mov", "mkv"],
};

export function validateAudioEncoding(
  format: AudioEncodeFormat,
  container: AudioContainer,
  options: { readonly channels?: number; readonly sampleRate?: number; readonly bitDepth?: PcmBitDepth } = {},
): AudioEncodingSupport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const containers = FORMAT_CONTAINERS[format];
  if (!containers.includes(container)) {
    errors.push(`Codec '${format}' is not supported in container '${container}'. Supported: ${containers.join(", ")}`);
  }
  const channels = options.channels ?? 2;
  const sampleRate = options.sampleRate ?? 48000;
  if ((format === "ac3" || format === "eac3") && channels > 6) {
    errors.push(`Codec '${format}' supports at most 5.1 (6 channels); received ${channels}`);
  }
  if (format === "opus" && channels <= 2 && sampleRate > 48000) {
    warnings.push("Opus internally resamples to 48 kHz");
  }
  if (format === "he-aac" && sampleRate < 32000) {
    warnings.push("HE-AAC typically requires a 32 kHz or 44.1 kHz source sample rate");
  }
  if (format === "flac" && options.bitDepth !== undefined && options.bitDepth !== 16 && options.bitDepth !== 24) {
    errors.push("FLAC supports 16-bit or 24-bit samples");
  }
  return {
    supported: errors.length === 0,
    codec: audioCodecFor(format, options.bitDepth),
    container,
    errors,
    warnings,
  };
}

export async function encodeAudioFile(
  audioBuffer: AudioBuffer,
  outputPath: string,
  options: AudioEncodeOptions,
): Promise<AudioEncodeResult> {
  const { format, bitrate = "192k", overwrite = false } = options;
  const codec = audioCodecFor(format, options.bitDepth);
  const validation = validateAudioEncoding(format, options.container ?? "wav", {
    channels: options.channels ?? audioBuffer.channels,
    sampleRate: options.sampleRate ?? audioBuffer.sampleRate,
    bitDepth: options.bitDepth,
  });
  if (!validation.supported) {
    return { success: false, outputPath, duration: 0, error: `CC5601: ${validation.errors.join("; ")}` };
  }

  const wavData = encodeWavBuffer(audioBuffer);
  const args = [
    "-v", "error",
    ...(overwrite ? ["-y"] : ["-n"]),
    "-i", "-",
    "-c:a", codec,
    ...(LOSSLESS_FORMATS.has(format) ? [] : ["-b:a", bitrate]),
    ...(format === "he-aac" ? ["-profile:a", "aac_he"] : []),
    ...(options.sampleRate !== undefined ? ["-ar", String(options.sampleRate)] : []),
    ...(options.channels !== undefined ? ["-ac", String(options.channels)] : []),
    ...(options.channelLayout !== undefined ? ["-channel_layout", options.channelLayout] : []),
    ...(options.container !== undefined ? ["-f", options.container] : []),
    outputPath,
  ];

  return new Promise<AudioEncodeResult>((resolve) => {
    const child = spawn(ffmpegStatic.path, args, { windowsHide: true });
    let stderr = "";
    child.stdin.on("error", (err) => {
      if (!stderr) stderr = err.message;
    });
    child.stdin.end(wavData);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ success: false, outputPath, duration: 0, error: `ffmpeg audio encode failed: ${stderr}` });
        return;
      }
      resolve({ success: true, outputPath, duration: audioBuffer.length / audioBuffer.sampleRate });
    });
    child.on("error", (err) => {
      resolve({ success: false, outputPath, duration: 0, error: `Failed to spawn ffmpeg: ${err.message}` });
    });
  });
}
