import { spawn } from "node:child_process";
import ffmpegStatic from "@ffmpeg-installer/ffmpeg";
import type { AudioBuffer } from "./types.js";
import type { MediaCache } from "../media/cache.js";
import { createError, ErrorCode } from "../errors/codes.js";

export interface AudioDecodeOptions {
  cache?: MediaCache;
  targetSampleRate: number;
  targetChannels: number;
}

export interface DecodedAudio {
  readonly buffer: AudioBuffer;
  readonly duration: number;
  readonly originalSampleRate: number;
  readonly originalChannels: number;
}

async function getFfprobeStatic(): Promise<{ path: string }> {
  const mod = await import("@ffprobe-installer/ffprobe");
  return mod.default;
}

export async function getAudioInfo(filePath: string): Promise<{
  duration: number;
  sampleRate: number;
  channels: number;
  codec: string;
}> {
  const ffprobeStatic = await getFfprobeStatic();
  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=sample_rate,channels,duration,codec_name",
      "-of",
      "json",
      filePath,
    ];

    const child = spawn(ffprobeStatic.path, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(createError(ErrorCode.CC2003, { path: filePath, reason: `ffprobe failed: ${stderr}` }, { location: { file: filePath } }));
        return;
      }
      try {
        const data = JSON.parse(stdout);
        const stream = data.streams?.[0];
        if (!stream) {
          reject(createError(ErrorCode.CC2003, { path: filePath, reason: "No audio stream found" }, { location: { file: filePath } }));
          return;
        }
        resolve({
          duration: parseFloat(stream.duration) || 0,
          sampleRate: Number(stream.sample_rate) || 48000,
          channels: Number(stream.channels) || 2,
          codec: String(stream.codec_name) || "unknown",
        });
      } catch (error) {
        reject(createError(ErrorCode.CC2003, { path: filePath, reason: `Failed to parse ffprobe output: ${error instanceof Error ? error.message : String(error)}` }, { location: { file: filePath }, cause: error }));
      }
    });

    child.on("error", (err) => {
      reject(createError(ErrorCode.CC2003, { path: filePath, reason: `Failed to spawn ffprobe: ${err.message}` }, { location: { file: filePath }, cause: err }));
    });
  });
}

export async function decodeAudioFile(
  filePath: string,
  options: AudioDecodeOptions,
): Promise<DecodedAudio> {
  const cacheKey = `audio-${filePath}-${options.targetSampleRate}-${options.targetChannels}`;
  const cache = options.cache;
  const cached = cache ? await cache.getMetadata(cacheKey) : null;
  if (cached && cached.duration > 0 && cache) {
    const cachedBuffer = await cache.getFrame(cacheKey, 0);
    if (cachedBuffer) {
      const float32 = new Float32Array(cachedBuffer.buffer);
      return {
        buffer: {
          sampleRate: options.targetSampleRate,
          channels: options.targetChannels,
          length: float32.length / options.targetChannels,
          data: float32,
        },
        duration: cached.duration,
        originalSampleRate: cached.sampleRate ?? options.targetSampleRate,
        originalChannels: cached.channels ?? options.targetChannels,
      };
    }
  }

  const info = await getAudioInfo(filePath);

  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-i",
      filePath,
      "-f",
      "f32le",
      "-ar",
      String(options.targetSampleRate),
      "-ac",
      String(options.targetChannels),
      "-",
    ];

    const child = spawn(ffmpegStatic.path, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg audio decode failed: ${stderr}`));
        return;
      }

      const buffer = Buffer.concat(chunks);
      const float32 = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);

      const decoded: DecodedAudio = {
        buffer: {
          sampleRate: options.targetSampleRate,
          channels: options.targetChannels,
          length: float32.length / options.targetChannels,
          data: float32,
        },
        duration: info.duration,
        originalSampleRate: info.sampleRate,
        originalChannels: info.channels,
      };

      await cache
        ?.setMetadata(cacheKey, {
          duration: decoded.duration,
          width: 0,
          height: 0,
          fps: 0,
          hasAudio: true,
          sampleRate: options.targetSampleRate,
        })
        .catch(() => {});
      await cache?.setFrame(cacheKey, 0, Buffer.from(float32.buffer)).catch(() => {});

      resolve(decoded);
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });
  });
}

export async function decodeVideoAudioTrack(
  filePath: string,
  options: AudioDecodeOptions,
): Promise<DecodedAudio | null> {
  const info = await getAudioInfo(filePath);
  if (!info || info.duration === 0) return null;
  return decodeAudioFile(filePath, options);
}

export function createAudioBufferFromData(
  data: Float32Array,
  sampleRate: number,
  channels: number,
): AudioBuffer {
  return {
    sampleRate,
    channels,
    length: data.length / channels,
    data,
  };
}
