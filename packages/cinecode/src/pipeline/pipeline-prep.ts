import type { Composition, RenderFormat } from "../core/types/index.js";
import type { VideoEncoding } from "../core/quality.js";
import { normalizeQuality, resolveVideoEncoding } from "../core/quality.js";
import {
  compositionConversion,
  resolveFrameWindow,
} from "../core/time/index.js";
import { validateComposition, compositionValidationError } from "../core/validation/index.js";
import { preflightText } from "../renderer/text/preflight.js";
import { createColorTransform, resolveColorManagementConfig, type ColorTransform } from "../renderer/color/profiles.js";
import { registerProjectFonts } from "../renderer/text/fonts.js";
import { recordDegradation } from "../errors/degradations.js";
import { createError, ErrorCode } from "../errors/codes.js";
import { outputPlanFor, resolveAudioPlan, resolveOutputPlan, STREAM_FORMATS, OUTPUT_PLANS } from "../core/output-plan.js";
import { ffmpegLayoutForChannelCount } from "../audio/channels.js";
import { planMuxAudio, type MuxAudioPlan } from "../audio/muxer.js";
import { computeCanonicalCacheIdentity, fingerprintFonts } from "./cache.js";
import { CINECODE_VERSION } from "../version.js";
import type { PluginRegistry } from "../plugin/registry.js";
import type { RenderOptions } from "./pipeline-types.js";

export interface PreparedPipeline {
  readonly plan: ReturnType<typeof outputPlanFor>;
  readonly resolvedEncoding: VideoEncoding;
  readonly format: RenderFormat;
  readonly alpha: boolean;
  readonly muxPlan: MuxAudioPlan | null;
  readonly colorManagement: ReturnType<typeof resolveColorManagementConfig>;
  readonly colorTransform: ColorTransform | null;
  readonly renderConversion: ReturnType<typeof compositionConversion>;
  readonly frameWindow: ReturnType<typeof resolveFrameWindow>;
  readonly totalFrames: number;
  readonly effectiveFromFrame: number;
  readonly effectiveToFrame: number;
  readonly compositionHash: string;
  readonly canonicalCache: ReturnType<typeof computeCanonicalCacheIdentity>;
  readonly forceAudio: boolean;
  readonly noCache: boolean;
}

export async function preparePipeline(
  options: RenderOptions,
  registry: PluginRegistry,
): Promise<PreparedPipeline> {
  const {
    composition,
    seed,
    quality,
    encoding: encodingOption,
    format: requestedFormat,
    alpha: alphaOption,
    fromFrame = 0,
    toFrame,
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

  preflightText(composition, { strictFonts: options.strictFonts });

  const plan = outputPlanFor(requestedFormat);
  const baseEncoding: VideoEncoding =
    encodingOption ??
    resolveVideoEncoding({ quality: quality ? normalizeQuality(quality) : undefined });
  const encoding: VideoEncoding = baseEncoding;
  const output = resolveOutputPlan({
    format: requestedFormat,
    alpha: alphaOption === true,
    codec: encodingOption && plan.codecs.length > 0 ? encoding.codec : undefined,
  });
  const resolvedEncoding: VideoEncoding = encodingOption
    ? encoding
    : output.codec === undefined
      ? encoding
      : { ...encoding, codec: output.codec };

  if (encodingOption?.codec && resolvedEncoding.codec && encodingOption.codec !== resolvedEncoding.codec) {
    recordDegradation({
      code: ErrorCode.CC4004,
      what: "codec substitution",
      field: "codec",
      requested: encodingOption.codec,
      actual: resolvedEncoding.codec,
      reason: `codec "${encodingOption.codec}" substituted with "${resolvedEncoding.codec}" for format "${output.format}"`,
      input: composition.name,
      instead: `encoded with "${resolvedEncoding.codec}"`,
    });
  }
  const format: RenderFormat = output.format;
  const alpha = output.alpha;
  const requestedAudioChannels = composition.audio?.channels ?? 2;
  const hasAudioTracks = composition.rootTimeline.tracks.some((track) => track.kind === "audio");
  const forceAudio = options.forceAudio === true || (options as { withAudio?: boolean }).withAudio === true;
  const audioPlan = resolveAudioPlan(format, options.audioCodec);
  if ((forceAudio || options.audioCodec !== undefined) && audioPlan === null) {
    throw createError(ErrorCode.CC1008, {
      format: requestedFormat ?? "mp4",
      supported: STREAM_FORMATS.filter((f) => OUTPUT_PLANS[f].audio !== undefined).join(", "),
      reason: `format "${requestedFormat ?? "mp4"}" does not support audio`,
    });
  }
  const muxPlan: MuxAudioPlan | null =
    audioPlan !== null && (hasAudioTracks || forceAudio)
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

  const colorManagement = resolveColorManagementConfig(options.colorManagement);
  const colorTransform = colorManagement.enabled
    ? createColorTransform(colorManagement.workingSpaceName, colorManagement.outputColorSpace)
    : null;
  const renderConversion = compositionConversion(composition);
  const frameWindow = resolveFrameWindow(composition, fromFrame, toFrame);
  const fontIdentity = await fingerprintFonts(fontResult.fonts);
  const canonicalCache = computeCanonicalCacheIdentity({
    composition,
    seed,
    encoding: resolvedEncoding,
    frameWindow: { from: frameWindow.from, to: frameWindow.to },
    tempo: composition.tempo,
    colorSpace: colorManagement.workingColorSpace,
    colorManagement: {
      enabled: colorManagement.enabled,
      working: colorManagement.workingSpaceName,
      output: colorManagement.outputColorSpace,
    },
    pixelRatio: 1,
    alpha,
    plugins: registry.getAll().map((entry) => ({
      name: entry.plugin.manifest.name,
      version: entry.plugin.manifest.version,
      options: entry.options,
    })),
    fonts: fontIdentity,
    frameworkVersion: CINECODE_VERSION,
    entryContent: options.entryContent,
  });
  if (canonicalCache.bypassCache) {
    noCache = true;
  }
  const compositionHash = canonicalCache.identityHash;
  const totalFrames = frameWindow.totalFrames;

  return {
    plan,
    resolvedEncoding,
    format,
    alpha,
    muxPlan,
    colorManagement,
    colorTransform,
    renderConversion,
    frameWindow,
    totalFrames,
    effectiveFromFrame: frameWindow.from,
    effectiveToFrame: frameWindow.to,
    compositionHash,
    canonicalCache,
    forceAudio,
    noCache,
  };
}
