import type { Composition } from "../core/types/index.js";
import type { AudioTrackState } from "../audio/types.js";
import { assertSidechainSources, prepareAudioTracks } from "../audio/prepare.js";
import { mixAudioTracks, type MixerOptions } from "../audio/mixer.js";
import { measureIntegratedLoudness } from "../audio/loudness.js";
import { measureTruePeakDb } from "../audio/limiter.js";
import { createError, ErrorCode } from "../errors/codes.js";
import { recordDegradation } from "../errors/degradations.js";
import { normalizeMediaCodec, probeMediaFile } from "../media/inspector.js";
import { withRecovery, resolveStrategy, type RecoveryPolicy } from "./recovery.js";
import type { MediaCache } from "../media/cache.js";
import type { compositionConversion } from "../core/time/index.js";
import type { PluginRegistry } from "../plugin/registry.js";
import type { ProgressReporter } from "./progress.js";

type MixOutcomeResult = ReturnType<typeof mixAudioTracks>;

export function muxError(reason: string | undefined, outputPath: string) {
  return createError(
    ErrorCode.CC4005,
    { reason: reason ?? "ffmpeg mux exited without an output" },
    { location: { file: outputPath } },
  );
}

export interface ContainerVerificationOutcome {
  readonly verified: boolean;
  readonly codec?: string;
  readonly pixelFormat?: string;
  readonly duration?: number;
  readonly frameCount?: number;
  readonly hasAudio?: boolean;
  readonly mismatches?: readonly string[];
}

export async function verifyContainerOutput(
  filePath: string,
  expected: {
    readonly codec?: string;
    readonly pixelFormat?: string;
    readonly duration: number;
    readonly fps?: number;
    readonly audio: boolean;
    readonly width?: number;
    readonly height?: number;
    readonly strict?: boolean;
  },
): Promise<ContainerVerificationOutcome> {
  const probe = await probeMediaFile(filePath);
  const mismatches: string[] = [];

  if (expected.codec && probe.videoCodec) {
    const normActual = normalizeMediaCodec(probe.videoCodec);
    const normExpected = normalizeMediaCodec(expected.codec);
    if (normActual && normExpected && normActual !== normExpected) {
      mismatches.push(`video codec mismatch: requested ${expected.codec}, got ${probe.videoCodec}`);
    }
  }

  if (expected.width !== undefined && expected.height !== undefined && (probe.width !== expected.width || probe.height !== expected.height)) {
    mismatches.push(`dimensions mismatch: requested ${expected.width}x${expected.height}, got ${probe.width}x${probe.height}`);
  }

  if (expected.audio) {
    if (!probe.hasAudio) {
      mismatches.push("audio stream missing: expected an audio stream");
    }
  } else if (probe.hasAudio) {
    mismatches.push("unexpected audio stream: output has audio when none expected");
  }

  const tolerance = Math.max(0.5, expected.duration * 0.05);
  if (Math.abs(probe.duration - expected.duration) > tolerance) {
    mismatches.push(`duration mismatch: requested ${expected.duration.toFixed(3)}s, got ${probe.duration.toFixed(3)}s`);
  }

  const outcome: ContainerVerificationOutcome = {
    verified: mismatches.length === 0,
    codec: probe.videoCodec,
    pixelFormat: probe.pixelFormat,
    duration: probe.duration,
    frameCount: probe.videoDuration && expected.fps ? Math.round(probe.videoDuration * expected.fps) : undefined,
    hasAudio: probe.hasAudio,
    mismatches,
  };

  if (mismatches.length > 0) {
    if (expected.strict) {
      throw createError(ErrorCode.CC4005, { reason: mismatches.join("; ") }, { location: { file: filePath } });
    }
    recordDegradation({
      code: ErrorCode.CC4005,
      what: "container verification mismatch",
      reason: mismatches.join("; "),
      input: filePath,
      instead: "render succeeded with container verification warnings",
    });
  }

  return outcome;
}

export async function verifyMuxedOutput(
  filePath: string,
  expected: {
    readonly audio: boolean;
    readonly nonSilent: boolean;
    readonly codec?: string;
    readonly duration: number;
    readonly outputPath: string;
    readonly width: number;
    readonly height: number;
  },
): Promise<void> {
  const probe = await probeMediaFile(filePath);
  if (!probe.videoCodec) {
    throw muxError(`muxed artifact has no video stream (${probe.streamCount} streams)`, expected.outputPath);
  }
  if (probe.width !== expected.width || probe.height !== expected.height) {
    throw muxError(
      `expected pixel dimensions ${expected.width}x${expected.height}, got ${probe.width}x${probe.height}`,
      expected.outputPath,
    );
  }
  if (expected.audio) {
    if (!probe.hasAudio) {
      throw muxError("expected an audio stream, the muxed artifact has none", expected.outputPath);
    }
    if (expected.codec && normalizeMediaCodec(probe.audioCodec) !== normalizeMediaCodec(expected.codec)) {
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

export async function processPipelineAudio(params: {
  readonly composition: Composition;
  readonly processedComposition: Composition;
  readonly totalFrames: number;
  readonly renderConversion: ReturnType<typeof compositionConversion>;
  readonly mediaCache: MediaCache;
  readonly cacheDir: string;
  readonly outputPath: string;
  readonly recovery?: RecoveryPolicy;
  readonly allowSilentAudio?: boolean;
  readonly forceAudio: boolean;
  readonly muxPlan: import("../audio/muxer.js").MuxAudioPlan | null;
  readonly registry: PluginRegistry;
  readonly reporter: ProgressReporter;
}): Promise<{
  mixResult: MixOutcomeResult;
  muxAudio: boolean;
  duration: number;
  audioStats?: { readonly integratedLufs?: number; readonly truePeakDb?: number; readonly clipped?: boolean };
}> {
  const {
    composition,
    processedComposition,
    totalFrames,
    renderConversion,
    mediaCache,
    cacheDir,
    outputPath,
    recovery,
    allowSilentAudio,
    forceAudio,
    muxPlan,
    registry,
    reporter,
  } = params;

  const audioConfig = composition.audio ?? {};
  const sampleRate = audioConfig.sampleRate ?? 48000;
  const channels = audioConfig.channels ?? 2;
  const duration = totalFrames / Math.max(1, composition.fps);
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
    if (allowSilentAudio !== true) {
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
  const muxAudio = muxPlan !== null && (!mixResult.report.silent || forceAudio);
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

  let audioStats: { readonly integratedLufs?: number; readonly truePeakDb?: number; readonly clipped?: boolean } | undefined;
  if (mixResult.buffer && mixResult.buffer.length > 0 && !mixResult.report.silent) {
    try {
      const integratedLufs = measureIntegratedLoudness(mixResult.buffer);
      const truePeakDb = measureTruePeakDb(mixResult.buffer);
      const clipped = truePeakDb > 0;
      audioStats = { integratedLufs, truePeakDb, clipped };
      if (clipped) {
        reporter.reportWarning?.("[CC5001] audio true peak exceeds 0 dBFS (clipping detected)");
        recordDegradation({
          code: ErrorCode.CC5001,
          what: "audio true peak clipping",
          reason: `true peak reached ${truePeakDb.toFixed(2)} dBFS (> 0 dBFS)`,
          input: composition.name,
          instead: "audio rendered with clipping warning",
        });
      }
    } catch {
      // ignore
    }
  }

  reporter.reportAudioDone();
  return { mixResult, muxAudio, duration, audioStats };
}
