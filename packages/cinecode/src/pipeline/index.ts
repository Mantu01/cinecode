import { copyFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Composition, RenderFormat, QualitySetting } from "../core/types/index.js";
import type { VideoEncoding } from "../core/quality.js";
import { encodingCacheKey, normalizeQuality, resolveVideoEncoding } from "../core/quality.js";
import type { AudioTrackState } from "../audio/types.js";
import { assertSidechainSources, prepareAudioTracks } from "../audio/prepare.js";
import {
  createConversion,
  createVfrConversion,
  frameToSeconds,
  secondsToFrame,
} from "../core/time/index.js";
import { computeClipSpan, validateComposition, compositionValidationError } from "../core/validation/index.js";
import { createColorTransform, resolveColorManagementConfig } from "../renderer/color/profiles.js";
import { createRenderCache, type RenderCache } from "./cache.js";
import { createCheckpointManager } from "./recovery.js";
import {
  createWorkerManager,
  createChunks,
  resolveChunkSize,
  resolveConcurrency,
  type FrameChunk,
  type WorkerResult,
  type WorkerManager,
  type WorkerStartupMeasurement,
  type WorkerThroughputMeasurement,
} from "./workers.js";
import {
  getMediaCacheForRenderer,
  clearRendererCaches,
  createRenderSession,
  getRendererCacheStats,
} from "../renderer/engine.js";
import { tuneConcurrency, analyzeWorkload } from "./concurrency-tuner.js";
import { createMediaPrefetcher } from "../media/prefetch.js";
import {
  createSharedDecodeService,
  type SharedDecodeService,
  type DecodedFrame,
  type DecodeServiceStats,
} from "../media/decode-service.js";
import { createProgressReporter, type ProgressReporter, type ProgressHandler } from "./progress.js";
import { cleanupActiveTempFiles, withAtomicOutput } from "../encoder/output.js";
import { createCancellationController } from "./signals.js";
import { createVideoEncoderWithEncoding, type VideoEncoder } from "../encoder/index.js";
import { RawFrameSink, encodeTwoPass, type FrameSink } from "../encoder/two-pass.js";
import { embedChaptersIntoVideo } from "../encoder/chapters/index.js";
import { createMediaCache } from "../media/cache.js";
import { mixAudioTracks, type MixerOptions } from "../audio/mixer.js";
import type { MidiPlayback } from "../midi/index.js";
import { ffmpegLayoutForChannelCount } from "../audio/channels.js";
import {
  muxAudioVideo,
  planMuxAudio,
  type AudioMuxCodec,
  type MuxAudioPlan,
  type MuxerOptions,
} from "../audio/muxer.js";
import type { PcmBitDepth } from "../audio/encode.js";
import { probeMediaFile } from "../media/inspector.js";
import { computeCompositionHash, computeCanonicalCacheIdentity } from "./cache.js";
import { outputPlanFor, resolveAudioPlan, resolveOutputPlan } from "../core/output-plan.js";
import { createError, ErrorCode } from "../errors/codes.js";
import type { FontEntry } from "../core/types/index.js";
import { registerProjectFonts } from "../renderer/text/fonts.js";
import { recordDegradation, recordWarning } from "../errors/degradations.js";
import { preprocessVideo } from "../media/preprocess.js";
import { getPluginRegistry } from "../plugin/registry.js";
import {
  renderFrameWithRecovery,
  createFallbackFrameBuffer,
  withRecovery,
  type RecoveryPolicy,
  resolveStrategy,
  DEFAULT_RECOVERY,
} from "./recovery.js";
import { getFrameTransportStats } from "./frame-format.js";
import {
  ByteBudget,
  estimateChunkBytes,
  formatBytes,
  resolveTransportBudget,
} from "./memory.js";

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
  /** Keep worker threads warm across renders for reduced startup latency. */
  readonly warmPool?: boolean;
  /** GIF palette quality 1-8 (higher = more colours). */
  readonly gifQuality?: number;
  /** GIF dithering algorithm. */
  readonly gifDither?: "floyd-steinberg" | "sierra-2" | "atkinson" | "none";
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
}

export interface RenderResult {
  readonly outputPath: string;
  readonly duration: number;
  readonly fileSize: number;
  readonly timeTaken: number;
  readonly cacheReuse: number;
  /** Frames written; equals pages for document outputs. */
  readonly frames?: number;
  /** Pages written by a PDF output. */
  readonly pages?: number;
}

export interface RenderJob {
  readonly promise: Promise<RenderResult>;
  readonly cancel: () => Promise<void>;
  readonly on: (event: string, handler: ProgressHandler) => void;
  readonly off: (event: string, handler: ProgressHandler) => void;
}

const DEFAULT_CHUNK_SIZE = 32;

/**
 * Total frame count for a composition without materializing a full render
 * graph. `buildRenderGraph` builds a per-frame node list (O(frames × clips)),
 * which is prohibitively expensive for compositions with tens of thousands of
 * clips; the pipeline only needs the frame count, so compute it directly.
 */
function compositionConversion(composition: Composition): ReturnType<typeof createConversion> {
  return composition.tempo && composition.tempo.length > 0
    ? createVfrConversion(composition.tempo, composition.fps)
    : createConversion(composition.fps);
}

function computeTotalFrames(composition: Composition): number {
  const conversion = compositionConversion(composition);
  let clipMax = 0;
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind === "audio") continue;
    for (const clip of track.clips) {
      const span = computeClipSpan(clip as never, conversion);
      if (span.endFrames > clipMax) clipMax = span.endFrames;
    }
  }
  if (composition.duration !== undefined) {
    const dur =
      typeof composition.duration === "number"
        ? composition.duration
        : parseFloat(composition.duration as string);
    const durFrames = Math.ceil(secondsToFrame(dur, conversion));
    return composition.boundaryBehavior === "extend" ? Math.max(durFrames, clipMax) : durFrames;
  }
  return clipMax;
}

/**
 * Byte-budgeted queue between rendered frames and the encoder. Capacity is a
 * byte allowance, so a 4K render buffers a handful of frames while a 720p one
 * buffers many. Frames enter and leave in order; when the allowance is spent
 * the producer waits instead of dropping or reordering frames.
 */
export class FrameQueue {
  private readonly encoder: FrameSink;
  private readonly budget: ByteBudget;
  private readonly frameBytes: number;
  private pendingWrites = 0;
  private pendingBytes = 0;
  private drained = false;
  private resolveDrain!: () => void;
  private drainPromise = new Promise<void>((r) => {
    this.resolveDrain = r;
  });
  private readonly writeErrors: Error[] = [];

  constructor(encoder: FrameSink, budget: ByteBudget, frameBytes: number) {
    this.encoder = encoder;
    this.budget = budget;
    this.frameBytes = frameBytes;
  }

