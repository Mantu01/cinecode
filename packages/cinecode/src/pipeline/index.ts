import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { RenderFormat } from "../core/types/index.js";
import { createRenderCache } from "./cache.js";
import { collectFrameCacheGarbage, formatCacheGcResult } from "./cache-gc.js";
import {
  createChunks,
  createChunkIdentity,
  type FrameChunk,
  type FrameManager,
} from "./workers.js";
import {
  clearRendererCaches,
  createRenderSession,
} from "../renderer/engine.js";
import { tuneConcurrency, analyzeWorkload } from "./concurrency-tuner.js";
import type { SharedDecodeService } from "../media/decode-service.js";
import { createProgressReporter, type ProgressHandler } from "./progress.js";
import { cleanupActiveTempFiles } from "../encoder/output.js";
import { createCancellationController } from "./signals.js";
import { createStrategySink, type FrameSink } from "./strategy-sinks.js";
import { createMediaCache } from "../media/cache.js";
import { canonicalJsonString } from "./cache.js";
import { createError, ErrorCode } from "../errors/codes.js";
import { getPluginRegistry } from "../plugin/registry.js";
import { createExtensionDescriptor } from "../plugin/descriptor.js";
import { resetFrameTransportStats } from "./frame-format.js";
import { ByteBudget, resolveTransportBudget } from "./memory.js";
import type { RenderOptions, RenderResult, RenderJob } from "./pipeline-types.js";
import { executeFrameProducer } from "./pipeline-producer.js";
import { preparePipeline } from "./pipeline-prep.js";
import { preprocessCompositionMedia, setupCheckpointResume } from "./pipeline-preprocess.js";
import { createVideoSinkFactory, executeStreamPipeline } from "./pipeline-stream.js";

import { createRenderJob as createPipelineJob } from "./pipeline-job.js";

export * from "./pipeline-types.js";
export * from "./pipeline-exports.js";
export { FrameQueue } from "./frame-queue.js";
export { muxError } from "./pipeline-audio.js";

const DEFAULT_CHUNK_SIZE = 32;

