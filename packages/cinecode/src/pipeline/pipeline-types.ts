import type { Composition, RenderFormat, QualitySetting } from "../core/types/index.js";
import type { VideoEncoding } from "../core/quality.js";
import type { ProgressHandler } from "./progress.js";
import type { RecoveryPolicy } from "./recovery.js";
import type { MidiPlayback } from "../midi/index.js";
import type { AudioMuxCodec } from "../audio/muxer.js";
import type { PcmBitDepth } from "../audio/encode.js";
import type { FontEntry } from "../core/types/index.js";
import type { GifDitherMode } from "../core/output-plan.js";

export interface RenderOptions {
  readonly composition: Composition;
  readonly outputPath: string;
  readonly cacheDir: string;
  readonly seed: number;
  readonly concurrency: number | "auto";
  readonly chunkSize: number;
  /** Fully-resolved encoding profile (preferred). */
  readonly encoding?: VideoEncoding;
  /** Legacy quality shim; ignored when `encoding` is supplied. */
  readonly quality?: QualitySetting | "preview";
  /** Container format; defaults to mp4. */
  readonly format?: RenderFormat;
  /** Preserve the alpha channel in alpha-capable containers. */
  readonly alpha?: boolean;
  /** Burn subtitle tracks into every encoded frame. */
  readonly burnSubtitles?: boolean;
  readonly overwrite: boolean;
  readonly fresh: boolean;
  readonly noCache: boolean;
  /** Skip frames already recorded in a durable render checkpoint. */
  readonly resume?: boolean;
  /** Frames between checkpoint flushes (default 100). */
  readonly checkpointInterval?: number;
  readonly fromFrame?: number;
  readonly toFrame?: number;
  readonly onProgress?: ProgressHandler;
  readonly silent?: boolean;
  /** Per-phase fault-isolation policy (retry/skip/abort + fallback frames). */
  readonly recovery?: RecoveryPolicy;
  /** Per-frame worker fault policy: placeholder, repeat-previous, or abort. */
  readonly frameErrorPolicy?: "placeholder" | "repeat-previous" | "abort";
  /** Render byte budget in MiB; defaults to a share of available memory. */
  readonly memoryBudgetMb?: number;
  /** Print the effective memory budget and frame transport statistics. */
  readonly verbose?: boolean;
  readonly previewMode?: boolean;
  readonly previewFps?: number;
  /** Run a rate-analysis pass before the final encode (requires bitrate). */
  readonly twoPass?: boolean;
  /** Emit fragmented MP4 so a partial render stays playable after interruption. */
  readonly streaming?: boolean;
  /** Working/output color space conversion applied to every encoded frame. */
  readonly colorManagement?: {
    readonly workingColorSpace?: "srgb" | "linear-srgb" | "rec709" | "acescg";
    readonly outputColorSpace?: "srgb" | "rec709" | "display-p3" | "rec2020";
    readonly enabled?: boolean;
  };
  /** Optional MIDI playback player synced once per rendered frame. */
  readonly midiPlayer?: MidiPlayback;
  readonly bitrateKbps?: number;
  /** Audio codec for the muxed stream; defaults to aac, or opus for webm. */
  readonly audioCodec?: AudioMuxCodec;
  /** Audio bitrate in kbps for lossy codecs; ignored (and rejected) for lossless ones. */
  readonly audioBitrateKbps?: number;
  /** WAV bit depth fed to the encoder: 16/24 integer or 32 float (default). */
  readonly pcmBitDepth?: PcmBitDepth;
  /** Keep an audio stream even when the mix is silent. */
  readonly forceAudio?: boolean;
  /** Fall back to a silent bed when mixing fails, reported as a degradation. */
  readonly allowSilentAudio?: boolean;
  /** Continue rendering despite fatal timeline validation issues (recorded as a degradation). */
  readonly allowInvalidTimeline?: boolean;
  /** Configured project fonts, registered in every render process before drawing. */
  readonly fonts?: readonly FontEntry[];
  readonly projectRoot?: string;
  readonly mediaDir?: string;
  /** Fail the render when a glyph falls back to another family. */
  readonly strictFonts?: boolean;
  /** Fail the render on any validation warning. */
  readonly strict?: boolean;
  /** GIF palette quality 1-8 (higher = more colours). */
  readonly gifQuality?: number;
  /** GIF dithering algorithm. */
  readonly gifDither?: GifDitherMode;
  /** Cap on GIF frames. */
  readonly gifMaxFrames?: number;
  /** Aborting this signal cancels the render exactly like SIGINT does. */
  readonly signal?: AbortSignal;
  /** Content of entry file for cache invalidation. */
  readonly entryContent?: string | Buffer;
  /** Write a poster image selected from the rendered composition. */
  readonly generateThumbnail?:
    | boolean
    | { readonly outputPath?: string; readonly formats?: readonly ("png" | "jpg" | "webp")[] };
  /** Artificial encoder frame write delay (ms) for testing streaming pipeline overlap. */
  readonly encoderDelayMs?: number;
  /** Custom binary overrides for ffmpeg/ffprobe. */
  readonly binaries?: {
    readonly ffmpegPath?: string;
    readonly ffprobePath?: string;
  };
}

export interface RenderResult {
  readonly outputPath: string;
  readonly duration: number;
  readonly fileSize: number;
  readonly timeTaken: number;
  readonly cacheReuse: number;
  readonly totalFrames?: number;
  /** Frames written; equals pages for document outputs. */
  readonly frames?: number;
  /** Pages written by a PDF output. */
  readonly pages?: number;
  readonly budgetStats?: {
    readonly limitBytes: number;
    readonly peakBytes: number;
    readonly waitCount: number;
    readonly waitDurationMs: number;
  };
  readonly audioStats?: {
    readonly integratedLufs?: number;
    readonly truePeakDb?: number;
    readonly clipped?: boolean;
  };
  readonly containerVerification?: {
    readonly verified: boolean;
    readonly codec?: string;
    readonly pixelFormat?: string;
    readonly duration?: number;
    readonly hasAudio?: boolean;
    readonly mismatches?: readonly string[];
  };
}

export interface RenderJob {
  readonly promise: Promise<RenderResult>;
  readonly cancel: () => Promise<void>;
  readonly on: (event: string, handler: ProgressHandler) => void;
  readonly off: (event: string, handler: ProgressHandler) => void;
}