  get empty(): boolean {
    return this.pendingWrites === 0;
  }
  get size(): number {
    return this.pendingWrites;
  }
  get queuedBytes(): number {
    return this.pendingBytes;
  }

  /** Resolves once the frame has been written to the encoder. */
  async enqueue(frame: { index: number; buffer: Buffer }): Promise<void> {
    if (frame.buffer.byteLength !== this.frameBytes) {
      throw new RangeError(
        `[CC2205] frame ${frame.index} is ${frame.buffer.byteLength} bytes, expected ${this.frameBytes}`,
      );
    }
    const bytes = frame.buffer.byteLength;
    await this.budget.reserve(bytes);
    this.pendingWrites += 1;
    this.pendingBytes += bytes;
    try {
      await this.encoder.addFrame(frame.buffer);
    } catch (err) {
      this.pendingWrites -= 1;
      this.pendingBytes -= bytes;
      this.budget.release(bytes);
      this.writeErrors.push(err instanceof Error ? err : new Error(String(err)));
      if (this.pendingWrites === 0 && this.drained) this.resolveDrain();
      throw err;
    }
    this.pendingWrites -= 1;
    this.pendingBytes -= bytes;
    this.budget.release(bytes);
    if (this.pendingWrites === 0 && this.drained) this.resolveDrain();
  }

  /**
   * Signal end-of-stream. Returns a promise that resolves once all queued
   * frames have been written and the encoder's stdin has been closed.
   */
  async close(): Promise<void> {
    this.drained = true;
    if (this.pendingWrites > 0) {
      await this.drainPromise;
    }
    const result = await this.encoder.finish();
    for (const err of this.writeErrors) {
      throw err;
    }
    if (!result.success) {
      throw createError(ErrorCode.CC4002, { details: result.error ?? "Encoding failed" });
    }
  }
}

