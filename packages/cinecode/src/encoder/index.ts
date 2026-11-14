import { spawn } from "node:child_process";
import ffmpegStatic from "@ffmpeg-installer/ffmpeg";
import { mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { RenderFormat, QualityPreset, VideoCodec } from "../core/types/config.js";
import type { EncoderBackend, VideoEncoding } from "../core/quality.js";
import { normalizeQuality, resolveVideoEncoding } from "../core/quality.js";

export interface EncoderOptions {
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly crf: number;
  readonly preset: string;
  readonly pixFmt: string;
  readonly codec?: VideoCodec;
  readonly backend?: EncoderBackend;
  readonly format?: RenderFormat;
  readonly alpha?: boolean;
  readonly outputPath: string;
  readonly tempDir: string;
  readonly overwrite: boolean;
  readonly pass?: 1 | 2;
  readonly passLogFile?: string;
  readonly bitrateKbps?: number;
  readonly av1Encoder?: "svt" | "aom";
  /** Write fragmented MP4 so sequential output stays playable when interrupted. */
  readonly fragmented?: boolean;
  /** HDR10 / HLG metadata passed to the encoder and container. */
  readonly hdr?: HdrMetadata;
  /** WebP/AVIF still-image quality (0-100 for WebP, 0-63 for AVIF). */
  readonly stillQuality?: number;
  readonly lossless?: boolean;
}

export interface HdrMetadata {
  /** SMPTE ST 2086 master-display string, e.g. `G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1)`. */
  readonly masterDisplay?: string;
  /** Maximum content light level in nits. */
  readonly maxCLL?: number;
  /** Maximum frame-average light level in nits. */
  readonly maxFALL?: number;
  readonly colorPrimaries?: "bt2020" | "bt709";
  /** PQ = SMPTE ST 2084, HLG = ARIB STD-B67. */
  readonly transfer?: "pq" | "hlg";
  readonly matrix?: "bt2020nc" | "bt709";
}

export interface EncoderResult {
  readonly success: boolean;
  readonly outputPath: string;
  readonly duration: number;
  readonly fileSize: number;
  readonly error?: string;
}

/**
 * SVT-AV1 preset mapping. Presets 0-13: lower = slower/better quality.
 * x264 "fast" maps to SVT 6 which is the recommended quality/speed tradeoff.
 * The old inverse-index mapping produced presets that were far too slow.
 */
const SVT_PRESET_MAP: Readonly<Record<string, number>> = {
  "ultrafast": 13,
  "superfast": 12,
  "veryfast": 10,
  "faster": 8,
  "fast": 6,
  "medium": 4,
  "slow": 3,
  "slower": 2,
  "veryslow": 1,
};

function svtPreset(preset: string): number {
  return SVT_PRESET_MAP[preset] ?? 6;
}

/**
 * Builds the ffmpeg output args for a codec + backend combination. The
 * framework never forces a low quality ceiling: CRF/preset/pix_fmt all come
 * from the resolved user config.
 */
export type ResolvedContainer = "mp4" | "webm" | "prores" | "mkv" | "avi" | "apng";

export function resolveContainerFormat(format: RenderFormat | undefined, codec: VideoCodec): ResolvedContainer {
  if (format === "webm" || format === "webm-alpha") return "webm";
  if (format === "prores" || format === "prores-alpha") return "prores";
  if (format === "mp4") return "mp4";
  if (format === "mkv") return "mkv";
  if (format === "avi") return "avi";
  if (format === "apng") return "apng";
  if (codec === "ffv1" || codec === "utvideo") return "mkv";
  if (codec === "vp9" || codec === "av1") return "webm";
  if (codec === "prores") return "prores";
  return "mp4";
}

export function validateCodecContainer(
  format: RenderFormat | undefined,
  codec: VideoCodec,
): string | null {
  const container = resolveContainerFormat(format, codec);
  if (codec === "ffv1" && container !== "mkv") {
    const label = container === "prores" ? "MOV" : container.toUpperCase();
    return `FFV1 codec is not supported in ${label} containers. Use MKV instead.`;
  }
  if (codec === "utvideo" && container !== "avi" && container !== "mkv") {
    return `Ut Video codec is not supported in ${container.toUpperCase()} containers. Use AVI or MKV instead.`;
  }
  if (codec === "prores" && container !== "prores") {
    return `ProRes codec requires a MOV container, got ${container.toUpperCase()}.`;
  }
  if (codec === "vp9" && container !== "webm") {
    return `VP9 codec is not supported in ${container.toUpperCase()} containers. Use WebM instead.`;
  }
  if (format === "apng" && codec !== "h264") {
    return "APNG is an image sequence container. Omit the video codec or use PNG frames.";
  }
  return null;
}

export function supportsAlpha(format: RenderFormat | undefined, codec: VideoCodec): boolean {
  if (format === "webm-alpha" || format === "prores-alpha") return true;
  return format === "png" || codec === "prores" && format === "prores";
}

export function buildVideoEncoderArgs(options: EncoderOptions): string[] {
  const { crf, preset, pixFmt } = options;
  const codec = options.codec ?? "h264";
  const hdr = options.hdr;
  const backend = options.backend ?? "software";
  const requested = options.format;
  const alpha = options.alpha === true || requested === "webm-alpha" || requested === "prores-alpha";
  const format = resolveContainerFormat(requested, codec);

  const video: string[] = [];
  const pass = options.pass;
  const passArgs: string[] = pass !== undefined
    ? ["-pass", String(pass), "-passlogfile", options.passLogFile ?? "cinecode-pass"]
    : [];
  const bitrateArgs: string[] = options.bitrateKbps !== undefined
    ? ["-b:v", `${Math.round(options.bitrateKbps)}k`]
    : [];

  if (alpha && (format === "webm" || codec === "vp9")) {
    video.push("-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-row-mt", "1", "-auto-alt-ref", "0");
    if (bitrateArgs.length === 0) video.push("-crf", String(crf), "-b:v", "0");
  } else if (alpha && format === "prores") {
    video.push("-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", "-vendor", "apl0");
  } else if (codec === "prores") {
    video.push("-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", pixFmt);
  } else if (backend === "nvenc") {
    const encoder = codec === "h265" ? "hevc_nvenc" : codec === "av1" ? "av1_nvenc" : "h264_nvenc";
    video.push("-c:v", encoder, "-preset", preset === "veryslow" ? "p7" : "p5", "-rc", "vbr", "-cq", String(crf), "-b:v", "0", "-pix_fmt", pixFmt);
  } else if (backend === "videotoolbox") {
    const encoder = codec === "h265" ? "hevc_videotoolbox" : "h264_videotoolbox";
    video.push("-c:v", encoder, "-q:v", String(Math.max(1, Math.min(100, 100 - crf))), "-pix_fmt", pixFmt);
  } else if (backend === "qsv") {
    const encoder = codec === "h265" ? "hevc_qsv" : "h264_qsv";
    video.push("-c:v", encoder, "-global_quality", String(crf), "-preset", preset, "-pix_fmt", pixFmt);
  } else if (codec === "ffv1") {
    video.push("-c:v", "ffv1", "-level", "3", "-slicecrc", "1", "-pix_fmt", pixFmt);
  } else if (codec === "utvideo") {
    video.push("-c:v", "utvideo", "-pix_fmt", pixFmt);
  } else if (codec === "h265") {
    video.push("-c:v", "libx265", "-preset", preset, "-crf", String(crf), "-pix_fmt", pixFmt);
    if (hdr) video.push("-x265-params", buildX265HdrParams(hdr));
  } else if (codec === "av1") {
    if (options.av1Encoder === "aom" || format === "mp4") {
      video.push("-c:v", "libaom-av1", "-crf", String(crf), "-b:v", "0", "-cpu-used", String(Math.max(0, Math.min(8, 8 - svtPreset(preset)))), "-pix_fmt", pixFmt);
    } else {
      video.push("-c:v", "libsvtav1", "-preset", String(svtPreset(preset)), "-crf", String(crf), "-pix_fmt", pixFmt);
    }
  } else if (codec === "vp9") {
    video.push("-c:v", "libvpx-vp9", "-crf", String(crf), "-b:v", "0", "-row-mt", "1", "-pix_fmt", pixFmt);
  } else {
    video.push("-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", pixFmt);
  }

  const container: string[] = [];
  if (format === "mp4" || format === "prores") {
    container.push(
      "-movflags",
      options.fragmented === true ? "empty_moov+default_base_moof+frag_keyframe" : "+faststart",
    );
  }
  if (format === "mkv") container.push("-f", "matroska");
  if (format === "avi") container.push("-f", "avi");
  if (format === "apng") container.push("-f", "apng", "-plays", "0");
  if (hdr) container.push(...buildHdrColorArgs(hdr));

  if (pass === 1) {
    return [...video, ...passArgs, ...bitrateArgs, "-an", "-f", "null", "-"];
  }

  return [...video, ...passArgs, ...bitrateArgs, ...container, options.outputPath];
}

export function buildX265HdrParams(hdr: HdrMetadata): string {
  const params: string[] = [];
  if (hdr.masterDisplay) params.push(`master-display=${hdr.masterDisplay}`);
  if (hdr.maxCLL !== undefined) params.push(`max-cll=${Math.round(hdr.maxCLL)},${Math.round(hdr.maxFALL ?? hdr.maxCLL)}`);
  else if (hdr.maxFALL !== undefined) params.push(`max-cll=0,${Math.round(hdr.maxFALL)}`);
  if (params.length > 0) params.push("hdr10=1");
  return params.join(":");
}

export function buildHdrColorArgs(hdr: HdrMetadata): string[] {
  const primaries = hdr.colorPrimaries ?? "bt2020";
  const transfer = hdr.transfer === "hlg" ? "arib-std-b67" : "smpte2084";
  const matrix = hdr.matrix ?? (primaries === "bt2020" ? "bt2020nc" : "bt709");
  return [
    "-color_primaries", primaries,
    "-color_trc", transfer,
    "-colorspace", matrix,
  ];
}

export class VideoEncoder {
  private readonly options: EncoderOptions;
  private frameCount = 0;
  private process: ReturnType<typeof spawn> | null = null;
  private stdin: NodeJS.WritableStream | null = null;
  private stderr = "";
  private lastStdinError = "";
  private resolved = false;
  private resolvePromise!: (result: EncoderResult) => void;
  private rejectPromise!: (error: Error) => void;
  private readonly promise: Promise<EncoderResult>;

  constructor(options: EncoderOptions) {
    this.options = options;
    this.promise = new Promise((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  async start(): Promise<void> {
    await mkdir(this.options.tempDir, { recursive: true });

    const args = [
      "-v", "error", "-y",
      "-f", "rawvideo",
      "-pix_fmt", "bgr0",
      "-s", `${this.options.width}x${this.options.height}`,
      "-r", String(this.options.fps),
      "-i", "-",
      ...buildVideoEncoderArgs(this.options),
    ];

    this.process = spawn(ffmpegStatic.path, args, {
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"],
    });

    const stdin = this.process.stdin;
    if (!stdin) {
      throw new Error("Failed to get stdin from ffmpeg process");
    }
    this.stdin = stdin;
    // ffmpeg can exit early (bad args, encoder error); without this handler the
    // resulting EPIPE/EOF on stdin is emitted as an unhandled 'error' event and
    // crashes the process instead of surfacing as a failed EncoderResult.
    stdin.on("error", (err) => {
      this.lastStdinError = err.message;
    });
    const stderr = this.process.stderr;
    if (stderr) {
      stderr.on("data", (chunk) => { this.stderr += chunk.toString(); });
    }

    this.process.on("close", (code) => {
      if (this.resolved) return;
      this.resolved = true;
      if (code !== 0) {
        this.resolvePromise({
          success: false,
          outputPath: this.options.outputPath,
          duration: 0,
          fileSize: 0,
          error: `ffmpeg encoding failed: ${this.stderr}`,
        });
      } else {
        this.resolvePromise({
          success: true,
          outputPath: this.options.outputPath,
          duration: this.frameCount / this.options.fps,
          fileSize: 0,
        });
      }
    });

    this.process.on("error", (err) => {
      if (this.resolved) return;
      this.resolved = true;
      this.resolvePromise({
        success: false,
        outputPath: this.options.outputPath,
        duration: 0,
        fileSize: 0,
        error: `Failed to spawn ffmpeg: ${err.message}`,
      });
    });
  }

  async addFrame(buffer: Buffer): Promise<void> {
    if (!this.stdin) {
      throw new Error("Encoder not started or stdin closed");
    }
    return new Promise((resolve, reject) => {
      this.stdin!.write(buffer, (err) => {
        if (err) {
          reject(new Error(`ffmpeg stdin write failed: ${err.message}${this.stderr ? ` | ffmpeg: ${this.stderr.trim()}` : ""}${this.lastStdinError ? ` | stdin: ${this.lastStdinError}` : ""}`));
        } else {
          this.frameCount++;
          resolve();
        }
      });
    });
  }

  async finish(): Promise<EncoderResult> {
    if (this.stdin) {
      this.stdin.end();
    }
    return this.promise;
  }

  async cancel(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill("SIGINT");
      await new Promise<void>((resolve) => {
        this.process!.on("close", () => resolve());
        setTimeout(resolve, 1000);
      });
    }
    if (!this.resolved) {
      this.resolved = true;
      await rm(this.options.outputPath, { force: true });
      this.rejectPromise(new Error("Encoding cancelled"));
    }
  }

  getFrameCount(): number {
    return this.frameCount;
  }
}

export interface CreateEncoderInput {
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly outputPath: string;
  readonly tempDir: string;
  readonly overwrite?: boolean;
  readonly encoding: VideoEncoding;
  readonly format?: RenderFormat;
  readonly alpha?: boolean;
  readonly bitrateKbps?: number;
  readonly fragmented?: boolean;
  readonly hdr?: HdrMetadata;
}

/** Creates an encoder from an already-resolved `VideoEncoding` profile. */
export function createVideoEncoderWithEncoding(input: CreateEncoderInput): VideoEncoder {
  return new VideoEncoder({
    fps: input.fps,
    width: input.width,
    height: input.height,
    crf: input.encoding.crf,
    preset: input.encoding.preset,
    pixFmt: input.encoding.pixFmt,
    codec: input.encoding.codec,
    backend: input.encoding.backend,
    format: input.format,
    alpha: input.alpha,
    bitrateKbps: input.bitrateKbps,
    outputPath: input.outputPath,
    tempDir: input.tempDir,
    fragmented: input.fragmented,
    hdr: input.hdr,
    overwrite: input.overwrite ?? false,
  });
}

/**
 * Backwards-compatible encoder factory. Prefer
 * `createVideoEncoderWithEncoding` so quality comes from the user's config.
 */
export function createVideoEncoder(
  fps: number,
  width: number,
  height: number,
  outputPath: string,
  tempDir: string,
  quality: QualityPreset | "preview" | "medium" | "low" = "final",
  overwrite = false
): Promise<VideoEncoder> {
  const encoding = resolveVideoEncoding({ quality: normalizeQuality(quality) });
  return Promise.resolve(new VideoEncoder({
    fps,
    width,
    height,
    crf: encoding.crf,
    preset: encoding.preset,
    pixFmt: encoding.pixFmt,
    codec: encoding.codec,
    backend: encoding.backend,
    outputPath,
    tempDir,
    overwrite,
  }));
}

export {
  StreamingEncoder,
  FrameRingBuffer,
  createStreamingEncoder,
  createFrameStream,
  streamingFrameBuffer,
  type StreamingEncoderOptions,
  type FrameRingBufferOptions,
  type FrameRingBufferStats,
} from "./streaming.js";

export function computeFrameHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

export {
  convertMediaFormat,
  stitchVideos,
  splitVideo,
  generateThumbnail,
  writeFrameSequence,
  encodeAnimatedGif,
  writeSpriteSheet,
  type FfmpegResult,
  type ConvertOptions,
  type StitchOptions,
  type SplitSegment,
  type SplitOptions,
  type ThumbnailOptions,
  type FrameSequenceOptions,
  type AnimatedGifOptions,
  type SpriteSheetOptions,
  type SpriteSheetResult,
} from "./outputs.js";
export {
  AtomicWriteError,
  cleanupActiveTempFiles,
  cleanupStaleTempFiles,
  isSameVolume,
  listActiveTempFiles,
  promoteTempFile,
  registerTempFile,
  temporaryPathFor,
  unregisterTempFile,
  withAtomicOutput,
  writeFileAtomic,
  type AtomicWriteOptions,
  type AtomicWriteResult,
} from "./output.js";
export {
  exportManifestJson,
  exportClipReport,
  exportTimecodeLog,
  writeManifestJson,
  writeClipReport,
  writeTimecodeLog,
  type ManifestJsonExport,
  type ClipReport,
  type ClipReportEntry,
  type TimecodeLogEntry,
} from "./data-export.js";
export {
  bundleStoryHtml,
  type StoryBundleOptions,
} from "./story-bundler.js";

