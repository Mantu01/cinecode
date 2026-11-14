import { spawn } from "node:child_process";
import ffmpegStatic from "@ffmpeg-installer/ffmpeg";
import type { AudioBuffer } from "./types.js";

export type AudioMuxCodec = "aac" | "opus" | "ac3" | "eac3" | "flac" | "pcm_s24le";

const MUX_AUDIO_CODECS: Readonly<Record<AudioMuxCodec, { readonly ffmpeg: string; readonly lossy: boolean }>> = {
  aac: { ffmpeg: "aac", lossy: true },
  opus: { ffmpeg: "libopus", lossy: true },
  ac3: { ffmpeg: "ac3", lossy: true },
  eac3: { ffmpeg: "eac3", lossy: true },
  flac: { ffmpeg: "flac", lossy: false },
  pcm_s24le: { ffmpeg: "pcm_s24le", lossy: false },
};

export interface MuxerOptions {
  readonly videoPath: string;
  readonly audioBuffer: AudioBuffer;
  readonly outputPath: string;
  readonly overwrite?: boolean;
  readonly audioCodec?: AudioMuxCodec;
  readonly audioBitrateKbps?: number;
  readonly channelLayout?: string;
  readonly audioChannels?: number;
  /** Explicit container for staged outputs whose filename has no media extension. */
  readonly containerFormat?: "mp4" | "webm" | "mov";
}

export interface MuxResult {
  readonly success: boolean;
  readonly outputPath: string;
  readonly duration: number;
  readonly error?: string;
}

function writeWavHeader(
  sampleRate: number,
  channels: number,
  dataLength: number
): Buffer {
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;
  const buffer = Buffer.alloc(44);
  
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength * 2, 40);
  
  return buffer;
}

function float32ToInt16(float32: Float32Array): Buffer {
  const int16 = Buffer.alloc(float32.length * 2);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]!));
    int16.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  return int16;
}

export function encodeWavBuffer(audioBuffer: AudioBuffer): Buffer {
  const header = writeWavHeader(
    audioBuffer.sampleRate,
    audioBuffer.channels,
    audioBuffer.data.length,
  );
  const pcmData = float32ToInt16(audioBuffer.data);
  return Buffer.concat([header, pcmData]);
}

export async function muxAudioVideo(options: MuxerOptions): Promise<MuxResult> {
  const { videoPath, audioBuffer, outputPath, overwrite = false } = options;
  const audioCodec = options.audioCodec ?? "aac";
  const codecSpec = MUX_AUDIO_CODECS[audioCodec];
  
  const wavHeader = writeWavHeader(
    audioBuffer.sampleRate,
    audioBuffer.channels,
    audioBuffer.data.length
  );
  const pcmData = float32ToInt16(audioBuffer.data);
  const wavData = Buffer.concat([wavHeader, pcmData]);

  return new Promise((resolve) => {
    const args = [
      "-v", "error",
      ...(overwrite ? ["-y"] : ["-n"]),
      "-i", videoPath,
      "-i", "-",
      "-c:v", "copy",
      "-c:a", codecSpec.ffmpeg,
      ...(codecSpec.lossy ? ["-b:a", `${options.audioBitrateKbps ?? (audioCodec === "opus" ? 160 : 192)}k`] : []),
      ...(options.audioChannels !== undefined ? ["-ac", String(options.audioChannels)] : []),
      ...(options.channelLayout !== undefined ? ["-channel_layout", options.channelLayout] : []),
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-shortest",
      ...(options.containerFormat ? ["-f", options.containerFormat] : []),
      outputPath,
    ];

    const child = spawn(ffmpegStatic.path, args, { windowsHide: true });
    let stderr = "";

    child.stdin.on("error", (err) => {
      if (!stderr) stderr = err.message;
    });
    child.stdin.end(wavData);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve({
          success: false,
          outputPath,
          duration: 0,
          error: `ffmpeg mux failed: ${stderr}`,
        });
        return;
      }
      resolve({
        success: true,
        outputPath,
        duration: audioBuffer.length / audioBuffer.sampleRate,
      });
    });

    child.on("error", (err) => {
      resolve({
        success: false,
        outputPath,
        duration: 0,
        error: `Failed to spawn ffmpeg: ${err.message}`,
      });
    });
  });
}

export async function muxAudioVideoWithFfmpeg(
  videoPath: string,
  audioBuffer: AudioBuffer,
  outputPath: string,
  overwrite = false
): Promise<MuxResult> {
  return muxAudioVideo({ videoPath, audioBuffer, outputPath, overwrite });
}

export function createAudioBufferFromVideoAudio(
  videoPath: string,
  targetSampleRate: number,
  targetChannels: 1 | 2
): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v", "error",
      "-i", videoPath,
      "-f", "f32le",
      "-ar", String(targetSampleRate),
      "-ac", String(targetChannels),
      "-",
    ];

    const child = spawn(ffmpegStatic.path, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk) => { chunks.push(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

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