export async function renderVideo(options: RenderOptions): Promise<RenderResult> {
  const startTime = Date.now();
  const {
    composition,
    outputPath,
    cacheDir,
    seed,
    concurrency,
    chunkSize = DEFAULT_CHUNK_SIZE,
    quality,
    encoding: encodingOption,
    format: requestedFormat,
    alpha: alphaOption,
    overwrite,
    fresh,
    fromFrame = 0,
    toFrame,
    onProgress,
    silent = false,
    recovery,
    memoryBudgetMb,
  } = options;
  let noCache = options.noCache;

  const fontResult = registerProjectFonts(options.fonts, {
    projectRoot: options.projectRoot ?? process.cwd(),
    mediaDir: options.mediaDir ?? "media",
  });
  if (fontResult.errors.length > 0) {
    const first = fontResult.errors[0]!;
    const error = createError(
      ErrorCode.CC3006,
      { font: first.family, text: "font file" },
      { location: { file: first.path }, fixHint: "Fix the font entry path or use a supported .ttf/.otf/.ttc file inside the media root." },
    );
    error.message = first.message;
    throw error;
  }
  for (const warning of fontResult.warnings) {
    recordDegradation({
      code: ErrorCode.CC3006,
      what: "duplicate font family ignored",
      reason: warning.message,
      input: warning.path ?? warning.family,
      instead: "the first configured face for that family is used",
    });
  }

  const timelineValidation = validateComposition(composition);
  if (!timelineValidation.valid) {
    if (options.allowInvalidTimeline !== true) throw compositionValidationError(timelineValidation);
    recordDegradation({
      code: ErrorCode.CC1013,
      what: "render continued with fatal timeline validation issues",
      reason: timelineValidation.errors.map((issue) => `[${issue.code}] ${issue.message}`).join("; "),
      input: composition.name,
      instead: "frames were rendered from a composition that validate reports as invalid",
    });
  }

  const plan = outputPlanFor(requestedFormat);
  const baseEncoding: VideoEncoding =
    encodingOption ??
    resolveVideoEncoding({ quality: quality ? normalizeQuality(quality) : undefined });
  const encoding: VideoEncoding =
    encodingOption === undefined && plan.codecs.length > 0 && !plan.codecs.includes(baseEncoding.codec)
      ? { ...baseEncoding, codec: plan.defaultCodec ?? baseEncoding.codec }
      : baseEncoding;
  const output = resolveOutputPlan({
    format: requestedFormat,
    alpha: alphaOption === true,
    codec: plan.codecs.length > 0 ? encoding.codec : undefined,
  });
  const format: RenderFormat = output.format;
  const alpha = output.alpha;
  const requestedAudioChannels = composition.audio?.channels ?? 2;
  const hasAudioTracks = composition.rootTimeline.tracks.some((track) => track.kind === "audio");
  const audioPlan = resolveAudioPlan(format, options.audioCodec);
  const muxPlan: MuxAudioPlan | null =
    audioPlan !== null && (hasAudioTracks || options.forceAudio === true)
      ? planMuxAudio({
          audioCodec: options.audioCodec ?? audioPlan.defaultCodec,
          audioBitrateKbps: options.audioBitrateKbps,
          pcmBitDepth: options.pcmBitDepth,
          audioChannels: requestedAudioChannels,
          channelLayout:
            requestedAudioChannels === 2
              ? audioPlan.layout
              : ffmpegLayoutForChannelCount(requestedAudioChannels),
          containerFormat: audioPlan.muxer,
        })
      : null;
  if (audioPlan === null && hasAudioTracks) {
    recordDegradation({
      code: ErrorCode.CC4005,
      what: "audio tracks ignored by this output format",
      reason: format + " output has no audio stream",
      input: composition.name,
      instead: "the render continues without audio",
    });
  }

  const renderCache = createRenderCache(cacheDir);
  const mediaCache = createMediaCache(join(cacheDir, "media"));
  const registry = getPluginRegistry();
  const warningHook = (message: string, stage: string): void => {
    void registry.runHook("onWarning", { message, stage });
  };
  let reporter = createProgressReporter({
    totalFrames: 0,
    onProgress,
    silent,
    onWarning: warningHook,
  });

  await Promise.all([renderCache.initialize(), mediaCache.initialize()]);

  // Video clips read frames through the renderer's module-level media cache;
  // set it before any frame is drawn (workers get their own instance).
  const { setMediaCacheForRenderer } = await import("../renderer/engine.js");
  setMediaCacheForRenderer(mediaCache);

  // The frame transport format is part of the hash so caches written by a
  // previous format (e.g. the color-corrupting JPEG transport) can never be
  // replayed after an upgrade.
  const tempoKey = composition.tempo
    ? composition.tempo.map((region) => `${region.start}-${region.end}-${region.fps}`).join(",")
    : "constant";
  const colorManagement = resolveColorManagementConfig(options.colorManagement);
  const colorTransform = colorManagement.enabled
    ? createColorTransform(colorManagement.workingSpaceName, colorManagement.outputColorSpace)
    : null;
  const canonicalCache = computeCanonicalCacheIdentity({
    composition,
    seed,
    encoding,
    frameWindow: { from: fromFrame, to: toFrame },
    tempo: composition.tempo,
    colorSpace: colorManagement.workingColorSpace,
    pixelRatio: 1,
    alpha: options.alpha,
    registry: registry.getAll().map((p) => p.plugin.manifest.name),
    fonts: options.fonts,
    frameworkVersion: "1.0.0",
    entryContent: options.entryContent,
  });
  if (canonicalCache.bypassCache) {
    noCache = true;
  }
  const compositionHash = canonicalCache.identityHash;
  const renderConversion = compositionConversion(composition);
  const graphTotalFrames = computeTotalFrames(composition);

  const totalFrames = Math.max(
    0,
    toFrame !== undefined
      ? Math.min(toFrame - fromFrame, graphTotalFrames - fromFrame)
      : graphTotalFrames - fromFrame,
  );
  reporter = createProgressReporter({
    totalFrames,
    onProgress,
    silent,
    onWarning: warningHook,
  });
  reporter.reportStart();
  const effectiveFromFrame = Math.max(0, fromFrame);
  const effectiveToFrame =
    toFrame !== undefined ? Math.min(toFrame, graphTotalFrames) : graphTotalFrames;

  const checkpointManager = createCheckpointManager({
    cacheDir,
    compositionId: composition.name,
    compositionHash,
    totalFrames,
    from: fromFrame,
    to: toFrame,
    checkpointInterval: options.checkpointInterval,
  });
  await checkpointManager.initialize();
  const resumedFrames = new Set<number>();
  if (options.resume === true && !fresh) {
    const checkpoint = await checkpointManager.findLatestCheckpoint();
    if (checkpoint) {
      for (const frameIndex of checkpointManager.getCompletedFrames())
        resumedFrames.add(frameIndex);
      if (!silent) {
        reporter.reportWarning(
          `[CC4002] resuming session ${checkpoint.renderSessionId}: ${resumedFrames.size}/${totalFrames} frame(s) already rendered`,
        );
      }
    }
  }

  reporter.setStage("preparing");

  const preprocessedVideos = new Map<string, string>();
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind !== "visual") continue;
    for (const clip of track.clips) {
      if (clip.type !== "video" || !(clip as any).preprocess) continue;
      const src = (clip as any).src;
      if (preprocessedVideos.has(src)) continue;
      const processedPath = await preprocessVideo(src, (clip as any).preprocess, cacheDir);
      preprocessedVideos.set(src, processedPath);
    }
  }

  clearRendererCaches();
  const renderSession = createRenderSession();
  let processedComposition = composition;
  if (preprocessedVideos.size > 0) {
    processedComposition = {
      ...composition,
      rootTimeline: {
        ...composition.rootTimeline,
        tracks: composition.rootTimeline.tracks.map((track) => {
          if (track.kind !== "visual") return track;
          return {
            ...track,
            clips: track.clips.map((clip) => {
              if (clip.type !== "video" || !(clip as any).preprocess) return clip;
              const processedSrc = preprocessedVideos.get((clip as any).src);
              if (!processedSrc) return clip;
              const { preprocess, ...rest } = clip as any;
              return { ...rest, src: processedSrc };
            }),
          };
        }),
      },
    };
  }

  if (options.burnSubtitles === false) {
    processedComposition = { ...processedComposition, burnSubtitles: false };
  }
  const { preloadSubtitlesForRender } = await import("../encoder/subtitle-burn.js");
  await preloadSubtitlesForRender(processedComposition);

  const canResume =
    !fresh &&
    !noCache &&
    resumedFrames.size > 0;

  if (canResume) {
    reporter.setStage("rendering");
  }

  const transportBudget = resolveTransportBudget({
    width: composition.width,
    height: composition.height,
    concurrency: resolveConcurrency(concurrency),
    chunkSize,
    maxBytes: memoryBudgetMb === undefined ? undefined : memoryBudgetMb * 1024 * 1024,
  });
  const frameBudget = new ByteBudget(transportBudget.totalBytes);
  const framesPerBudget = Math.max(
    1,
    Math.floor(transportBudget.chunkBytes / estimateChunkBytes(1, composition.width, composition.height)),
  );
  const resolvedChunkSize = Math.min(resolveChunkSize(composition, chunkSize), framesPerBudget);
  const baseChunks = createChunks(totalFrames, resolvedChunkSize);
  const chunks: FrameChunk[] = baseChunks.map((chunk) => ({
    ...chunk,
    frames: chunk.frames.map((f) => f + effectiveFromFrame),
  }));

  let completedFrames = 0;
  let cacheReuseFrames = 0;
  let videoEncoder: VideoEncoder | null = null;
  let cancelled = false;

  const tempExtension = ".tmp" + (plan.extension || "." + format);
  const tempVideoPath = outputPath + tempExtension;
  const twoPass = options.twoPass === true;
  const rawFramePath = `${outputPath}.tmp.rgba`;

  await registry.runHook("onResolutionChange", {
    width: processedComposition.width,
    height: processedComposition.height,
    fps: processedComposition.fps,
  });
  await registry.runHook("beforeRender", { composition: processedComposition, totalFrames });

  let lastProgressHookFrame = -1;
  const fireProgressHook = async (frame: number): Promise<void> => {
    if (frame - lastProgressHookFrame < 30 && frame < totalFrames) return;
    lastProgressHookFrame = frame;
    await registry.runHook("onProgress", {
      currentFrame: frame,
      totalFrames,
      elapsedMs: Date.now() - startTime,
      etaMs: undefined,
    });
  };

  // Non-streamed outputs render frames on demand into a bounded writer, so a
  // GIF, APNG, PDF or frame sequence never buffers the whole render.
  if (plan.strategy !== "stream") {
    const onAbortSignal = (): void => {
      cancelled = true;
    };
    options.signal?.addEventListener("abort", onAbortSignal, { once: true });
    const { renderFrame } = await import("../renderer/engine.js");
    const { writeImageOutput } = await import("./image-output.js");
    reporter = createProgressReporter({ totalFrames, onProgress, silent, onWarning: warningHook });
    reporter.setStage("rendering");

    const renderFrames = async function* (): AsyncGenerator<Buffer> {
      for (let frame = effectiveFromFrame; frame < effectiveToFrame; frame += 1) {
        if (cancelled) throw createError(ErrorCode.CC4003);
        await registry.runHook("beforeFrame", {
          composition: processedComposition,
          frame,
          frameNumber: frame,
          totalFrames,
          timestamp: frameToSeconds(frame, renderConversion),
        });
        const outcome = await renderFrameWithRecovery(
          () => renderFrame(processedComposition, frame, seed, { session: renderSession }),
          processedComposition,
          recovery,
          frame,
        );
        await registry.runHook("afterFrame", {
          composition: processedComposition,
          frame,
          frameNumber: frame,
          totalFrames,
          timestamp: frameToSeconds(frame, renderConversion),
        });
        if (!outcome.buffer) {
          throw createError(ErrorCode.CC4001, { frame, source: composition.name }, { cause: outcome.error });
        }
        if (outcome.error) {
          reporter.reportDegradation(
            `[CC4001] frame ${frame} failed: ${outcome.error.message}${outcome.usedFallback ? " — placeholder substituted" : " — recovered"}`,
            {
              code: ErrorCode.CC4001,
              what: `frame ${frame} failed to render`,
              input: composition.name,
              instead: outcome.usedFallback ? "a placeholder frame was substituted" : "the frame was recovered on retry",
            },
          );
        }
        completedFrames += 1;
        options.midiPlayer?.syncFrame(frameToSeconds(frame, renderConversion));
        reporter.reportFrame(completedFrames);
        await fireProgressHook(completedFrames);
        yield outcome.buffer;
      }
    };

    const vectorPdf =
      plan.strategy === "document" && (await import("../pdf/vector.js")).isVectorOnly(processedComposition);
    let summary: { fileSize: number; frames: number; pages: number };
    if (vectorPdf) {
      const { PdfDocumentBuilder } = await import("../pdf/index.js");
      const { appendVectorPage } = await import("../pdf/vector.js");
      const builder = await PdfDocumentBuilder.create({
        width: composition.width,
        height: composition.height,
        title: composition.name,
      });
      for (let frame = effectiveFromFrame; frame < effectiveToFrame; frame += 1) {
        if (cancelled) throw createError(ErrorCode.CC4003);
        await appendVectorPage(builder.document, processedComposition, frame, {
          width: composition.width,
          height: composition.height,
        });
        completedFrames += 1;
        reporter.reportFrame(completedFrames);
      }
      const built = await builder.finish();
      await withAtomicOutput(outputPath, async (staged) => {
        await writeFile(staged, built.buffer);
      });
      summary = { fileSize: built.buffer.length, frames: built.pages, pages: built.pages };
    } else {
      const written = await writeImageOutput({
        format,
        plan,
        outputPath,
        width: composition.width,
        height: composition.height,
        fps: composition.fps,
        overwrite,
        frames: renderFrames(),
        gif: {
          quality: options.gifQuality,
          dither: options.gifDither,
          maxFrames: options.gifMaxFrames,
        },
        title: composition.name,
      });
      summary = { fileSize: written.fileSize, frames: written.frames, pages: written.pages };
    }

    clearRendererCaches();
    const duration = summary.frames / Math.max(1, composition.fps);
    const timeTaken = Date.now() - startTime;
    reporter.reportDone(outputPath, duration, summary.fileSize, 0);
    options.signal?.removeEventListener("abort", onAbortSignal);
    if (!fresh && !noCache) await checkpointManager.clear();
    await registry.runHook("afterRender", {
      composition: processedComposition,
      outputPath,
      totalFrames,
      durationMs: timeTaken,
    });
    return {
      outputPath,
      duration,
      fileSize: summary.fileSize,
      timeTaken,
      cacheReuse: 0,
      frames: summary.frames,
      pages: summary.pages,
    };
  }

  const cleanup = async () => {
    if (videoEncoder) {
      await videoEncoder.cancel().catch(() => undefined);
    }
    await Promise.all([
      rm(tempVideoPath, { force: true }),
      rm(rawFramePath, { force: true }),
      rm(outputPath + ".partial", { force: true }),
    ]).catch(() => undefined);
  };

  let workerManagerRef: WorkerManager | null = null;
  let decodeServiceRef: SharedDecodeService | null = null;
  let aborting: Promise<void> | null = null;

  /**
   * The single abort path: programmatic cancel, signal-based cancel and the
   * CLI all land here. Repeated calls reuse the first promise, so cleanup runs
   * once and late cancels are no-ops.
   */
  const abort = (): Promise<void> => {
    if (aborting) return aborting;
    cancelled = true;
    aborting = (async () => {
      if (workerManagerRef) await workerManagerRef.terminate().catch(() => undefined);
      if (decodeServiceRef) {
        await decodeServiceRef.cancel().catch(() => undefined);
        await decodeServiceRef.dispose().catch(() => undefined);
      }
      await cleanup();
      await checkpointManager.flush().catch(() => undefined);
      await cleanupActiveTempFiles();
      if (!fresh && !noCache) await renderCache.invalidate(compositionHash).catch(() => undefined);
      await registry.runHook("onError", {
        error: createError(ErrorCode.CC4003),
        context: "cancelled",
      }).catch(() => undefined);
    })();
    return aborting;
  };

  const onAbortSignal = (): void => {
    void abort();
  };
  options.signal?.addEventListener("abort", onAbortSignal, { once: true });
  if (options.signal?.aborted === true) {
    await abort();
    throw createError(ErrorCode.CC4003);
  }

  const cancellation = createCancellationController({
    onCancel: async (signal) => {
      await abort();
      if (!silent) {
        console.warn(
          `[CC4005] received ${signal}: checkpoint persisted and temporary files removed`,
        );
      }
    },
  });
  cancellation.install();

  try {
    await registry.runHook("beforeEncode", {
      composition: processedComposition,
      outputPath,
      format: requestedFormat ?? (format as RenderFormat),
      totalFrames,
      encoderArgs: [],
    });
    const encodeStarted = Date.now();
    let sink: FrameSink;
    if (twoPass) {
      sink = new RawFrameSink(rawFramePath);
    } else {
      videoEncoder = createVideoEncoderWithEncoding({
        fps: composition.fps,
        width: composition.width,
        height: composition.height,
        outputPath: tempVideoPath,
        tempDir: cacheDir,
        encoding,
        format: requestedFormat,
        alpha,
        fragmented: options.streaming === true,
        overwrite,
      });
      await videoEncoder.start();
      sink = videoEncoder;
    }

    const frameQueue = new FrameQueue(sink, frameBudget, transportBudget.frameBytes);
    reporter = createProgressReporter({ totalFrames, onProgress, silent, onWarning: warningHook });
    reporter.setStage("rendering");

    const baseConcurrency = resolveConcurrency(concurrency);
    const workload = analyzeWorkload(processedComposition);
    const tuning =
      concurrency === "auto" ? tuneConcurrency(workload, { cpuCount: baseConcurrency }) : null;
    const resolvedConcurrency = tuning?.concurrency ?? baseConcurrency;
    if (tuning && !silent) {
      reporter.reportWarning(
        `[CC7002] ${tuning.reason} (${workload.classification}, ${resolvedConcurrency} worker(s))`,
      );
    }
    if (options.verbose === true && !silent) {
      console.log(`[CC7100] render memory budget: ${transportBudget.description}`);
    }
    const prefetcher = createMediaPrefetcher({
      onWarning: (message) => reporter.reportWarning(`[CC7003] ${message}`),
    });
    const decodeTempDir = join(cacheDir, "tmp", `decode-${randomUUID().slice(0, 8)}`);
    const decodeService = createSharedDecodeService({
      mediaCache: getMediaCacheForRenderer() ?? createMediaCache(join(cacheDir, "media")),
      composition: processedComposition,
      tempDir: decodeTempDir,
      memoryBudgetBytes: Math.max(64 * 1024 * 1024, Math.floor(transportBudget.totalBytes * 0.4)),
      diskBudgetBytes: 1024 * 1024 * 1024,
      prefetchAhead: 8,
    });
    decodeServiceRef = decodeService;

    const workerPlugins = registry.getAll().map((entry) => ({
      name: entry.plugin.manifest.name,
      source: entry.source,
      options: entry.options,
    }));

    const workerManagerOptions = {
      concurrency: resolvedConcurrency,
      composition: processedComposition,
      seed,
      cacheDir,
      budget: frameBudget,
      maxChunkBytes: transportBudget.chunkBytes,
      fonts: options.fonts,
      projectRoot: options.projectRoot ?? process.cwd(),
      mediaDir: options.mediaDir ?? "media",
      errorPolicy: options.frameErrorPolicy ?? "placeholder",
      plugins: workerPlugins,
      cacheProvider: async (request: { key: string }) => {
        if (!request.key.startsWith("video:")) return undefined;
        const at = request.key.lastIndexOf("@");
        const src = request.key.slice("video:".length, at);
        const sourceFrame = Number(request.key.slice(at + 1));
        if (!Number.isFinite(sourceFrame)) return undefined;
        const frame = await decodeService.requestFrame(src, sourceFrame);
        return {
          data: frame.buffer,
          width: frame.width,
          height: frame.height,
          format: frame.format,
        };
      },
      batchCacheProvider: async (keys: readonly string[]) => {
        const results = new Map<string, { data: Buffer; width?: number; height?: number; format?: "rgba" | "rgb24" }>();
        const bySrc = new Map<string, number[]>();
        for (const key of keys) {
          if (!key.startsWith("video:")) continue;
          const at = key.lastIndexOf("@");
          const src = key.slice("video:".length, at);
          const sourceFrame = Number(key.slice(at + 1));
          if (!Number.isFinite(sourceFrame)) continue;
          const list = bySrc.get(src) ?? [];
          list.push(sourceFrame);
          bySrc.set(src, list);
        }
        for (const [src, frameIndices] of bySrc.entries()) {
          const decodedMap = await decodeService.requestFrames(src, frameIndices);
          for (const [frameIdx, decoded] of decodedMap.entries()) {
            results.set(`video:${src}@${frameIdx}`, {
              data: decoded.buffer,
              width: decoded.width,
              height: decoded.height,
              format: decoded.format,
            });
          }
        }
        return results;
      },
      onMemoryWarning: (usage: number, budget: number) => {
        reporter.reportWarning(
          `[CC7001] render chunk memory usage at ${formatBytes(usage)} of ${formatBytes(budget)} — reducing chunk size is recommended`,
        );
      },
    };
    const workerManager = createWorkerManager(workerManagerOptions);

    workerManagerRef = workerManager;

    const windowSize = Math.max(1, resolvedConcurrency);

    /**
     * Enqueue a chunk's frames to the back-pressured write queue. Respects
     * cancellation and propagates encoder errors.
     */
    const encodeFrames = async (
      frames: readonly { readonly index: number; readonly buffer: Buffer }[],
      chunkIndex: number,
      reusable: boolean,
    ): Promise<void> => {
      const framesToCache: { index: number; buffer: Buffer }[] = [];

      for (const { index, buffer } of frames) {
        if (cancelled) break;
        if (colorTransform) {
          colorTransform.transformBuffer(
            new Uint8ClampedArray(buffer.buffer, buffer.byteOffset, buffer.byteLength),
            {
              layout: "rgba",
            },
          );
        }
        await frameQueue.enqueue({ index, buffer });
        framesToCache.push({ index, buffer });
        completedFrames++;
        options.midiPlayer?.syncFrame(frameToSeconds(index, renderConversion));
        reporter.reportFrame(completedFrames - 1);
        await fireProgressHook(completedFrames);
      }

      if (reusable) {
        cacheReuseFrames += frames.length;
      } else if (!noCache && !cancelled && framesToCache.length > 0) {
        await renderCache.setChunk(compositionHash, chunkIndex, framesToCache);
      }

      for (const frame of framesToCache) checkpointManager.markFrame(frame.index);
      await checkpointManager.flushIfNeeded();
      reporter.reportChunk(chunkIndex, frames.length);
    };

    let lastEmittedChunk = -1;

    for (let base = 0; base < chunks.length && !cancelled; base += windowSize) {
      const window: number[] = [];
      for (let i = base; i < Math.min(base + windowSize, chunks.length); i++) window.push(i);

      const reusedByChunk = new Map<number, readonly { index: number; buffer: Buffer }[]>();
      const chunksToRender: { chunkIndex: number; chunk: FrameChunk }[] = [];

      for (const chunkIndex of window) {
        const chunk = chunks[chunkIndex];
        if (!chunk) continue;
        const resumedChunkComplete =
          resumedFrames.size > 0 && chunk.frames.every((frame) => resumedFrames.has(frame));

        if (!noCache && resumedChunkComplete) {
          const cachedFrames = await renderCache.getChunk(compositionHash, chunkIndex);
          if (cachedFrames) {
            reusedByChunk.set(chunkIndex, cachedFrames);
            continue;
          }
        }
        chunksToRender.push({ chunkIndex, chunk });
      }

      const prefetchFrames = chunks
        .slice(base + windowSize, base + windowSize * 2)
        .flatMap((chunk) => chunk.frames);
      prefetcher.prefetchAhead(processedComposition, prefetchFrames);

      const renderedResults =
        chunksToRender.length > 0
          ? await (async () => {
              for (const { chunk } of chunksToRender) {
                for (const frame of chunk.frames) {
                  await registry.runHook("beforeFrame", {
                    composition: processedComposition,
                    frame,
                    frameNumber: frame,
                    totalFrames,
                    timestamp: frameToSeconds(frame, renderConversion),
                  });
                }
              }
              return workerManager.processChunks(chunksToRender.map((c) => c.chunk));
            })()
          : [];

      const resultByStartFrame = new Map<number, WorkerResult>();
      for (const result of renderedResults) resultByStartFrame.set(result.chunkIndex, result);

      for (const chunkIndex of window) {
        if (cancelled) break;

        const reused = reusedByChunk.get(chunkIndex);
        if (reused) {
          await encodeFrames(reused, chunkIndex, true);
          lastEmittedChunk = chunkIndex;
          continue;
        }

        const entry = chunksToRender.find((c) => c.chunkIndex === chunkIndex);
        const result = entry ? resultByStartFrame.get(entry.chunk.startFrame) : undefined;
        if (!result || !entry) continue;

        if (result.failures && result.failures.length > 0) {
          reporter.reportWarning(
            `[CC4004] chunk ${chunkIndex}: ${result.failures.length} frame(s) failed; policy "${options.frameErrorPolicy ?? "placeholder"}" applied`,
          );
        }

        if (result.aborted) {
          throw createError(ErrorCode.CC4003, {
            details: `${result.error ?? "frame rendering aborted"}${result.diagnostics ? `\n${result.diagnostics}` : ""}`,
          });
        }

        let framesToEncode = result.frames;
        if (result.error) {
          const strategy = resolveStrategy(recovery, "frame");
          const allowFallback = recovery?.fallbackFrame ?? DEFAULT_RECOVERY.fallbackFrame;
          const chunkError = new Error(result.error);
          if (strategy === "abort") throw chunkError;

          let recoveredFrames:
            readonly { readonly index: number; readonly buffer: Buffer }[] | null = null;
          if (strategy === "retry") {
            const retries = Math.max(0, recovery?.maxRetries ?? DEFAULT_RECOVERY.maxRetries);
            for (let attempt = 1; attempt <= retries; attempt += 1) {
              const retryResults = await workerManager.processChunks([entry.chunk]);
              const retryResult = retryResults[0];
              if (retryResult && !retryResult.error) {
                recoveredFrames = retryResult.frames;
                reporter.reportWarning(
                  `[CC4001] chunk ${chunkIndex} recovered on retry ${attempt}: ${result.error}`,
                );
                break;
              }
            }
          }
          if (recoveredFrames) {
            framesToEncode = recoveredFrames;
          } else if ((strategy === "skip" || strategy === "retry") && allowFallback) {
            framesToEncode = entry.chunk.frames.map((frame) => ({
              index: frame,
              buffer: createFallbackFrameBuffer(processedComposition),
            }));
            reporter.reportDegradation(
              `[CC4001] chunk ${chunkIndex} failed: ${result.error} — placeholder frames substituted for ${entry.chunk.frames.length} frame(s)`,
              {
                code: ErrorCode.CC4001,
                what: `chunk ${chunkIndex} failed to render`,
                input: composition.name,
                instead: `${entry.chunk.frames.length} placeholder frame(s) substituted`,
              },
            );
          } else {
            throw chunkError;
          }
        }

        for (const frame of framesToEncode) {
          await registry.runHook("afterFrame", {
            composition: processedComposition,
            frame: frame.index,
            frameNumber: frame.index,
            totalFrames,
            timestamp: frameToSeconds(frame.index, renderConversion),
          });
        }
        await encodeFrames(framesToEncode, chunkIndex, false);
        workerManager.releaseChunk(result);
        lastEmittedChunk = chunkIndex;
      }
    }

    const startup = workerManager.getStartupMeasurement();
    const throughput = workerManager.getThroughput();
    await workerManager.terminate();
    await decodeService.dispose();
    clearRendererCaches();
    frameBudget.reset();
    if (options.verbose === true && !silent) {
      const decodeStats = decodeService.getStats();
      console.log(
        `[CC7104] shared decode: ${decodeStats.decodeCount} decodes (${decodeStats.framesDecoded} frames), ${decodeStats.memoryHits} mem hits, ${decodeStats.diskHits} disk hits, ${decodeStats.spillCount} spills, ${decodeStats.evictionCount} evictions`,
      );
      console.log(
        `[CC7103] worker startup: ${startup.workers} worker(s), ${startup.startupMs}ms total, ${startup.perWorkerMs}ms each; throughput: ${throughput.fps.toFixed(1)} frames/s`,
      );
      const transport = getFrameTransportStats();
      console.log(
        `[CC7101] frame transport: ${transport.framesProduced} produced, ${transport.framesTransferred} transferred, ${transport.pixelCopies} pixel copies, budget peak ${formatBytes(frameBudget.peakBytes)}`,
      );
      const caches = getRendererCacheStats();
      const cacheBytes = caches.reduce((total, cache) => total + cache.bytes, 0);
      console.log(
        `[CC7102] renderer caches: ${caches.length} bounded cache(s), ${formatBytes(cacheBytes)} retained, ${caches.reduce((total, cache) => total + cache.evictions, 0)} eviction(s)`,
      );
    }

    if (lastEmittedChunk !== chunks.length - 1 && !cancelled) {
      throw createError(ErrorCode.CC4002, {
        details: `Render incomplete: last encoded chunk ${lastEmittedChunk} of ${chunks.length - 1}`,
      });
    }

    if (cancelled) {
      await cleanup();
      throw createError(ErrorCode.CC4003);
    }

    // Close the frame queue — drains all remaining frames, then closes ffmpeg's
    // stdin so it flushes and finalizes the temp MP4. Without this the muxer
    // reads an unterminated file and the render never completes.
    await frameQueue.close();
    await registry.runHook("afterEncode", {
      composition: processedComposition,
      outputPath,
      durationMs: Date.now() - encodeStarted,
      fileSize: await stat(tempVideoPath)
        .then((info) => info.size)
        .catch(() => 0),
    });

    if (twoPass) {
      reporter.setStage("encoding");
      const twoPassResult = await encodeTwoPass({
        fps: composition.fps,
        width: composition.width,
        height: composition.height,
        crf: encoding.crf,
        preset: encoding.preset,
        pixFmt: encoding.pixFmt,
        codec: encoding.codec,
        backend: encoding.backend,
        format: requestedFormat,
        alpha,
        outputPath: tempVideoPath,
        tempDir: cacheDir,
        overwrite,
        rawPath: rawFramePath,
        bitrateKbps: options.bitrateKbps,
      });
      if (!twoPassResult.success) {
        throw createError(ErrorCode.CC4002, { details: twoPassResult.error ?? "Two-pass encoding failed" }, { location: { file: outputPath } });
      }
      await rm(rawFramePath, { force: true });
    }

    // Overlap audio preparation with encoder tail to reduce total wall time.
    const audioConfig = composition.audio ?? {};
    const sampleRate = audioConfig.sampleRate ?? 48000;
    const channels = audioConfig.channels ?? 2;
    const duration = frameToSeconds(totalFrames, renderConversion);
    const mixerOptions: MixerOptions = {
      sampleRate,
      channels,
      masterVolume: audioConfig.masterVolume ?? 1,
      duration,
      sidechains: audioConfig.sidechains,
    };

    const audioTrackNames = composition.rootTimeline.tracks
      .filter((track) => track.kind === "audio")
      .map((track) => track.name ?? "");
    const audioPrepare = {
      cache: mediaCache,
      sampleRate,
      channels,
      duration,
      stemCacheDir: cacheDir,
      conversion: renderConversion,
      trackNames: audioTrackNames,
    };

    const mixTrackCount = composition.rootTimeline.tracks.filter(
      (track) => track.kind === "audio",
    ).length;
    await registry.runHook("beforeMix", {
      composition: processedComposition,
      trackCount: mixTrackCount,
      sampleRate,
      durationSeconds: duration,
    });
    const mixStarted = Date.now();

    const audioOutcome = await withRecovery(
      async () => {
        const tracks: AudioTrackState[] = [];
        for (const track of composition.rootTimeline.tracks) {
          if (track.kind !== "audio") continue;
          const prepared = await prepareAudioTracks(track.clips, {
            ...audioPrepare,
            trackMuted: track.muted ?? false,
          });
          tracks.push(...prepared);
        }
        if (tracks.length === 0) return null;
        assertSidechainSources(tracks);
        return mixAudioTracks(tracks, mixerOptions);
      },
      resolveStrategy(recovery, "audio"),
      recovery?.maxRetries ?? 0,
    );

    if (audioOutcome.status !== "ok") {
      const reason = audioOutcome.error?.message ?? "unknown";
      if (options.allowSilentAudio !== true) {
        throw createError(
          ErrorCode.CC5001,
          { name: composition.name, reason },
          { location: { file: outputPath }, cause: audioOutcome.error },
        );
      }
      recordDegradation({
        code: ErrorCode.CC5001,
        what: "audio mix replaced with silence",
        reason,
        input: composition.name,
        instead: "the render continues without an audio bed (allowSilentAudio)",
      });
    }
    const mixResult = audioOutcome.value ?? mixAudioTracks([], mixerOptions);
    const muxAudio = muxPlan !== null && (!mixResult.report.silent || options.forceAudio === true);
    if (muxAudio && mixResult.report.silent) {
      recordDegradation({
        code: ErrorCode.CC5001,
        what: "audio stream forced on a silent mix",
        reason: "every audio track is muted, excluded or silent",
        input: composition.name,
        instead: "a silent audio track is written",
      });
    }

    await registry.runHook("afterMix", {
      composition: processedComposition,
      trackCount: mixTrackCount,
      sampleRate,
      durationSeconds: duration,
      durationMs: Date.now() - mixStarted,
      peakLevel: mixResult.peakLevel,
      peakAfterLimit: mixResult.report.peakAfterLimit,
      silent: mixResult.report.silent,
      channelConversions: mixResult.report.channelConversions.map((conversion) => ({
        id: conversion.id,
        from: conversion.from,
        to: conversion.to,
        kind: conversion.kind,
      })),
    });

    reporter.reportAudioDone();
    reporter.reportEncoding();
    reporter.reportCacheStats(cacheReuseFrames, Math.max(1, totalFrames));

    const muxOptions: MuxerOptions | null = muxPlan
      ? {
          videoPath: tempVideoPath,
          audioBuffer: mixResult.buffer,
          outputPath,
          overwrite,
          videoDuration: duration,
          audioCodec: muxPlan.codec,
          audioBitrateKbps: muxPlan.bitrateKbps,
          pcmBitDepth: muxPlan.bitDepth,
          audioChannels: muxPlan.channels,
          channelLayout: muxPlan.channelLayout,
          containerFormat: muxPlan.container,
        }
      : null;

    if (muxAudio) reporter.reportMuxing();
    await withAtomicOutput(outputPath, async (stagedOutput) => {
      if (!muxAudio || !muxOptions) {
        await copyFile(tempVideoPath, stagedOutput);
        await verifyMuxedOutput(stagedOutput, {
          audio: false,
          nonSilent: false,
          duration,
          outputPath,
        });
        return;
      }
      const muxResult = await muxAudioVideo({
        ...muxOptions,
        outputPath: stagedOutput,
        overwrite: true,
      });
      if (!muxResult.success) throw muxError(muxResult.error, outputPath);
      if (muxResult.adjustment !== "none") {
        recordWarning({
          code: ErrorCode.CC4005,
          message: `audio bed ${muxResult.adjustment === "padded" ? "padded with silence" : "trimmed"} to the ${duration.toFixed(3)}s video duration`,
          input: outputPath,
        });
      }
      await verifyMuxedOutput(stagedOutput, {
        audio: true,
        nonSilent: !mixResult.report.silent,
        codec: muxPlan?.ffmpegCodec,
        duration,
        outputPath,
      });
    });

    if (composition.chapters && composition.chapters.length > 0) {
      const chapterPath = `${outputPath}.with-chapters${extname(outputPath)}`;
      const embedded = await embedChaptersIntoVideo({
        videoPath: outputPath,
        chapters: composition.chapters,
        outputPath: chapterPath,
        tempDir: cacheDir,
        duration,
      });
      if (embedded) {
        await rename(chapterPath, outputPath).catch(async () => {
          await rm(outputPath, { force: true });
          await rename(chapterPath, outputPath);
        });
      } else {
        await rm(chapterPath, { force: true });
        reporter.reportDegradation(
          "[CC8002] chapter metadata could not be embedded — the video is still valid",
          { code: ErrorCode.CC8002, what: "chapter metadata", input: outputPath, instead: "video written without chapters" },
        );
      }
    }

    const outputStat = await stat(outputPath);
    const fileSize = outputStat.size;

    await rm(tempVideoPath, { force: true });

    const timeTaken = Date.now() - startTime;
    const cacheReuse = totalFrames > 0 ? (cacheReuseFrames / totalFrames) * 100 : 0;

    reporter.reportDone(outputPath, duration, fileSize, cacheReuse);

    await checkpointManager.clear();

    const { flushFontFallbackWarnings } = await import("../renderer/text/engine.js");
    const fallbackWarning = flushFontFallbackWarnings();
    if (fallbackWarning) {
      if (options.strictFonts === true) {
        throw createError(
          ErrorCode.CC3006,
          { font: "configured family(s)", text: fallbackWarning },
          { location: { file: outputPath }, fixHint: "Install the requested font or disable strict font checking." },
        );
      }
      reporter.reportDegradation(fallbackWarning, {
        code: "CC3006",
        what: "text font fallback",
        input: composition.name,
        instead: "fallback glyphs rendered",
      });
    }

    if (options.generateThumbnail && (format === "mp4" || format === "webm")) {
      const config = options.generateThumbnail === true ? {} : options.generateThumbnail;
      const { generateThumbnail } = await import("../encoder/thumbnail/index.js");
      const thumbPath = config.outputPath ?? outputPath.replace(/\.[a-z0-9]+$/i, ".thumb.png");
      await generateThumbnail(processedComposition, thumbPath, {
        formats: config.formats ?? ["png"],
        seed,
      }).catch((error: unknown) => {
        reporter.reportDegradation(
          `[CC8003] thumbnail generation failed: ${error instanceof Error ? error.message : String(error)}`,
          { code: ErrorCode.CC8003, what: "thumbnail generation", input: thumbPath, instead: "video written without a thumbnail" },
        );
      });
    }

    await registry.runHook("afterRender", {
      composition: processedComposition,
      outputPath,
      totalFrames,
      durationMs: Date.now() - startTime,
    });
    cancellation.dispose();
    options.signal?.removeEventListener("abort", onAbortSignal);

    return {
      outputPath,
      duration,
      fileSize,
      timeTaken,
      cacheReuse,
    };
  } catch (error) {
    if (decodeServiceRef) await decodeServiceRef.dispose().catch(() => undefined);
    cancellation.dispose();
    options.signal?.removeEventListener("abort", onAbortSignal);
    await checkpointManager.flush().catch(() => undefined);
    await cleanup();
    reporter.reportError(error instanceof Error ? error : new Error(String(error)));
    await registry.runHook("onError", {
      error: error instanceof Error ? error : new Error(String(error)),
      context: "renderVideo",
    });
    throw error;
  }
}

