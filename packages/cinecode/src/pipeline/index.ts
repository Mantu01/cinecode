import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { Composition, RenderFormat, QualitySetting } from "../core/types/index.js";
import type { VideoEncoding } from "../core/quality.js";
import { encodingCacheKey, normalizeQuality, resolveVideoEncoding } from "../core/quality.js";
import type { AudioTrackState } from "../audio/types.js";
import { prepareAudioTracks } from "../audio/prepare.js";
import { createConversion, createVfrConversion, frameToSeconds, secondsToFrame } from "../core/time/index.js";
import { computeClipSpan } from "../core/validation/index.js";
import { findTimelineOvershoots } from "../core/time/timeline.js";
import { createColorTransform, resolveColorManagementConfig } from "../renderer/color/profiles.js";
import { createRenderCache, type RenderCache } from "./cache.js";
import { createResumeManager, type ResumeManager } from "./resume.js";
import { createCheckpointManager } from "./recovery.js";
import { createWorkerManager, createChunks, resolveChunkSize, resolveConcurrency, type FrameChunk, type WorkerResult, type WorkerManager } from "./workers.js";
import { tuneConcurrency, analyzeWorkload } from "./concurrency-tuner.js";
import { createMediaPrefetcher } from "../media/prefetch.js";
import { createProgressReporter, type ProgressReporter, type ProgressHandler } from "./progress.js";
import { cleanupActiveTempFiles, withAtomicOutput } from "../encoder/output.js";
import { createCancellationController } from "./signals.js";
import { createVideoEncoderWithEncoding, type VideoEncoder } from "../encoder/index.js";
import { RawFrameSink, encodeTwoPass, type FrameSink } from "../encoder/two-pass.js";
import { embedChaptersIntoVideo } from "../encoder/chapters/index.js";
import { createMediaCache } from "../media/cache.js";
import { mixAudioTracks, type MixerOptions } from "../audio/mixer.js";
import { ffmpegLayoutForChannelCount } from "../audio/channels.js";
import { muxAudioVideo, type MuxerOptions } from "../audio/muxer.js";
import { computeCompositionHash } from "./cache.js";
import { preprocessVideo, type VideoEditOptions } from "../media/preprocess.js";
import { getPluginRegistry } from "../plugin/registry.js";
import { renderFrameWithRecovery, createFallbackFrameBuffer, withRecovery, type RecoveryPolicy, resolveStrategy, DEFAULT_RECOVERY } from "./recovery.js";
import { createMemoryBudget, estimateChunkBytes, formatBytes, type MemoryBudget } from "./memory.js";

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
  readonly memoryBudget?: MemoryBudget;
  readonly previewMode?: boolean;
  readonly previewFps?: number;
  /** Run a rate-analysis pass before the final encode (requires bitrate). */
  readonly twoPass?: boolean;
  /** Emit fragmented MP4 so a partial render stays playable after interruption. */
  readonly streaming?: boolean;
  /** Working/output color space conversion applied to every encoded frame. */
  readonly colorManagement?: { readonly workingColorSpace?: "srgb" | "linear-srgb" | "rec709" | "acescg"; readonly outputColorSpace?: "srgb" | "rec709" | "display-p3" | "rec2020"; readonly enabled?: boolean };
  readonly bitrateKbps?: number;
  /** Write a poster image selected from the rendered composition. */
  readonly generateThumbnail?: boolean | { readonly outputPath?: string; readonly formats?: readonly ("png" | "jpg" | "webp")[] };
}

export interface RenderResult {
  readonly outputPath: string;
  readonly duration: number;
  readonly fileSize: number;
  readonly timeTaken: number;
  readonly cacheReuse: number;
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
    const dur = typeof composition.duration === "number"
      ? composition.duration
      : parseFloat(composition.duration as string);
    const durFrames = Math.ceil(secondsToFrame(dur, conversion));
    return composition.boundaryBehavior === "extend" ? Math.max(durFrames, clipMax) : durFrames;
  }
  return clipMax;
}

