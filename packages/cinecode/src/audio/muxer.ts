import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolveBinary } from "../binary/resolver.js";
import type { AudioBuffer, AudioStreamSource } from "./types.js";
import type { PcmBitDepth } from "./encode.js";
import {
  planMuxAudio,
  type AudioDurationAdjustment,
  type MuxAudioFormat,
  type MuxAudioPlan,
  type MuxerOptions,
  type MuxResult,
} from "./mux-plan.js";

export * from "./mux-plan.js";

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

async function streamWavFromSource(
  stream: NodeJS.WritableStream,
  source: AudioStreamSource,
  bitDepth: PcmBitDepth,
  signal?: AbortSignal,
): Promise<void> {
  const bytesPerSample = bitDepth / 8;
  const totalBytes = source.totalFrames * source.channels * bytesPerSample;
  await writeChunk(
    stream,
    writeWavHeader(source.sampleRate, source.channels, bitDepth, totalBytes),
  );
  const blockFrames = 8192;
  const blockBytes = blockFrames * source.channels * bytesPerSample;
  const pcmBlock = Buffer.allocUnsafe(blockBytes);

  await source.streamBlocks(async (samples, frames) => {
    if (signal?.aborted) return;
    const numSamples = frames * source.channels;
    const bytes = numSamples * bytesPerSample;
    encodePcm(samples, 0, numSamples, bitDepth, pcmBlock);
    await writeChunk(stream, bytes === blockBytes ? pcmBlock : pcmBlock.subarray(0, bytes));
  }, signal);
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
  const audioSeconds = options.audioStream
    ? options.audioStream.duration
    : options.audioBuffer ? options.audioBuffer.length / options.audioBuffer.sampleRate : 0;
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

    const streamPromise = options.audioStream
      ? streamWavFromSource(child.stdin, options.audioStream, plan.bitDepth, options.signal)
      : options.audioBuffer
        ? streamWav(child.stdin, options.audioBuffer, plan.bitDepth)
        : Promise.resolve();

    streamPromise
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
