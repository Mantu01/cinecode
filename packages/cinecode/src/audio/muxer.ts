import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { extname } from "node:path";
import { resolveBinary } from "../binary/resolver.js";
import type { AudioBuffer } from "./types.js";
import type { PcmBitDepth } from "./encode.js";
import { createError, ErrorCode } from "../errors/codes.js";

export type AudioMuxCodec = "aac" | "opus" | "ac3" | "eac3" | "flac" | "pcm_s24le";
export type MuxContainer = "mp4" | "webm" | "mov" | "matroska" | "avi";
export type AudioDurationAdjustment = "none" | "padded" | "trimmed";

interface AudioCodecSpec {
  readonly ffmpeg: string;
  readonly lossy: boolean;
  readonly containers: readonly MuxContainer[];
  readonly bitDepth: PcmBitDepth;
}

export const MUX_AUDIO_CODECS: Readonly<Record<AudioMuxCodec, AudioCodecSpec>> = {
  aac: { ffmpeg: "aac", lossy: true, containers: ["mp4", "mov", "matroska"], bitDepth: 32 },
  opus: { ffmpeg: "libopus", lossy: true, containers: ["webm", "matroska"], bitDepth: 32 },
  ac3: { ffmpeg: "ac3", lossy: true, containers: ["mp4", "mov", "matroska", "avi"], bitDepth: 32 },
  eac3: { ffmpeg: "eac3", lossy: true, containers: ["mp4", "mov", "matroska"], bitDepth: 32 },
  flac: { ffmpeg: "flac", lossy: false, containers: ["mp4", "mov", "matroska"], bitDepth: 24 },
  pcm_s24le: { ffmpeg: "pcm_s24le", lossy: false, containers: ["mov", "matroska", "avi"], bitDepth: 24 },
};

const DEFAULT_BITRATE_KBPS: Readonly<Record<AudioMuxCodec, number>> = {
  aac: 192,
  opus: 160,
  ac3: 384,
  eac3: 384,
  flac: 0,
  pcm_s24le: 0,
};

const CONTAINER_EXTENSIONS: Readonly<Record<string, MuxContainer>> = {
  ".mp4": "mp4",
  ".m4v": "mp4",
  ".webm": "webm",
  ".mov": "mov",
  ".mkv": "matroska",
  ".avi": "avi",
};

export interface MuxAudioFormat {
  readonly audioCodec?: AudioMuxCodec;
  readonly audioBitrateKbps?: number;
  readonly channelLayout?: string;
  readonly audioChannels?: number;
  readonly pcmBitDepth?: PcmBitDepth;
  readonly containerFormat?: MuxContainer;
  readonly outputPath?: string;
}

export interface MuxAudioPlan {
  readonly codec: AudioMuxCodec;
  readonly ffmpegCodec: string;
  readonly lossy: boolean;
  readonly bitDepth: PcmBitDepth;
  readonly bitrateKbps?: number;
  readonly channels?: number;
  readonly channelLayout?: string;
  readonly container: MuxContainer;
}

export interface MuxerOptions extends MuxAudioFormat {
  readonly videoPath: string;
  readonly audioBuffer: AudioBuffer;
  readonly outputPath: string;
  readonly overwrite?: boolean;
  readonly videoDuration?: number;
  readonly signal?: AbortSignal;
}

export interface MuxResult {
  readonly success: boolean;
  readonly outputPath: string;
  readonly duration: number;
  readonly audioSeconds: number;
  readonly videoSeconds?: number;
  readonly adjustment: AudioDurationAdjustment;
  readonly codec?: AudioMuxCodec;
  readonly bitDepth?: PcmBitDepth;
  readonly error?: string;
}

function resolveContainer(options: MuxAudioFormat): MuxContainer {
  if (options.containerFormat) return options.containerFormat;
  const extension = options.outputPath ? extname(options.outputPath).toLowerCase() : "";
  return CONTAINER_EXTENSIONS[extension] ?? "mp4";
}