/**
 * Reads a chunk of frames and sends them to the encoder via a back-pressured
 * write queue. The queue holds at most `highWaterMark` frames so the encoder
 * (a single ffmpeg process reading stdin) is never starved while workers are
 * ahead, and workers don't pile up unbounded buffers in memory.
 *
 * Each frame write is fired-and-forgotten; `writeErrors` collects any that
 * occur so they can be surfaced after all frames have been enqueued.
 */
class FrameQueue {
  private readonly encoder: FrameSink;
  private readonly highWaterMark: number;
  /** Slots available — decremented on enqueue, incremented on write-complete. */
  private slots: number;
  private pendingWrites = 0;
  private drained = false;
  private resolveDrain!: () => void;
  private drainPromise = new Promise<void>((r) => { this.resolveDrain = r; });
  private readonly writeErrors: Error[] = [];

  constructor(encoder: FrameSink, highWaterMark = 64) {
    this.encoder = encoder;
    this.highWaterMark = highWaterMark;
    this.slots = highWaterMark;
  }

  get empty(): boolean { return this.pendingWrites === 0; }
  get size(): number { return this.pendingWrites; }

  /** Push a frame. Returns a promise that resolves when the frame is accepted. */
  enqueue(frame: { index: number; buffer: Buffer }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.slots <= 0) {
        // Wait for a slot to free up — a new microtask is created each time
        // slots becomes positive, so this naturally chains without flooding.
        const checkSlot = (): void => {
          if (this.slots > 0) {
            this.doWrite(frame, resolve, reject);
          } else {
            setImmediate(checkSlot);
          }
        };
        setImmediate(checkSlot);
        return;
      }
      this.doWrite(frame, resolve, reject);
    });
  }

  private doWrite(
    frame: { index: number; buffer: Buffer },
    resolve: () => void,
    reject: (err: Error) => void,
  ): void {
    this.slots--;
    this.pendingWrites++;
    this.encoder.addFrame(frame.buffer).then(() => {
      this.pendingWrites--;
      this.slots++;
      if (this.pendingWrites === 0 && this.drained) this.resolveDrain();
      resolve();
    }).catch((err) => {
      this.writeErrors.push(err);
      this.pendingWrites--;
      this.slots++;
      if (this.pendingWrites === 0 && this.drained) this.resolveDrain();
      reject(err);
    });
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
      throw new Error(result.error ?? "Encoding failed");
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
    noCache,
    fromFrame = 0,
    toFrame,
    onProgress,
    silent = false,
    recovery,
    memoryBudget: memoryBudgetOption,
  } = options;

  const encoding: VideoEncoding =
    encodingOption ?? resolveVideoEncoding({ quality: quality ? normalizeQuality(quality) : undefined });
  const alpha = alphaOption === true || requestedFormat === "webm-alpha" || requestedFormat === "prores-alpha";
  const format: RenderFormat | undefined = requestedFormat === "webm-alpha"
    ? "webm"
    : requestedFormat === "prores-alpha"
      ? "prores"
      : requestedFormat;

  const renderCache = createRenderCache(cacheDir);
  const resumeManager = createResumeManager(cacheDir);
  const mediaCache = createMediaCache(join(cacheDir, "media"));
  const registry = getPluginRegistry();
  const warningHook = (message: string, stage: string): void => {
    void registry.runHook("onWarning", { message, stage });
  };
  let reporter = createProgressReporter({ totalFrames: 0, onProgress, silent, onWarning: warningHook });

  await Promise.all([
    renderCache.initialize(),
    mediaCache.initialize(),
  ]);

  // Video clips read frames through the renderer's module-level media cache;
  // set it before any frame is drawn (workers get their own instance).
  const { setMediaCacheForRenderer } = await import("../renderer/engine.js");
  setMediaCacheForRenderer(mediaCache);

  // The frame transport format is part of the hash so caches written by a
  // previous format (e.g. the color-corrupting JPEG transport) can never be
  // replayed after an upgrade.
  const tempoKey = composition.tempo ? composition.tempo.map((region) => `${region.start}-${region.end}-${region.fps}`).join(",") : "constant";
  const colorManagement = resolveColorManagementConfig(options.colorManagement);
  const colorTransform = colorManagement.enabled
    ? createColorTransform(colorManagement.workingSpaceName, colorManagement.outputColorSpace)
    : null;
  const compositionHash = computeCompositionHash(composition, `${seed}-${encodingCacheKey(encoding)}-rawbgra-${fromFrame}-${toFrame ?? ""}-tempo:${tempoKey}-2pass:${options.twoPass === true}-br:${options.bitrateKbps ?? "auto"}-burn:${options.burnSubtitles !== false}-color:${colorManagement.workingColorSpace}>${colorManagement.outputColorSpace}`);
  const renderConversion = compositionConversion(composition);
  const graphTotalFrames = computeTotalFrames(composition);

  if (composition.boundaryBehavior === "strict") {
    const overshoots = findTimelineOvershoots(composition.rootTimeline, renderConversion, graphTotalFrames);
    if (overshoots.length > 0) {
      const first = overshoots[0]!;
      throw new Error(
        `[CC1004] clip "${first.clipName}" overshoots the composition boundary by ${first.overshootFrames} frame(s); boundaryBehavior is "strict"`,
      );
    }
  }

  const totalFrames = Math.max(0, toFrame !== undefined ? Math.min(toFrame - fromFrame, graphTotalFrames - fromFrame) : graphTotalFrames - fromFrame);
  const effectiveFromFrame = Math.max(0, fromFrame);
  const effectiveToFrame = toFrame !== undefined ? Math.min(toFrame, graphTotalFrames) : graphTotalFrames;

  const checkpointManager = createCheckpointManager({
    cacheDir,
    compositionId: composition.name,
    compositionHash,
    totalFrames,
    checkpointInterval: options.checkpointInterval,
  });
  await checkpointManager.initialize();
  const resumedFrames = new Set<number>();
  if (options.resume === true && !fresh) {
    const checkpoint = await checkpointManager.findLatestCheckpoint();
    if (checkpoint) {
      for (const frameIndex of checkpointManager.getCompletedFrames()) resumedFrames.add(frameIndex);
      if (!silent) {
        reporter.reportWarning(`[CC4002] resuming session ${checkpoint.renderSessionId}: ${resumedFrames.size}/${totalFrames} frame(s) already rendered`);
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

  let processedComposition = composition;
  if (preprocessedVideos.size > 0) {
    processedComposition = {
      ...composition,
      rootTimeline: {
        ...composition.rootTimeline,
        tracks: composition.rootTimeline.tracks.map(track => {
          if (track.kind !== "visual") return track;
          return {
            ...track,
            clips: track.clips.map(clip => {
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

  const canResume = !fresh && !noCache && await resumeManager.load().then(state =>
    state !== null && resumeManager.canResume(compositionHash, totalFrames, chunkSize)
  );

  if (canResume) {
    const state = resumeManager.getState()!;
    reporter.setStage("rendering");
  } else {
    if (!fresh && !noCache) {
      await resumeManager.initialize(totalFrames, chunkSize, compositionHash);
    }
  }

  const memoryBudget = memoryBudgetOption ?? createMemoryBudget();
  const framesPerBudget = Math.max(
    1,
    Math.floor(memoryBudget.maxBytesPerChunk / estimateChunkBytes(1, composition.width, composition.height)),
  );
  const resolvedChunkSize = Math.min(resolveChunkSize(composition, chunkSize), framesPerBudget);
  const baseChunks = createChunks(totalFrames, resolvedChunkSize);
  const chunks: FrameChunk[] = baseChunks.map((chunk) => ({
    ...chunk,
    frames: chunk.frames.map(f => f + effectiveFromFrame),
  }));

  let completedFrames = 0;
  let cacheReuseFrames = 0;
  let videoEncoder: VideoEncoder | null = null;
  let cancelled = false;

  const tempExtension = format === "webm" ? ".tmp.webm" : format === "prores" ? ".tmp.mov" : ".tmp.mp4";
  const tempVideoPath = `${outputPath}${tempExtension}`;
  const twoPass = options.twoPass === true;
  const rawFramePath = `${outputPath}.tmp.bgra`;

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

  // GIF, PNG-sequence, and PDF outputs do not go through the MP4 encode/mux
  // path. They render frames directly and hand them to the image-output
  // encoders so a .gif or .pdf request can never silently emit H.264.
  if (alpha && format === "gif") {
    reporter.reportWarning("[CC6001] GIF does not support alpha transparency — the background will be composited opaque");
  }

  if (format === "gif" || format === "png" || format === "pdf") {
    const { renderFrame } = await import("../renderer/engine.js");
    const { encodeAnimatedGif, writeFrameSequence } = await import("../encoder/outputs.js");
    const { generatePdf } = await import("../pdf/index.js");
    reporter = createProgressReporter({ totalFrames, onProgress, silent, onWarning: warningHook });
    reporter.setStage("rendering");
    const buffers: Buffer[] = [];
    for (let frame = effectiveFromFrame; frame < effectiveToFrame; frame += 1) {
      if (cancelled) throw new Error("Render cancelled");
      await registry.runHook("beforeFrame", {
        composition: processedComposition,
        frame,
        frameNumber: frame,
        totalFrames,
        timestamp: frameToSeconds(frame, renderConversion),
      });
      const outcome = await renderFrameWithRecovery(
        () => renderFrame(processedComposition, frame, seed),
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
      if (!outcome.buffer) throw outcome.error ?? new Error(`Render failed at frame ${frame}`);
      if (outcome.error) {
        reporter.reportWarning(`[CC4001] frame ${frame} failed: ${outcome.error.message} — ${outcome.usedFallback ? "placeholder substituted" : "recovered"}`);
      }
      buffers.push(outcome.buffer);
      completedFrames += 1;
      reporter.reportFrame(completedFrames);
      await fireProgressHook(completedFrames);
    }
    if (format === "gif") {
      const gifResult = await encodeAnimatedGif(buffers, outputPath, { fps: composition.fps, overwrite });
      if (!gifResult.success) throw new Error(gifResult.error ?? "GIF output failed");
      const outputStat = await stat(outputPath).catch(() => null);
      const fileSize = outputStat?.size ?? 0;
      const duration = frameToSeconds(totalFrames, renderConversion);
      const timeTaken = Date.now() - startTime;
      reporter.reportDone(outputPath, duration, fileSize, 0);
      if (!fresh && !noCache) await resumeManager.clear();
      await registry.runHook("afterRender", { composition: processedComposition, outputPath, totalFrames, durationMs: timeTaken });
      return { outputPath, duration, fileSize, timeTaken, cacheReuse: 0 };
    }
    if (format === "png") {
      const seqResult = await writeFrameSequence(buffers, outputPath, { overwrite });
      if (!seqResult.success) throw new Error(seqResult.error ?? "PNG sequence output failed");
      const outputStat = await stat(outputPath).catch(() => null);
      const fileSize = outputStat?.size ?? 0;
      const duration = frameToSeconds(totalFrames, renderConversion);
      const timeTaken = Date.now() - startTime;
      reporter.reportDone(outputPath, duration, fileSize, 0);
      if (!fresh && !noCache) await resumeManager.clear();
      await registry.runHook("afterRender", { composition: processedComposition, outputPath, totalFrames, durationMs: timeTaken });
      return { outputPath, duration, fileSize, timeTaken, cacheReuse: 0 };
    }
    // PDF output: each frame becomes one page; PNG buffers written via embedPng.
    {
      const pages = buffers.map((buf) => [{ type: "canvas" as const, data: buf, width: composition.width, height: composition.height }]);
      const pdfBuffer = await generatePdf(pages, { width: composition.width, height: composition.height, dpi: 150 });
      await withAtomicOutput(outputPath, async (stagedOutput) => {
        await writeFile(stagedOutput, pdfBuffer);
      });
      const duration = frameToSeconds(totalFrames, renderConversion);
      const timeTaken = Date.now() - startTime;
      reporter.reportDone(outputPath, duration, pdfBuffer.length, 0);
      if (!fresh && !noCache) await resumeManager.clear();
      await registry.runHook("afterRender", { composition: processedComposition, outputPath, totalFrames, durationMs: timeTaken });
      return { outputPath, duration: pdfBuffer.length, fileSize: pdfBuffer.length, timeTaken, cacheReuse: 0 };
    }
  }

  const cleanup = async () => {
    if (videoEncoder) {
      await videoEncoder.cancel();
    }
    await Promise.all([
      rm(tempVideoPath, { force: true }),
      rm(rawFramePath, { force: true }),
    ]);
  };

  const cancel = async () => {
    cancelled = true;
    await cleanup();
  };

  let workerManagerRef: WorkerManager | null = null;
  const cancellation = createCancellationController({
    onCancel: async (signal) => {
      cancelled = true;
      if (workerManagerRef) {
        await workerManagerRef.terminate().catch(() => undefined);
      }
      await cleanup().catch(() => undefined);
      await checkpointManager.flush().catch(() => undefined);
      await cleanupActiveTempFiles();
      if (!silent) {
        console.warn(`[CC4005] received ${signal}: checkpoint persisted and temporary files removed`);
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

    const frameQueue = new FrameQueue(sink);
    reporter = createProgressReporter({ totalFrames, onProgress, silent, onWarning: warningHook });
    reporter.setStage("rendering");

    const baseConcurrency = resolveConcurrency(concurrency);
    const workload = analyzeWorkload(processedComposition);
    const tuning = concurrency === "auto" ? tuneConcurrency(workload, { cpuCount: baseConcurrency }) : null;
    const resolvedConcurrency = tuning?.concurrency ?? baseConcurrency;
    if (tuning && !silent) {
      reporter.reportWarning(`[CC7002] ${tuning.reason} (${workload.classification}, ${resolvedConcurrency} worker(s))`);
    }
    const prefetcher = createMediaPrefetcher({
      onWarning: (message) => reporter.reportWarning(`[CC7003] ${message}`),
    });
    const workerManager = createWorkerManager({
      concurrency: resolvedConcurrency,
      composition: processedComposition,
      seed,
      cacheDir,
      memoryBudget,
      errorPolicy: options.frameErrorPolicy ?? "placeholder",
      onMemoryWarning: (usage, budget) => {
        reporter.reportWarning(`[CC7001] render chunk memory usage at ${formatBytes(usage)} of ${formatBytes(budget)} — reducing chunk size is recommended`);
      },
    });

    workerManagerRef = workerManager;

    const resumeState = resumeManager.getState();

    const windowSize = Math.max(1, resolvedConcurrency);

    /**
     * Enqueue a chunk's frames to the back-pressured write queue. Respects
     * cancellation and propagates encoder errors.
     */
    const encodeFrames = async (
      frames: readonly { readonly index: number; readonly buffer: Buffer }[],
      chunkIndex: number,
      reusable: boolean
    ): Promise<void> => {
      const framesToCache: { index: number; buffer: Buffer }[] = [];

      for (const { index, buffer } of frames) {
        if (cancelled) break;
        if (colorTransform) {
          colorTransform.transformBuffer(new Uint8ClampedArray(buffer.buffer, buffer.byteOffset, buffer.byteLength), {
            layout: "bgra",
          });
        }
        await frameQueue.enqueue({ index, buffer });
        framesToCache.push({ index, buffer });
        completedFrames++;
        reporter.reportFrame(completedFrames - 1);
        await fireProgressHook(completedFrames);
      }

      if (reusable) {
        cacheReuseFrames += frames.length;
      } else if (!noCache && framesToCache.length > 0) {
        await renderCache.setChunk(compositionHash, chunkIndex, framesToCache);
      }

      if (!fresh && !cancelled) {
        resumeManager.markChunkCompleted(chunkIndex);
        await resumeManager.save();
      }

      for (const frame of framesToCache) checkpointManager.markFrame(frame.index);
      await checkpointManager.flushIfNeeded();
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
        const chunkCompleted = resumeState?.chunks[chunkIndex]?.completed ?? false;
        const resumedChunkComplete = resumedFrames.size > 0 && chunk.frames.every((frame) => resumedFrames.has(frame));

        if (!noCache && (chunkCompleted || resumedChunkComplete)) {
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

      const renderedResults = chunksToRender.length > 0
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
          reporter.reportWarning(`[CC4004] chunk ${chunkIndex}: ${result.failures.length} frame(s) failed; policy "${options.frameErrorPolicy ?? "placeholder"}" applied`);
        }

        if (result.aborted) {
          throw new Error(`[CC4003] ${result.error ?? "frame rendering aborted"}${result.diagnostics ? `\n${result.diagnostics}` : ""}`);
        }

        let framesToEncode = result.frames;
        if (result.error) {
          const strategy = resolveStrategy(recovery, "frame");
          const allowFallback = recovery?.fallbackFrame ?? DEFAULT_RECOVERY.fallbackFrame;
          const chunkError = new Error(result.error);
          if (strategy === "abort") throw chunkError;

          let recoveredFrames: readonly { readonly index: number; readonly buffer: Buffer }[] | null = null;
          if (strategy === "retry") {
            const retries = Math.max(0, recovery?.maxRetries ?? DEFAULT_RECOVERY.maxRetries);
            for (let attempt = 1; attempt <= retries; attempt += 1) {
              const retryResults = await workerManager.processChunks([entry.chunk]);
              const retryResult = retryResults[0];
              if (retryResult && !retryResult.error) {
                recoveredFrames = retryResult.frames;
                reporter.reportWarning(`[CC4001] chunk ${chunkIndex} recovered on retry ${attempt}: ${result.error}`);
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
            reporter.reportWarning(
              `[CC4001] chunk ${chunkIndex} failed: ${result.error} — placeholder frames substituted for ${entry.chunk.frames.length} frame(s)`,
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
        lastEmittedChunk = chunkIndex;
      }
    }

    await workerManager.terminate();

    if (lastEmittedChunk !== chunks.length - 1 && !cancelled) {
      throw new Error(`Render incomplete: last encoded chunk ${lastEmittedChunk} of ${chunks.length - 1}`);
    }

    if (cancelled) {
      await cleanup();
      throw new Error("Render cancelled");
    }

    // Close the frame queue — drains all remaining frames, then closes ffmpeg's
    // stdin so it flushes and finalizes the temp MP4. Without this the muxer
    // reads an unterminated file and the render never completes.
    await frameQueue.close();
    await registry.runHook("afterEncode", {
      composition: processedComposition,
      outputPath,
      durationMs: Date.now() - encodeStarted,
      fileSize: await stat(tempVideoPath).then((info) => info.size).catch(() => 0),
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
        throw new Error(twoPassResult.error ?? "Two-pass encoding failed");
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

    const audioPrepare = {
      cache: mediaCache,
      sampleRate,
      channels,
      duration,
      stemCacheDir: cacheDir,
    };

    const silentMix = () => ({
      buffer: {
        sampleRate,
        channels,
        length: Math.round(duration * sampleRate),
        data: new Float32Array(Math.round(duration * sampleRate) * channels),
      },
      peakLevel: 0,
      limiterEngaged: false,
      limiterDuration: 0,
      limiterPeak: 0,
    });

    const mixTrackCount = composition.rootTimeline.tracks.filter((track) => track.kind === "audio").length;
    await registry.runHook("beforeMix", {
      composition: processedComposition,
      trackCount: mixTrackCount,
      sampleRate,
      durationSeconds: duration,
    });
    const mixStarted = Date.now();

    const audioOutcome = await withRecovery(async () => {
      const tracks: AudioTrackState[] = [];
      for (const track of composition.rootTimeline.tracks) {
        if (track.kind !== "audio") continue;
        const prepared = await prepareAudioTracks(track.clips, {
          ...audioPrepare,
          trackMuted: track.muted ?? false,
        });
        tracks.push(...prepared);
      }
      return tracks.length > 0 ? mixAudioTracks(tracks, mixerOptions) : silentMix();
    }, resolveStrategy(recovery, "audio"), recovery?.maxRetries ?? 0);

    let mixResult: ReturnType<typeof mixAudioTracks>;
    if (audioOutcome.status === "ok" || audioOutcome.status === "recovered") {
      mixResult = audioOutcome.value!;
    } else {
      const err = audioOutcome.error?.message ?? "unknown";
      reporter.reportWarning(`[CC5001] audio preparation/mixing failed: ${err} — muxing video without audio`);
      mixResult = silentMix();
    }

    await registry.runHook("afterMix", {
      composition: processedComposition,
      trackCount: mixTrackCount,
      sampleRate,
      durationSeconds: duration,
      durationMs: Date.now() - mixStarted,
      peakLevel: mixResult.peakLevel,
    });

    reporter.reportAudioDone();
    reporter.reportEncoding();
    reporter.reportCacheStats(cacheReuseFrames, Math.max(1, totalFrames));

    const muxOptions: MuxerOptions = {
      videoPath: tempVideoPath,
      audioBuffer: mixResult.buffer,
      outputPath,
      overwrite,
      audioCodec: format === "webm" ? "opus" : "aac",
      audioChannels: channels,
      channelLayout: ffmpegLayoutForChannelCount(channels),
      containerFormat: format === "webm" ? "webm" : format === "prores" ? "mov" : "mp4",
    };

    reporter.reportMuxing();
    await withAtomicOutput(outputPath, async (stagedOutput) => {
      const muxResult = await muxAudioVideo({ ...muxOptions, outputPath: stagedOutput, overwrite: true });
      if (!muxResult.success) {
        throw new Error(muxResult.error ?? "Muxing failed");
      }
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
        reporter.reportWarning("[CC8002] chapter metadata could not be embedded — the video is still valid");
      }
    }

    const outputStat = await stat(outputPath);
    const fileSize = outputStat.size;

    await rm(tempVideoPath, { force: true });

    const timeTaken = Date.now() - startTime;
    const cacheReuse = totalFrames > 0 ? (cacheReuseFrames / totalFrames) * 100 : 0;

    reporter.reportDone(outputPath, duration, fileSize, cacheReuse);

    if (!fresh && !noCache) {
      await resumeManager.clear();
    }
    await checkpointManager.clear();

    const { flushFontFallbackWarnings } = await import("../renderer/text/engine.js");
    const fallbackWarning = flushFontFallbackWarnings();
    if (fallbackWarning) reporter.reportWarning(fallbackWarning);

    if (options.generateThumbnail && (format === "mp4" || format === "webm")) {
      const config = options.generateThumbnail === true ? {} : options.generateThumbnail;
      const { generateThumbnail } = await import("../encoder/thumbnail/index.js");
      const thumbPath = config.outputPath ?? outputPath.replace(/\.[a-z0-9]+$/i, ".thumb.png");
      await generateThumbnail(processedComposition, thumbPath, { formats: config.formats ?? ["png"], seed })
        .catch((error: unknown) => {
          reporter.reportWarning(`[CC8003] thumbnail generation failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    }

    await registry.runHook("afterRender", { composition: processedComposition, outputPath, totalFrames, durationMs: Date.now() - startTime });
    cancellation.dispose();

    return {
      outputPath,
      duration,
      fileSize,
      timeTaken,
      cacheReuse,
    };
  } catch (error) {
    cancellation.dispose();
    await checkpointManager.flush().catch(() => undefined);
    await cleanup();
    reporter.reportError(error instanceof Error ? error : new Error(String(error)));
    await registry.runHook("onError", { error: error instanceof Error ? error : new Error(String(error)), context: "renderVideo" });
    throw error;
  }
}

export function createRenderJob(options: RenderOptions): RenderJob {
  let cancelled = false;
  const handlers = new Map<string, Set<ProgressHandler>>();

  const jobPromise = (async () => {
    return renderVideo({
      ...options,
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
      cancelled = true;
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
  computeCompositionHash,
  canonicalJsonString,
  computeDescriptorHash,
  createFrameCacheDescriptor,
  fingerprintMediaFile,
  objectPath,
  type FrameCacheDescriptor,
  type FrameCacheIndex,
  type MediaFingerprint,
  type RenderCache,
  type RenderCacheEntry,
  type RenderCacheStats,
} from "./cache.js";
export {
  collectFrameCacheGarbage,
  enforceCacheQuota,
  formatCacheGcResult,
  pruneStaleEntries,
  DEFAULT_CACHE_MAX_BYTES,
  type CacheGcOptions,
  type CacheGcResult,
} from "./cache-gc.js";
export {
  createWorkerManager,
  createChunks,
  resolveConcurrency,
  type WorkerManagerOptions,
  type FrameChunk,
  type WorkerResult,
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
export {
  GracefulDrainManager,
  type DrainOptions,
} from "./drain.js";
export {
  TenantContext,
  DEFAULT_TENANT_QUOTA,
  type TenantQuota,
} from "./tenant.js";


