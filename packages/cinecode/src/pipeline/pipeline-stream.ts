import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Composition } from "../core/types/index.js";
import type { VideoEncoding } from "../core/quality.js";
import { createVideoEncoderWithEncoding, type VideoEncoder } from "../encoder/index.js";
import { createError, ErrorCode } from "../errors/codes.js";
import type { FrameSink } from "./strategy-sinks.js";
import type { ProgressReporter } from "./progress.js";
import type { RenderOptions, RenderResult } from "./pipeline-types.js";
import { executeTwoPassEncoding } from "./pipeline-two-pass.js";
import { processPipelineAudio, verifyContainerOutput } from "./pipeline-audio.js";
import { stageAndMuxOutput, processChaptersAndThumbnail } from "./pipeline-post.js";
import type { PluginRegistry } from "../plugin/registry.js";
import type { MediaCache } from "../media/cache.js";
import type { RenderCache } from "./cache.js";
import type { CheckpointManager } from "./checkpoint.js";
import { collectFrameCacheGarbage, formatCacheGcResult } from "./cache-gc.js";

export function createVideoSinkFactory(params: {
  readonly composition: Composition;
  readonly resolvedEncoding: VideoEncoding;
  readonly options: RenderOptions;
  readonly alpha: boolean;
  readonly cacheDir: string;
  readonly overwrite: boolean;
  readonly reporter: ProgressReporter;
  readonly processedComposition: Composition;
}): (targetPath: string, pass?: 1 | 2, passLogFile?: string) => Promise<VideoEncoder> {
  const { composition, resolvedEncoding, options, alpha, cacheDir, overwrite, reporter, processedComposition } = params;
  return async (targetPath: string, pass?: 1 | 2, passLogFile?: string): Promise<VideoEncoder> => {
    const encoder = createVideoEncoderWithEncoding({
      fps: composition.fps,
      width: composition.width,
      height: composition.height,
      outputPath: targetPath,
      tempDir: cacheDir,
      encoding: resolvedEncoding,
      format: options.format,
      alpha,
      fragmented: options.streaming === true,
      bitrateKbps: options.bitrateKbps,
      pass,
      passLogFile,
      overwrite,
    });
    try {
      await encoder.start();
    } catch (err) {
      reporter.reportDegradation(err instanceof Error ? err.message : String(err), {
        code: ErrorCode.CC4002,
        what: "encoder start failed",
        input: processedComposition.name,
        instead: "the render cannot start without a running encoder",
      });
      throw createError(ErrorCode.CC4002, { details: err instanceof Error ? err.message : String(err) });
    }
    return encoder;
  };
}