async function verifyMuxedOutput(
  filePath: string,
  expected: {
    readonly audio: boolean;
    readonly nonSilent: boolean;
    readonly codec?: string;
    readonly duration: number;
    readonly outputPath: string;
  },
): Promise<void> {
  const probe = await probeMediaFile(filePath);
  if (!probe.videoCodec) {
    throw muxError(`muxed artifact has no video stream (${probe.streamCount} streams)`, expected.outputPath);
  }
  if (expected.audio) {
    if (!probe.hasAudio) {
      throw muxError("expected an audio stream, the muxed artifact has none", expected.outputPath);
    }
    if (expected.codec && probe.audioCodec !== expected.codec) {
      throw muxError(
        `expected audio codec "${expected.codec}", got "${probe.audioCodec ?? "none"}"`,
        expected.outputPath,
      );
    }
    if (expected.nonSilent && probe.audioDuration === 0) {
      throw muxError("expected a non-silent audio stream, the muxed artifact has an empty one", expected.outputPath);
    }
  } else if (probe.hasAudio) {
    throw muxError("expected no audio stream, the muxed artifact has one", expected.outputPath);
  }
  const tolerance = Math.max(0.5, expected.duration * 0.02);
  if (Math.abs(probe.duration - expected.duration) > tolerance) {
    throw muxError(
      `output duration ${probe.duration.toFixed(3)}s does not match the video duration ${expected.duration.toFixed(3)}s`,
      expected.outputPath,
    );
  }
}