export async function renderVideo(options: RenderOptions): Promise<RenderResult> {
  resetFrameTransportStats();
  const startTime = Date.now();
  const {
    composition,
    outputPath,
    cacheDir,
    seed,
    chunkSize = DEFAULT_CHUNK_SIZE,
    overwrite,
    fresh,
    fromFrame = 0,
    toFrame,
    onProgress,
    silent = false,
    recovery,
    memoryBudgetMb,
  } = options;

  const registry = getPluginRegistry();
  const extensionDescriptor = createExtensionDescriptor(registry);
  const prep = await preparePipeline(options, registry);
  const {
    plan,
    resolvedEncoding,
    format,
    alpha,
    muxPlan,
    colorTransform,
    renderConversion,
    totalFrames,
    effectiveFromFrame,
    compositionHash,
    canonicalCache,
  } = prep;
  let noCache = prep.noCache;

  const warningHook = (message: string, stage: string): void => {
    void registry.runHook("onWarning", { message, stage });
  };
  let reporter = createProgressReporter({ totalFrames: 0, onProgress, silent, onWarning: warningHook });

  const renderCache = createRenderCache(cacheDir);
  const mediaCache = createMediaCache(join(cacheDir, "media"));
  await Promise.all([renderCache.initialize(), mediaCache.initialize()]);

  const { setMediaCacheForRenderer } = await import("../renderer/engine.js");
  setMediaCacheForRenderer(mediaCache);

  if (options.verbose === true && !silent) {
    process.stderr.write(`[CC7106] cache identity ${compositionHash} (cache format ${canonicalCache.cacheFormat}, cinecode ${canonicalCache.frameworkVersion})\n`);
    process.stderr.write(`[CC7107] cache identity inputs: ${canonicalJsonString(canonicalCache.identityInputs)}\n`);
  }

  reporter = createProgressReporter({ totalFrames, onProgress, silent, onWarning: warningHook });
  reporter.reportStart();

  const { checkpointManager, resumedFrames } = await setupCheckpointResume({
    cacheDir,
    compositionId: composition.name,
    compositionHash,
    totalFrames,
    fromFrame,
    toFrame,
    checkpointInterval: options.checkpointInterval,
    resume: options.resume,
    fresh,
    silent,
    reporter,
  });

  reporter.setStage("preparing");
  clearRendererCaches();
  const renderSession = createRenderSession();
  const processedComposition = await preprocessCompositionMedia(composition, cacheDir, options.burnSubtitles);

  const canResume = !fresh && !noCache && resumedFrames.size > 0;
  if (canResume) reporter.setStage("rendering");

  const baseConcurrency = options.concurrency === "auto" ? 1 : options.concurrency;
  const workload = analyzeWorkload(processedComposition);
  const tuning = options.concurrency === "auto" ? tuneConcurrency(workload, { cpuCount: baseConcurrency }) : null;
  const tunedConcurrency = tuning?.concurrency ?? baseConcurrency;

  const transportBudget = resolveTransportBudget({
    width: composition.width,
    height: composition.height,
    frameCount: totalFrames,
    concurrency: tunedConcurrency,
    chunkSize,
    maxBytes: memoryBudgetMb === undefined ? undefined : memoryBudgetMb * 1024 * 1024,
  });
  const frameBudget = new ByteBudget(transportBudget.totalBytes);
  const resolvedConcurrency = transportBudget.plan.workerCount;
  const resolvedChunkSize = transportBudget.plan.chunkSize;
  const inProcess = transportBudget.plan.inProcess;

  const baseChunks = createChunks(totalFrames, resolvedChunkSize);
  const chunks: FrameChunk[] = baseChunks.map((chunk) => ({
    ...chunk,
    startFrame: chunk.startFrame + effectiveFromFrame,
    endFrame: chunk.endFrame + effectiveFromFrame,
    frames: chunk.frames.map((f) => f + effectiveFromFrame),
    identity: createChunkIdentity(chunk.identity.chunkIndex, chunk.identity.partIndex, chunk.startFrame + effectiveFromFrame, chunk.endFrame + effectiveFromFrame),
  }));

  let cacheReuseFrames = 0;
  const pendingChunkCallbacks = new Set<Promise<void>>();
  let cancelled = false;
  let finalBudgetStats: RenderResult["budgetStats"] = undefined;

  const tempExtension = ".tmp" + (plan.extension || "." + format);
  const tempVideoPath = outputPath + tempExtension;
  const twoPass = options.twoPass === true;

  await registry.runHook("onResolutionChange", { width: processedComposition.width, height: processedComposition.height, fps: processedComposition.fps });
  await registry.runHook("beforeRender", { composition: processedComposition, totalFrames });

  let lastProgressHookFrame = -1;
  const fireProgressHook = async (frame: number): Promise<void> => {
    if (frame - lastProgressHookFrame < 30 && frame < totalFrames) return;
    lastProgressHookFrame = frame;
    await registry.runHook("onProgress", { currentFrame: frame, totalFrames, elapsedMs: Date.now() - startTime, etaMs: undefined });
  };

  let activeSinkRef: FrameSink | null = null;
  const cleanup = async () => {
    await activeSinkRef?.cancel?.().catch(() => undefined);
    await Promise.all([rm(tempVideoPath, { force: true }), rm(outputPath + ".partial", { force: true })]).catch(() => undefined);
  };

  let workerManagerRef: FrameManager | null = null;
  let decodeServiceRef: SharedDecodeService | null = null;
  let aborting: Promise<void> | null = null;

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
      await Promise.allSettled([...pendingChunkCallbacks]);
      await renderCache.flushIndexes();
      await checkpointManager.flush().catch(() => undefined);
      await cleanupActiveTempFiles();
      await registry.runHook("onError", { error: createError(ErrorCode.CC4003), context: "cancelled" }).catch(() => undefined);
    })();
    return aborting;
  };

  const onAbortSignal = (): void => { void abort(); };
  options.signal?.addEventListener("abort", onAbortSignal, { once: true });
  if (options.signal?.aborted === true) {
    await abort();
    throw createError(ErrorCode.CC4003);
  }

  const cancellation = createCancellationController({
    onCancel: async (sig) => {
      await abort();
      if (!silent) process.stderr.write(`[CC4005] received ${sig}: checkpoint persisted and temporary files removed\n`);
    },
  });
  cancellation.install();

  try {
    await registry.runHook("beforeEncode", { composition: processedComposition, outputPath, format: (options.format ?? format) as RenderFormat, totalFrames, encoderArgs: [] });
  } catch (err) {
    reporter.reportDegradation(err instanceof Error ? err.message : String(err), {
      code: ErrorCode.CC4009,
      what: "encoder-hook failure swallowed before encode",
      input: processedComposition.name,
      instead: "the render continues without running the before-encode hook",
    });
  }
  const encodeStarted = Date.now();

  const createVideoSink = createVideoSinkFactory({
    composition,
    resolvedEncoding,
    options,
    alpha,
    cacheDir,
    overwrite,
    reporter,
    processedComposition,
  });

  const runProducer = async (sink: FrameSink, isPass2 = false) => {
    return executeFrameProducer(
      {
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
        onProgress,
        silent,
        warningHook,
        fireProgressHook,
        cleanup,
        isCancelled: () => cancelled,
        registerPendingCallback: (p) => pendingChunkCallbacks.add(p),
        unregisterPendingCallback: (p) => pendingChunkCallbacks.delete(p),
        setWorkerManagerRef: (m) => { workerManagerRef = m; },
        setDecodeServiceRef: (s) => { decodeServiceRef = s; },
        setActiveSinkRef: (s) => { activeSinkRef = s; },
        setFinalBudgetStats: (s) => { finalBudgetStats = s; },
        addCacheReuseFrames: (c) => { cacheReuseFrames += c; },
        createReporter: () => createProgressReporter({ totalFrames, onProgress, silent, onWarning: warningHook }),
      },
      sink,
      isPass2,
    );
  };

  try {
    if (plan.strategy !== "stream") {
      const strategySink = createStrategySink({
        plan,
        format: (options.format ?? format) as RenderFormat,
        outputPath,
        composition: processedComposition,
        overwrite,
        gifQuality: options.gifQuality,
        gifDither: options.gifDither,
        gifMaxFrames: options.gifMaxFrames,
      });
      if (!strategySink) throw createError(ErrorCode.CC4002, { details: `Unsupported strategy ${plan.strategy}` });
      const sinkResult = await runProducer(strategySink);
      reporter.setStage("encoding");
      if (!sinkResult.success) throw createError(ErrorCode.CC4002, { details: sinkResult.error ?? "Encoding failed" });
      const outputDuration = totalFrames / Math.max(1, composition.fps);
      const resultTimeTaken = Date.now() - startTime;
      const cacheReuse = totalFrames > 0 ? (cacheReuseFrames / totalFrames) * 100 : 0;
      reporter.reportDone(outputPath, outputDuration, sinkResult.fileSize, cacheReuse);
      await renderCache.flushIndexes();
      if (!noCache) {
        const quota = await collectFrameCacheGarbage({ cacheDir });
        if (quota.removedObjects > 0) reporter.reportWarning(`[CC7108] ${formatCacheGcResult(quota)}`);
      }
      await checkpointManager.clear();
      await registry.runHook("afterRender", { composition: processedComposition, outputPath, totalFrames, durationMs: resultTimeTaken });
      renderSession.dispose();
      cancellation.dispose();
      options.signal?.removeEventListener("abort", onAbortSignal);
      return {
        outputPath,
        duration: outputDuration,
        fileSize: sinkResult.fileSize,
        timeTaken: resultTimeTaken,
        cacheReuse,
        totalFrames,
        frames: totalFrames,
        pages: plan.strategy === "document" ? totalFrames : undefined,
        budgetStats: finalBudgetStats,
      };
    }

    const streamResult = await executeStreamPipeline({
      options,
      processedComposition,
      composition,
      cacheDir,
      outputPath,
      tempVideoPath,
      planExtension: plan.extension,
      twoPass,
      encodeStarted,
      totalFrames,
      renderConversion,
      mediaCache,
      renderCache,
      checkpointManager,
      muxPlan,
      format,
      registry,
      reporter,
      createVideoSink,
      runProducer,
      startTime,
      cacheReuseFrames,
      finalBudgetStats,
      noCache,
    });

    await registry.runHook("afterRender", { composition: processedComposition, outputPath, totalFrames, durationMs: Date.now() - startTime });
    renderSession.dispose();
    cancellation.dispose();
    options.signal?.removeEventListener("abort", onAbortSignal);

    return streamResult;
  } catch (error) {
    renderSession.dispose();
    if (aborting) await aborting;
    await Promise.allSettled([...pendingChunkCallbacks]);
    await renderCache.flushIndexes().catch(() => undefined);
    const activeWorkers = workerManagerRef as FrameManager | null;
    if (activeWorkers) await activeWorkers.terminate().catch(() => undefined);
    const activeDecode = decodeServiceRef as SharedDecodeService | null;
    if (activeDecode) await activeDecode.dispose().catch(() => undefined);
    cancellation.dispose();
    options.signal?.removeEventListener("abort", onAbortSignal);
    await checkpointManager.flush().catch(() => undefined);
    await cleanup().catch((err) => {
      reporter.reportDegradation(err instanceof Error ? err.message : String(err), {
        code: ErrorCode.CC4009,
        what: "render cleanup failure swallowed",
        input: processedComposition.name,
        instead: "the render failed before cleanup fully completed",
      });
    });
    reporter.reportError(error instanceof Error ? error : new Error(String(error)));
    await registry.runHook("onError", { error: error instanceof Error ? error : new Error(String(error)), context: "renderVideo" });
    throw error;
  }
}

export function createRenderJob(options: RenderOptions): RenderJob {
  return createPipelineJob(options, renderVideo);
}
