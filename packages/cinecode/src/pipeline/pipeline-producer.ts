import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Composition } from "../core/types/index.js";
import { frameToSeconds, compositionConversion } from "../core/time/index.js";
import { createError, ErrorCode } from "../errors/codes.js";
import { FrameQueue } from "./frame-queue.js";
import { OrderedFrameFeed } from "./ordered-feed.js";
import { frameBytes as rawFrameBytes, getFrameTransportStats } from "./frame-format.js";
import { formatBytes, ByteBudget, type TransportBudget } from "./memory.js";
import { createMediaPrefetcher } from "../media/prefetch.js";
import { createSharedDecodeService, type SharedDecodeService } from "../media/decode-service.js";
import type { FrameChunk, FrameManager } from "./workers.js";
import { getMediaCacheForRenderer, clearRendererCaches, getRendererCacheStats } from "../renderer/engine.js";
import type { FrameSink } from "./strategy-sinks.js";
import type { EncoderResult } from "../encoder/index.js";
import type { RenderOptions, RenderResult } from "./pipeline-types.js";
import type { RenderCache } from "./cache.js";
import type { CheckpointManager } from "./checkpoint.js";
import type { PluginRegistry } from "../plugin/registry.js";
import type { ExtensionDescriptor } from "../plugin/descriptor.js";
import type { ProgressReporter, ProgressHandler } from "./progress.js";
import type { ColorTransform } from "../renderer/color/profiles.js";
import { createPipelineWorkerManager } from "./pipeline-workers-setup.js";
import { handleChunkFailure } from "./pipeline-chunk-recovery.js";
import { partitionChunksForRender } from "./pipeline-chunk-partition.js";

export interface FrameProducerContext {
  readonly composition: Composition;
  readonly processedComposition: Composition;
  readonly totalFrames: number;
  readonly effectiveFromFrame: number;
  readonly chunks: FrameChunk[];
  readonly frameBudget: ByteBudget;
  readonly transportBudget: TransportBudget;
  readonly renderCache: RenderCache;
  readonly checkpointManager: CheckpointManager;
  readonly resumedFrames: Set<number>;
  readonly compositionHash: string;
  readonly canResume: boolean;
  readonly colorTransform: ColorTransform | null;
  readonly renderConversion: ReturnType<typeof compositionConversion>;
  readonly registry: PluginRegistry;
  readonly options: RenderOptions;
  readonly tuning: { reason: string } | null;
  readonly workload: { classification: string };
  readonly resolvedConcurrency: number;
  readonly resolvedChunkSize: number;
  readonly inProcess: boolean;
  readonly extensionDescriptor: ExtensionDescriptor;
  readonly onProgress?: ProgressHandler;
  readonly silent: boolean;
  readonly warningHook: (message: string, stage: string) => void;
  readonly fireProgressHook: (frame: number) => Promise<void>;
  readonly cleanup: () => Promise<void>;
  readonly isCancelled: () => boolean;
  readonly registerPendingCallback: (p: Promise<void>) => void;
  readonly unregisterPendingCallback: (p: Promise<void>) => void;
  readonly setWorkerManagerRef: (m: FrameManager | null) => void;
  readonly setDecodeServiceRef: (s: SharedDecodeService | null) => void;
  readonly setActiveSinkRef: (s: FrameSink | null) => void;
  readonly setFinalBudgetStats: (stats: RenderResult["budgetStats"]) => void;
  readonly addCacheReuseFrames: (count: number) => void;
  readonly createReporter: () => ProgressReporter;
}