export async function executeStreamPipeline(params: {
  readonly options: RenderOptions;
  readonly processedComposition: Composition;
  readonly composition: Composition;
  readonly cacheDir: string;
  readonly outputPath: string;
  readonly tempVideoPath: string;
  readonly planExtension?: string;
  readonly twoPass: boolean;
  readonly encodeStarted: number;
  readonly totalFrames: number;
  readonly renderConversion: any;
  readonly mediaCache: MediaCache;
  readonly renderCache: RenderCache;
  readonly checkpointManager: CheckpointManager;
  readonly muxPlan: any;
  readonly format: string;
  readonly registry: PluginRegistry;
  readonly reporter: ProgressReporter;
  readonly createVideoSink: (targetPath: string, pass?: 1 | 2, passLogFile?: string) => Promise<VideoEncoder>;
  readonly runProducer: (sink: FrameSink, isPass2?: boolean) => Promise<any>;
  readonly startTime: number;
  readonly cacheReuseFrames: number;
  readonly finalBudgetStats?: RenderResult["budgetStats"];
  readonly noCache: boolean;
}): Promise<RenderResult> {
  const {
    options,
    processedComposition,
    composition,
    cacheDir,
    outputPath,
    tempVideoPath,
    planExtension,
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
  } = params;

  const passLogFile = twoPass ? join(cacheDir, `cinecode-pass-${randomUUID().slice(0, 8)}`) : undefined;
  await executeTwoPassEncoding({
    twoPass,
    passLogFile,
    cacheDir,
    planExtension,
    tempVideoPath,
    outputPath,
    createVideoSink,
    runFrameProducer: runProducer,
    reporter,
  });

  try {
    await registry.runHook("afterEncode", {
      composition: processedComposition,
      outputPath,
      durationMs: Date.now() - encodeStarted,
      fileSize: await stat(tempVideoPath).then((info) => info.size).catch(() => 0),
    });
  } catch (err) {
    reporter.reportDegradation(err instanceof Error ? err.message : String(err), {
      code: ErrorCode.CC4009,
      what: "afterEncode hook failure swallowed",
      input: processedComposition.name,
      instead: "the render continues without running the afterEncode hook",
    });
  }

  const { mixResult, muxAudio, duration, audioStats } = await processPipelineAudio({
    composition,
    processedComposition,
    totalFrames,
    renderConversion,
    mediaCache,
    cacheDir,
    outputPath,
    recovery: options.recovery,
    allowSilentAudio: options.allowSilentAudio,
    forceAudio: options.forceAudio === true,
    muxPlan,
    registry,
    reporter,
  });

  reporter.reportEncoding();
  reporter.reportCacheStats(cacheReuseFrames, Math.max(1, totalFrames));

  const muxOptions = muxPlan
    ? {
        videoPath: tempVideoPath,
        audioStream: mixResult.streamSource,
        audioBuffer: mixResult.buffer,
        outputPath,
        overwrite: options.overwrite,
        videoDuration: duration,
        audioCodec: muxPlan.codec,
        audioBitrateKbps: muxPlan.bitrateKbps,
        pcmBitDepth: muxPlan.bitDepth,
        audioChannels: muxPlan.channels,
        channelLayout: muxPlan.channelLayout,
        containerFormat: muxPlan.container,
      }
    : null;

  await stageAndMuxOutput({
    outputPath,
    tempVideoPath,
    muxAudio,
    muxOptions,
    duration,
    composition,
    muxPlan,
    silentMix: mixResult.report.silent,
    reporter,
  });

  await processChaptersAndThumbnail({
    composition,
    processedComposition,
    outputPath,
    cacheDir,
    duration,
    seed: options.seed,
    format,
    generateThumbnailOption: options.generateThumbnail,
    reporter,
  });

  const outputStat = await stat(outputPath);
  const fileSize = outputStat.size;
  await rm(tempVideoPath, { force: true });

  const timeTaken = Date.now() - startTime;
  const cacheReuse = totalFrames > 0 ? (cacheReuseFrames / totalFrames) * 100 : 0;
  reporter.reportDone(outputPath, duration, fileSize, cacheReuse);

  await renderCache.flushIndexes();
  if (!noCache) {
    const quota = await collectFrameCacheGarbage({ cacheDir });
    if (quota.removedObjects > 0) reporter.reportWarning(`[CC7108] ${formatCacheGcResult(quota)}`);
  }
  await checkpointManager.clear();

  let containerVerification: import("./pipeline-audio.js").ContainerVerificationOutcome | undefined;
  if (muxPlan !== null) {
    try {
      containerVerification = await verifyContainerOutput(outputPath, {
        codec: options.encoding?.codec,
        duration,
        fps: composition.fps,
        audio: muxAudio,
        width: composition.width,
        height: composition.height,
        strict: options.strict === true,
      });
    } catch (verErr) {
      if (options.strict === true) throw verErr;
    }
  }

  return {
    outputPath,
    duration,
    fileSize,
    timeTaken,
    cacheReuse,
    totalFrames,
    frames: totalFrames,
    budgetStats: finalBudgetStats,
    audioStats,
    containerVerification,
  };
}