/** Resolves and validates the audio codec, bitrate, depth and layout up front. */
export function planMuxAudio(options: MuxAudioFormat): MuxAudioPlan {
  const container = resolveContainer(options);
  const codec = options.audioCodec ?? (container === "webm" ? "opus" : "aac");
  const spec = MUX_AUDIO_CODECS[codec];
  if (!spec) {
    throw createError(ErrorCode.CC4005, {
      reason: `unknown audio codec "${codec}"; expected one of ${Object.keys(MUX_AUDIO_CODECS).join(", ")}`,
    });
  }
  if (!spec.containers.includes(container)) {
    throw createError(ErrorCode.CC4005, {
      reason: `audio codec "${codec}" cannot be muxed into "${container}"; supported containers are ${spec.containers.join(", ")}`,
    });
  }
  const bitDepth = options.pcmBitDepth ?? spec.bitDepth;
  if (bitDepth !== 16 && bitDepth !== 24 && bitDepth !== 32) {
    throw createError(ErrorCode.CC4005, {
      reason: `audio bit depth ${String(bitDepth)} is not supported; expected 16, 24 or 32`,
    });
  }
  const requestedBitrate = options.audioBitrateKbps;
  if (requestedBitrate !== undefined) {
    if (!Number.isFinite(requestedBitrate) || requestedBitrate <= 0) {
      throw createError(ErrorCode.CC4005, {
        reason: `audio bitrate ${String(requestedBitrate)} kbps is not a positive number`,
      });
    }
    if (!spec.lossy) {
      throw createError(ErrorCode.CC4005, {
        reason: `audio codec "${codec}" is lossless and does not accept a bitrate, got ${requestedBitrate} kbps`,
      });
    }
  }
  const channels = options.audioChannels;
  if (channels !== undefined && channels !== 1 && channels !== 2 && channels !== 6 && channels !== 8) {
    throw createError(ErrorCode.CC4005, {
      reason: `audio channel count ${channels} is not supported; expected 1, 2, 6 or 8`,
    });
  }
  return {
    codec,
    ffmpegCodec: spec.ffmpeg,
    lossy: spec.lossy,
    bitDepth,
    bitrateKbps: spec.lossy ? requestedBitrate ?? DEFAULT_BITRATE_KBPS[codec] : undefined,
    channels,
    channelLayout: options.channelLayout,
    container,
  };
}