export async function executeFrameProducer(
  ctx: FrameProducerContext,
  sink: FrameSink,
  isPass2 = false,
): Promise<EncoderResult> {
  const {
    composition,
    processedComposition,
    totalFrames,
    effectiveFromFrame,
    chunks,
    frameBudget,
    transportBudget,
    renderCache,
    checkpointManager,
    resumedFrames,
    compositionHash,
    canResume,
    colorTransform,
    renderConversion,
    registry,
    options,
    tuning,
    workload,
    resolvedConcurrency,
    resolvedChunkSize,
    inProcess,
    extensionDescriptor,
    silent,
    fireProgressHook,
    cleanup,
    isCancelled,
    registerPendingCallback,
    unregisterPendingCallback,
    setWorkerManagerRef,
    setDecodeServiceRef,
    setActiveSinkRef,
    setFinalBudgetStats,
    addCacheReuseFrames,
    createReporter,
  } = ctx;

  setActiveSinkRef(sink);
  let passCompletedFrames = 0;
  let notifyBufferDrain: (() => void) | null = null;

  const triggerNotifyDrain = (): void => {
    if (notifyBufferDrain) {
      const fn = notifyBufferDrain;
      notifyBufferDrain = null;
      fn();
    }
  };

  const frameQueue = new FrameQueue(
    sink,
    frameBudget,
    rawFrameBytes(composition.width, composition.height),
    options.encoderDelayMs ?? 0,
  );
  const reporter = createReporter();
  reporter.setStage("rendering");

  if (tuning && !silent) {
    reporter.reportWarning(
      `[CC7006] ${tuning.reason} (${workload.classification}, ${resolvedConcurrency} worker(s))`,
    );
  }
  if (options.verbose === true && !silent) {
    process.stderr.write(`[CC7100] render memory budget: ${transportBudget.description}\n`);
  }
  const prefetcher = createMediaPrefetcher({
    onWarning: (message) => reporter.reportWarning(`[CC7003] ${message}`),
  });
  const decodeTempDir = join(options.cacheDir, "tmp", `decode-${randomUUID().slice(0, 8)}`);
  const decodeService = createSharedDecodeService({
    mediaCache: getMediaCacheForRenderer()!,
    composition: processedComposition,
    tempDir: decodeTempDir,
    memoryBudgetBytes: Math.max(64 * 1024 * 1024, Math.floor(transportBudget.totalBytes * 0.4)),
    diskBudgetBytes: 1024 * 1024 * 1024,
    prefetchAhead: 8,
  });
  setDecodeServiceRef(decodeService);

  const workerManager = createPipelineWorkerManager({
    inProcess,
    resolvedConcurrency,
    processedComposition,
    seed: options.seed,
    cacheDir: options.cacheDir,
    frameBudget,
    maxChunkBytes: transportBudget.chunkBytes,
    fonts: options.fonts,
    projectRoot: options.projectRoot,
    mediaDir: options.mediaDir,
    frameErrorPolicy: options.frameErrorPolicy,
    registry,
    extensionDescriptor,
    binaries: options.binaries,
    verbose: options.verbose === true,
    decodeService,
    onWarning: (msg) => reporter.reportWarning(msg),
  });

  setWorkerManagerRef(workerManager);

  const reorderBufferMaxBytes = Math.max(
    transportBudget.chunkBytes,
    Math.floor(transportBudget.totalBytes * 0.5),
  );
  const reorderBufferMaxChunks = Math.max(
    1,
    Math.floor(reorderBufferMaxBytes / transportBudget.chunkBytes),
  );
  if (options.verbose === true && !silent) {
    process.stderr.write(
      `[CC7105] streaming pipeline: reorder buffer bound ${reorderBufferMaxChunks} chunk(s) (${formatBytes(reorderBufferMaxBytes)})\n`,
    );
  }

  const { reusedByChunk, cachedGapsByChunk, chunksToRender } = await partitionChunksForRender({
    chunks,
    renderCache,
    compositionHash,
    noCache: options.noCache,
    fresh: options.fresh,
    canResume,
    resumedFrames,
  });

  const orderedFeed = new OrderedFrameFeed({
    totalFrames,
    startFrame: effectiveFromFrame,
    onFeedFrame: async ({ index, buffer, reusable }) => {
      if (isCancelled()) return;
      if (colorTransform && !reusable) {
        colorTransform.transformBuffer(
          new Uint8ClampedArray(buffer.buffer, buffer.byteOffset, buffer.byteLength),
          { layout: "rgba" },
        );
      }
      await frameQueue.enqueue({ index, buffer });
      passCompletedFrames++;
      if (isPass2) return;
      options.midiPlayer?.syncFrame(frameToSeconds(index, renderConversion));
      reporter.reportFrame(passCompletedFrames - 1);
      await fireProgressHook(passCompletedFrames);
    },
    onPartCompleted: (identity) => {
      workerManager.releaseChunk(identity);
      triggerNotifyDrain();
    },
  });

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const reused = reusedByChunk.get(chunkIndex);
    if (reused) {
      await orderedFeed.pushBatch(reused, true);
      if (!isPass2) {
        addCacheReuseFrames(reused.length);
        for (const frame of reused) checkpointManager.markFrame(frame.index);
        await checkpointManager.flushIfNeeded();
        reporter.reportChunk(chunkIndex, reused.length);
      }
    }
  }

  let renderError: Error | null = null;

  const renderPromise = (async () => {
    if (chunksToRender.length === 0) return;
    try {
      await workerManager.processChunks(
        chunksToRender.map((c) => c.chunk),
        async (result) => {
          if (isCancelled()) return;
          let settleChunk!: () => void;
          const chunkGate = new Promise<void>((resolve) => {
            settleChunk = resolve;
          });
          registerPendingCallback(chunkGate);
          try {
            if (result.failures && result.failures.length > 0) {
              reporter.reportWarning(
                `[CC4011] chunk ${result.chunkIndex}: ${result.failures.length} frame(s) failed; policy "${options.frameErrorPolicy ?? "placeholder"}" applied`,
              );
            }
            if (result.aborted) {
              throw createError(ErrorCode.CC4003, {
                details: `${result.error ?? "frame rendering aborted"}${result.diagnostics ? `\n${result.diagnostics}` : ""}`,
              });
            }

            const framesToEncode = await handleChunkFailure({
              result,
              chunksToRender,
              workerManager,
              recovery: options.recovery,
              processedComposition,
              reporter,
            });

            for (const frame of framesToEncode) {
              await registry.runHook("afterFrame", {
                composition: processedComposition,
                frame: frame.index,
                frameNumber: frame.index,
                totalFrames,
                timestamp: frameToSeconds(frame.index, renderConversion),
              });
            }

            const cachedGaps = cachedGapsByChunk.get(result.chunkIndex);
            let orderedFrames = framesToEncode;
            if (cachedGaps) {
              const renderedByIndex = new Map(framesToEncode.map((frame) => [frame.index, frame.buffer]));
              const targetChunk = chunksToRender.find((c) => c.chunkIndex === result.chunkIndex)?.chunk;
              const framesList = targetChunk ? targetChunk.frames : framesToEncode.map((f) => f.index);
              orderedFrames = framesList.map((index) => {
                const cached = cachedGaps.get(index);
                if (cached) return { index, buffer: cached };
                const rendered = renderedByIndex.get(index);
                if (!rendered) throw new Error(`Resume render returned no frame ${index}`);
                return { index, buffer: rendered };
              });
            }

            orderedFeed.registerPart(result.identity, orderedFrames.length);
            if (!options.noCache && !isCancelled()) {
              await renderCache.setChunk(compositionHash, result.chunkIndex, orderedFrames);
            }
            await orderedFeed.pushBatch(orderedFrames, false, result.identity);
            for (const frame of orderedFrames) checkpointManager.markFrame(frame.index);
            await checkpointManager.flushIfNeeded();
            reporter.reportChunk(result.chunkIndex, orderedFrames.length);
          } finally {
            unregisterPendingCallback(chunkGate);
            settleChunk();
          }
        },
        async (chunk) => {
          while (!isCancelled() && !workerManager.isTerminated() && orderedFeed.bufferedCount >= reorderBufferMaxChunks * options.chunkSize) {
            await new Promise<void>((resolve) => {
              notifyBufferDrain = resolve;
            });
          }
          if (isCancelled() || workerManager.isTerminated()) return;
          for (const frame of chunk.frames) {
            await registry.runHook("beforeFrame", {
              composition: processedComposition,
              frame,
              frameNumber: frame,
              totalFrames,
              timestamp: frameToSeconds(frame, renderConversion),
            });
          }
          const currentIndex = chunks.findIndex((c) => c.startFrame === chunk.startFrame);
          if (currentIndex >= 0) {
            const prefetchFrames = chunks
              .slice(currentIndex + 1, currentIndex + 1 + resolvedConcurrency * 2)
              .flatMap((c) => c.frames);
            if (prefetchFrames.length > 0) {
              prefetcher.prefetchAhead(processedComposition, prefetchFrames);
            }
          }
        },
      );
    } catch (err) {
      renderError = err instanceof Error ? err : new Error(String(err));
      reporter.reportDegradation(
        renderError?.message ?? String(err),
        {
          code: ErrorCode.CC4009,
          what: "worker-encode failure swallowed in background render loop",
          input: processedComposition.name,
          instead: "the render continues with the next chunk if possible",
        },
      );
    }
  })();

  if (!isCancelled()) {
    await renderPromise;
    if (renderError) throw renderError;
    orderedFeed.finish();
  }

  const peakBytes = frameBudget.peakBytes;
  const waitCount = frameBudget.waitCount;
  const waitDurationMs = frameBudget.waitDurationMs;
  const limitBytes = frameBudget.limitBytes;
  setFinalBudgetStats({ limitBytes, peakBytes, waitCount, waitDurationMs });
  const startup = workerManager.getStartupMeasurement();
  const throughput = workerManager.getThroughput();
  await workerManager.terminate();
  await decodeService.dispose();
  clearRendererCaches();
  if (options.verbose === true && !silent) {
    const decodeStats = decodeService.getStats();
    process.stderr.write(
      `[CC7104] shared decode: ${decodeStats.decodeCount} decodes (${decodeStats.framesDecoded} frames), ${decodeStats.memoryHits} mem hits, ${decodeStats.diskHits} disk hits, ${decodeStats.spillCount} spills, ${decodeStats.evictionCount} evictions\n`,
    );
    process.stderr.write(
      `[CC7103] pool: ${inProcess ? "in-process (no workers)" : `${startup.workers} worker(s)`}, chunk ${resolvedChunkSize}, ${startup.startupMs}ms startup, ${throughput.fps.toFixed(1)} frames/s\n`,
    );
    const transport = getFrameTransportStats();
    process.stderr.write(
      `[CC7101] frame transport: ${transport.framesProduced} produced, ${transport.framesTransferred} transferred, ${transport.pixelCopies} pixel copies, budget peak ${formatBytes(peakBytes)} (${waitCount} wait(s), ${waitDurationMs}ms wait time)\n`,
    );
    const caches = getRendererCacheStats();
    const cacheBytes = caches.reduce((total, cache) => total + cache.bytes, 0);
    process.stderr.write(
      `[CC7102] renderer caches: ${caches.length} bounded cache(s), ${formatBytes(cacheBytes)} retained, ${caches.reduce((total, cache) => total + cache.evictions, 0)} eviction(s)\n`,
    );
  }
  frameBudget.reset();

  if (passCompletedFrames !== totalFrames && !isCancelled()) {
    throw createError(ErrorCode.CC4010, {
      frame: passCompletedFrames,
      reason: `Encoded frame count (${passCompletedFrames}) does not match expected window (${totalFrames})`,
    });
  }

  if (isCancelled()) {
    await cleanup();
    throw createError(ErrorCode.CC4003);
  }

  return frameQueue.close();
}
