import { extname } from "node:path";
import type { AudioBuffer, AudioStreamSource } from "./types.js";
import type { PcmBitDepth } from "./encode.js";
import { createError, ErrorCode } from "../errors/codes.js";
import type { AudioMuxCodec, MuxContainer } from "../core/output-plan.js";

export type { AudioMuxCodec, MuxContainer } from "../core/output-plan.js";
export type AudioDurationAdjustment = "none" | "padded" | "trimmed";

export interface AudioCodecSpec {
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

export const DEFAULT_BITRATE_KBPS: Readonly<Record<AudioMuxCodec, number>> = {
  aac: 192,
  opus: 160,
  ac3: 384,
  eac3: 384,
  flac: 0,
  pcm_s24le: 0,
};

export const CONTAINER_EXTENSIONS: Readonly<Record<string, MuxContainer>> = {
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
  readonly audioBuffer?: AudioBuffer;
  readonly audioStream?: AudioStreamSource;
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

export function resolveContainer(options: MuxAudioFormat): MuxContainer {
  if (options.containerFormat) return options.containerFormat;
  const extension = options.outputPath ? extname(options.outputPath).toLowerCase() : "";
  return CONTAINER_EXTENSIONS[extension] ?? "mp4";
}

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