function writeWavHeader(
  sampleRate: number,
  channels: number,
  bitDepth: PcmBitDepth,
  dataBytes: number,
): Buffer {
  const bytesPerSample = bitDepth / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(bitDepth === 32 ? 3 : 1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  header.writeUInt16LE(channels * bytesPerSample, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

function encodePcm(
  source: Float32Array,
  offset: number,
  count: number,
  bitDepth: PcmBitDepth,
  target: Buffer,
): void {
  if (bitDepth === 32) {
    for (let i = 0; i < count; i += 1) target.writeFloatLE(source[offset + i] ?? 0, i * 4);
    return;
  }
  if (bitDepth === 24) {
    for (let i = 0; i < count; i += 1) {
      const value = Math.max(-1, Math.min(1, source[offset + i] ?? 0));
      const sample = Math.round(value * 8388607);
      target[i * 3] = sample & 0xff;
      target[i * 3 + 1] = (sample >> 8) & 0xff;
      target[i * 3 + 2] = (sample >> 16) & 0xff;
    }
    return;
  }
  for (let i = 0; i < count; i += 1) {
    const value = Math.max(-1, Math.min(1, source[offset + i] ?? 0));
    target.writeInt16LE(Math.round(value * 32767), i * 2);
  }
}

function writeChunk(stream: NodeJS.WritableStream, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error: Error | null | undefined) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/** Streams the WAV header and PCM blocks, so no full-length WAV is materialized. */
async function streamWav(
  stream: NodeJS.WritableStream,
  audioBuffer: AudioBuffer,
  bitDepth: PcmBitDepth,
): Promise<void> {
  const bytesPerSample = bitDepth / 8;
  const blockFrames = 8192;
  const blockBytes = blockFrames * audioBuffer.channels * bytesPerSample;
  await writeChunk(
    stream,
    writeWavHeader(
      audioBuffer.sampleRate,
      audioBuffer.channels,
      bitDepth,
      audioBuffer.length * audioBuffer.channels * bytesPerSample,
    ),
  );
  const block = Buffer.allocUnsafe(blockBytes);
  for (let start = 0; start < audioBuffer.length; start += blockFrames) {
    const frames = Math.min(blockFrames, audioBuffer.length - start);
    const samples = frames * audioBuffer.channels;
    const bytes = samples * bytesPerSample;
    encodePcm(audioBuffer.data, start * audioBuffer.channels, samples, bitDepth, block);
    await writeChunk(stream, bytes === blockBytes ? block : block.subarray(0, bytes));
  }
}

export function encodeWavBuffer(audioBuffer: AudioBuffer, bitDepth: PcmBitDepth = 32): Buffer {
  const bytesPerSample = bitDepth / 8;
  const dataBytes = audioBuffer.length * audioBuffer.channels * bytesPerSample;
  const data = Buffer.allocUnsafe(dataBytes);
  encodePcm(audioBuffer.data, 0, audioBuffer.data.length, bitDepth, data);
  return Buffer.concat([
    writeWavHeader(audioBuffer.sampleRate, audioBuffer.channels, bitDepth, dataBytes),
    data,
  ]);
}

function audioAdjustment(
  audioSeconds: number,
  videoSeconds: number | undefined,
): AudioDurationAdjustment {
  if (videoSeconds === undefined) return "none";
  if (audioSeconds > videoSeconds + 1e-6) return "trimmed";
  if (audioSeconds < videoSeconds - 1e-6) return "padded";
  return "none";
}

function muxArgs(
  options: MuxerOptions,
  plan: MuxAudioPlan,
  videoSeconds: number | undefined,
  adjustment: AudioDurationAdjustment,
): string[] {
  const filters =
    adjustment === "trimmed" && videoSeconds !== undefined
      ? ["-af", `atrim=duration=${videoSeconds}`]
      : adjustment === "padded"
        ? ["-af", "apad"]
        : [];
  return [
    "-v",
    "error",
    ...(options.overwrite ? ["-y"] : ["-n"]),
    "-i",
    options.videoPath,
    "-f",
    "wav",
    "-i",
    "pipe:0",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    plan.ffmpegCodec,
    ...(plan.bitrateKbps !== undefined ? ["-b:a", `${plan.bitrateKbps}k`] : []),
    ...(plan.channels !== undefined ? ["-ac", String(plan.channels)] : []),
    ...(plan.channelLayout !== undefined ? ["-channel_layout", plan.channelLayout] : []),
    ...filters,
    ...(videoSeconds !== undefined ? ["-t", String(videoSeconds)] : []),
    "-f",
    plan.container,
    options.outputPath,
  ];
}

export async function muxAudioVideo(options: MuxerOptions): Promise<MuxResult> {
  const plan = planMuxAudio(options);
  const audioSeconds = options.audioBuffer.length / options.audioBuffer.sampleRate;
  const videoSeconds = options.videoDuration;
  const adjustment = audioAdjustment(audioSeconds, videoSeconds);
  const args = muxArgs(options, plan, videoSeconds, adjustment);

  return new Promise((resolve) => {
    const child = spawn(resolveBinary("ffmpeg").path, args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;

    const finish = (result: MuxResult): void => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", abort);
      resolve(result);
    };

    const abort = (): void => {
      child.kill("SIGKILL");
    };
    options.signal?.addEventListener("abort", abort, { once: true });

    child.stdin.on("error", () => undefined);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      void rm(options.outputPath, { force: true }).catch(() => undefined);
      finish({
        success: false,
        outputPath: options.outputPath,
        duration: 0,
        audioSeconds,
        videoSeconds,
        adjustment,
        error: `failed to spawn ffmpeg: ${error.message}`,
      });
    });

    child.on("close", (code) => {
      if (code === 0) {
        finish({
          success: true,
          outputPath: options.outputPath,
          duration: videoSeconds ?? audioSeconds,
          audioSeconds,
          videoSeconds,
          adjustment,
          codec: plan.codec,
          bitDepth: plan.bitDepth,
        });
        return;
      }
      void rm(options.outputPath, { force: true }).catch(() => undefined);
      finish({
        success: false,
        outputPath: options.outputPath,
        duration: 0,
        audioSeconds,
        videoSeconds,
        adjustment,
        error: options.signal?.aborted
          ? "ffmpeg mux cancelled"
          : `ffmpeg mux failed: ${stderr.trim() || `exit code ${code ?? 1}`}`,
      });
    });

    void streamWav(child.stdin, options.audioBuffer, plan.bitDepth)
      .then(() => child.stdin.end())
      .catch(() => child.stdin.destroy());
  });
}

export async function muxAudioVideoWithFfmpeg(
  videoPath: string,
  audioBuffer: AudioBuffer,
  outputPath: string,
  overwrite = false,
): Promise<MuxResult> {
  return muxAudioVideo({ videoPath, audioBuffer, outputPath, overwrite });
}

export function createAudioBufferFromVideoAudio(
  videoPath: string,
  targetSampleRate: number,
  targetChannels: 1 | 2,
): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-i",
      videoPath,
      "-f",
      "f32le",
      "-ar",
      String(targetSampleRate),
      "-ac",
      String(targetChannels),
      "-",
    ];

    const child = spawn(resolveBinary("ffmpeg").path, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg audio extraction failed: ${stderr}`));
        return;
      }
      const buffer = Buffer.concat(chunks);
      const float32 = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
      resolve({
        sampleRate: targetSampleRate,
        channels: targetChannels,
        length: float32.length / targetChannels,
        data: float32,
      });
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });
  });
}