export function muxError(reason: string | undefined, outputPath: string) {
  return createError(
    ErrorCode.CC4005,
    { reason: reason ?? "ffmpeg mux exited without an output" },
    { location: { file: outputPath } },
  );
}

export function createRenderJob(options: RenderOptions): RenderJob {
  const controller = new AbortController();
  const handlers = new Map<string, Set<ProgressHandler>>();

  const jobPromise = (async () => {
    return renderVideo({
      ...options,
      signal: options.signal ?? controller.signal,
      onProgress: (event) => {
        for (const handler of handlers.get(event.type) ?? []) {
          handler(event);
        }
        if (event.type !== "progress") {
          for (const handler of handlers.get("progress") ?? []) {
            handler(event);
          }
        }
      },
    });
  })();

  return {
    promise: jobPromise,
    async cancel() {
      if (!controller.signal.aborted) controller.abort();
      await jobPromise.catch(() => undefined);
    },
    on(event: string, handler: ProgressHandler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off(event: string, handler: ProgressHandler) {
      handlers.get(event)?.delete(handler);
    },
  };
}

// Public pipeline surface. Re-exported explicitly (no blanket barrel) so the
// package entry exposes worker/chunk/cache/resume/progress/profiling without
// leaking internals.
export {
  createRenderCache,
  RenderCache,
  computeCompositionHash,
  computeCanonicalCacheIdentity,
  findFunctionValuedProperty,
  canonicalJsonString,
  computeDescriptorHash,
  createFrameCacheDescriptor,
  fingerprintMediaFile,
  objectPath,
  type FrameCacheDescriptor,
  type FrameCacheIndex,
  type MediaFingerprint,
  type RenderCacheEntry,
  type RenderCacheStats,
  type CacheGcOptions,
  type CacheGcResult,
  type CacheIdentityInputs,
} from "./cache.js";
export {
  collectFrameCacheGarbage,
  enforceCacheQuota,
  formatCacheGcResult,
  pruneStaleEntries,
  DEFAULT_CACHE_MAX_BYTES,
} from "./cache-gc.js";
export {
  createWorkerManager,
  createChunks,
  resolveConcurrency,
  WorkerManager,
  type WorkerManagerOptions,
  type FrameChunk,
  type WorkerResult,
  type WorkerStartupMeasurement,
  type WorkerThroughputMeasurement,
} from "./workers.js";
export {
  createResumeManager,
  type ResumeManager,
  type ResumeState,
  type ChunkState,
} from "./resume.js";
export {
  createProgressReporter,
  formatTime,
  type ProgressReporter,
  type ProgressEvent,
  type ProgressHandler,
  type ProgressReporterOptions,
  type RenderStage,
} from "./progress.js";
export {
  createRenderProfiler,
  estimateRenderTimeMs,
  shouldLog,
  type RenderProfiler,
  type RenderProfile,
  type StageTiming,
  type ProfilableStage,
  type LogLevel,
} from "./profiling.js";
export {
  buildRenderGraph,
  serializeRenderGraph,
  type RenderGraph,
  type RenderGraphNode,
  type RenderGraphFrame,
} from "./graph.js";
export {
  CheckpointManager,
  createCheckpointManager,
  encodeFrameBitmask,
  decodeFrameBitmask,
  absoluteToRelative,
  relativeToAbsolute,
  type RenderCheckpoint,
  type CheckpointManagerOptions,
  type EncoderCheckpointState,
  type AudioCheckpointState,
} from "./checkpoint.js";
export {
  tuneConcurrency,
  tuneConcurrencyForComposition,
  analyzeWorkload,
  createConcurrencyTuner,
  ConcurrencyTuner,
  type WorkloadClass,
  type WorkloadProfile,
  type TuningLimits,
  type TuningResult,
} from "./concurrency-tuner.js";
export {
  withRecovery,
  renderFrameWithRecovery,
  createFallbackFrameBuffer,
  resolveStrategy,
  DEFAULT_RECOVERY,
  type RecoveryStrategy,
  type RecoveryPolicy,
  type RecoveryOutcome,
  type FailurePhase,
  type FrameRenderOutcome,
} from "./recovery.js";
export { GracefulDrainManager, type DrainOptions } from "./drain.js";
export { TenantContext, DEFAULT_TENANT_QUOTA, type TenantQuota } from "./tenant.js";
export {
  createSharedDecodeService,
  type SharedDecodeService,
  type DecodedFrame,
  type DecodeServiceStats,
} from "../media/decode-service.js";
