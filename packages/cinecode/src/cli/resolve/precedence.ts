import { resolve } from "node:path";
import type {
  HardwareAcceleration,
  QualitySetting,
  RenderFormat,
  VideoCodec,
} from "../../core/types/index.js";
import { normalizeQuality } from "../../core/quality.js";
import { getPreset, listPresetIds, validatePreset, type FullPlatformPreset } from "../../encoder/platform-presets.js";
import { outputPlanFor } from "../../core/output-plan.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { recordDegradation } from "../../errors/degradations.js";
import { parseTimeArgument, parseFrameOrTimeArgument, OUTPUT_SUBDIRS } from "../shared/shared.js";
import { durationToFrames, createConversion } from "../../core/time/index.js";
import { parseMemoryBudgetMb } from "../parse/option-parser.js";
import { createResourcePlan } from "../../pipeline/resource-planner.js";
import type {
  ColorManagementInput,
  ExplainReport,
  PrecedenceOptions,
  ResolvedFrameWindow,
  ResolvedRenderParameters,
} from "./precedence-types.js";
import { validatePrecedenceConflicts } from "./precedence-validate.js";
import { field, resolveAuxiliaryParameters } from "./precedence-aux.js";

function normalizeConcurrency(value: number | "auto"): number | "auto" {
  if (value === "auto") return value;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw createError(ErrorCode.CC1012, { reason: `Invalid concurrency: ${String(value)}` });
  }
  return Math.floor(parsed);
}

function parseResolutionPair(input: string): { width: number; height: number } {
  const match = input.match(/^(\d+)x(\d+)$/i);
  if (!match) throw createError(ErrorCode.CC1012, { reason: `Invalid resolution format: ${input}. Use WIDTHxHEIGHT (e.g. 1920x1080)` });
  return { width: parseInt(match[1]!, 10), height: parseInt(match[2]!, 10) };
}

export function resolveRenderParameters(options: PrecedenceOptions): {
  parameters: ResolvedRenderParameters;
  explain: ExplainReport;
  preset?: FullPlatformPreset;
} {
  const flags = options.flags ?? {};
  const sel = options.selection;
  const project = options.project;
  const config = project?.config;
  const explicit = options.explicit ?? new Set<string>();
  const isStill = options.kind === "still";

  let preset: FullPlatformPreset | undefined;
  if (flags.preset) {
    preset = getPreset(flags.preset) ?? undefined;
    if (!preset) {
      throw createError(ErrorCode.CC1011, { name: flags.preset, available: listPresetIds().join(", ") });
    }
  } else if (sel && "preset" in sel && sel.preset && typeof sel.preset === "string") {
    preset = getPreset(sel.preset) ?? undefined;
  }
  if (preset) validatePreset(preset.id);
  const presetSource = preset ? `preset '${preset.id}'` : "preset";

  // 1. Format
  const flagFormat = flags.format !== undefined ? { value: flags.format, source: "--format" } : undefined;
  const selFormat = sel?.format !== undefined ? { value: sel.format, source: "selection" } : undefined;
  const presetFormat = preset?.format ? { value: preset.format as RenderFormat, source: presetSource } : undefined;
  // A still is an image; render.format describes the video output and never applies here.
  const cfgFormat = !isStill && explicit.has("render.format") && config?.render?.format !== undefined
    ? { value: config.render.format, key: "render.format" }
    : undefined;
  const defaultFormat: RenderFormat = isStill ? "png" : "mp4";
  const format = field(flagFormat, selFormat, presetFormat, cfgFormat, defaultFormat);

  const formatPlan = outputPlanFor(format.value);

  // 2. Codec
  const flagCodec = flags.codec !== undefined ? { value: flags.codec, source: "--codec" } : undefined;
  const selCodec = sel?.codec !== undefined ? { value: sel.codec, source: "selection" } : undefined;
  const presetCodec = preset?.video?.codec ? { value: preset.video.codec as VideoCodec, source: presetSource } : undefined;
  // A project-wide codec never overrides the resolved format's codec list.
  const cfgCodec =
    explicit.has("render.codec") &&
    config?.render?.codec !== undefined &&
    formatPlan.codecs.includes(config.render.codec)
      ? { value: config.render.codec, key: "render.codec" }
      : undefined;
  const defaultCodec: VideoCodec = (formatPlan.codecs[0] as VideoCodec) ?? "h264";
  const codec = field(flagCodec, selCodec, presetCodec, cfgCodec, defaultCodec);

  // 3. Resolution
  let flagW: { value: number; source: string } | undefined;
  let flagH: { value: number; source: string } | undefined;
  if (flags.resolution) {
    const pair = parseResolutionPair(flags.resolution);
    flagW = { value: pair.width, source: "--resolution" };
    flagH = { value: pair.height, source: "--resolution" };
  } else {
    if (flags.width !== undefined) flagW = { value: flags.width, source: "--width" };
    if (flags.height !== undefined) flagH = { value: flags.height, source: "--height" };
  }
  const selW = sel?.width !== undefined ? { value: sel.width, source: "selection" } : undefined;
  const selH = sel?.height !== undefined ? { value: sel.height, source: "selection" } : undefined;
  const presetW = preset?.width !== undefined ? { value: preset.width, source: presetSource } : undefined;
  const presetH = preset?.height !== undefined ? { value: preset.height, source: presetSource } : undefined;
  const cfgW = explicit.has("video.width") && config?.video?.width !== undefined
    ? { value: config.video.width, key: "video.width" }
    : undefined;
  const cfgH = explicit.has("video.height") && config?.video?.height !== undefined
    ? { value: config.video.height, key: "video.height" }
    : undefined;
  const width = field(flagW, selW, presetW, cfgW, 1920);
  const height = field(flagH, selH, presetH, cfgH, 1080);

  // 4. Framerate
  const flagFps = flags.fps !== undefined ? { value: flags.fps, source: "--fps" } : undefined;
  const selFps = sel?.fps !== undefined ? { value: sel.fps, source: "selection" } : undefined;
  const presetFps = preset?.fps !== undefined ? { value: preset.fps, source: presetSource } : undefined;
  const cfgFps = explicit.has("video.fps") && config?.video?.fps !== undefined
    ? { value: config.video.fps, key: "video.fps" }
    : undefined;
  const fps = field(flagFps, selFps, presetFps, cfgFps, 30);

  // 5. Quality
  const flagQuality = flags.quality !== undefined ? { value: flags.quality, source: "--quality" } : undefined;
  const selQuality = sel?.quality !== undefined ? { value: sel.quality, source: "selection" } : undefined;
  const cfgQuality = explicit.has("render.quality") && config?.render?.quality !== undefined
    ? { value: config.render.quality, key: "render.quality" }
    : undefined;
  const defaultQuality: QualitySetting = flags.preview ? "preview" : "medium";
  const quality = field(flagQuality, selQuality, cfgQuality, defaultQuality);

  // 6. CRF
  const flagCrf = flags.crf !== undefined ? { value: flags.crf, source: "--crf" } : undefined;
  const presetCrf = preset?.video?.crf !== undefined ? { value: preset.video.crf, source: presetSource } : undefined;
  const cfgCrf = explicit.has("render.crf") && config?.render?.crf !== undefined
    ? { value: config.render.crf, key: "render.crf" }
    : undefined;
  const defaultCrf = 23;
  const crf = field(flagCrf, undefined, presetCrf, cfgCrf, defaultCrf);

  // 7. Bitrate
  const flagBitrate = flags.bitrate !== undefined ? { value: String(flags.bitrate), source: "--bitrate" } : undefined;
  const cfgBitrate = explicit.has("render.bitrate") && config?.render?.bitrate !== undefined
    ? { value: String(config.render.bitrate), key: "render.bitrate" }
    : undefined;
  const bitrate = field(flagBitrate, undefined, cfgBitrate, undefined as string | undefined);

  // 8. Concurrency
  const flagConc = flags.concurrency !== undefined
    ? { value: normalizeConcurrency(flags.concurrency as number | "auto"), source: "--concurrency" }
    : undefined;
  const cfgConc = explicit.has("render.concurrency") && config?.render?.concurrency !== undefined
    ? { value: config.render.concurrency, key: "render.concurrency" }
    : undefined;
  const concurrency = field(flagConc, undefined, cfgConc, "auto" as number | "auto");

  // 9. Chunk Size
  const flagChunk = flags.chunkSize !== undefined ? { value: flags.chunkSize, source: "--chunk-size" } : undefined;
  const cfgChunk = explicit.has("render.chunkSize") && config?.render?.chunkSize !== undefined
    ? { value: config.render.chunkSize, key: "render.chunkSize" }
    : undefined;
  const chunkSize = field(flagChunk, undefined, cfgChunk, 30);

  // 10. Hardware Acceleration
  const flagHw = flags.hardwareAcceleration !== undefined ? { value: flags.hardwareAcceleration, source: "--hardware-acceleration" } : undefined;
  const cfgHw = explicit.has("render.hardwareAcceleration") && config?.render?.hardwareAcceleration !== undefined
    ? { value: config.render.hardwareAcceleration, key: "render.hardwareAcceleration" }
    : undefined;
  const hardwareAcceleration = field(flagHw, undefined, cfgHw, "auto" as HardwareAcceleration);

  // 11. Memory Budget
  let parsedFlagBudget: number | undefined;
  if (flags.memoryBudget !== undefined) {
    if (typeof flags.memoryBudget === "number") {
      parsedFlagBudget = flags.memoryBudget;
    } else {
      const mb = parseMemoryBudgetMb(flags.memoryBudget);
      if (mb !== undefined) parsedFlagBudget = mb;
    }
  }
  const flagMem = parsedFlagBudget !== undefined ? { value: parsedFlagBudget, source: "--memory-budget" } : undefined;
  let parsedCfgBudget: number | undefined;
  if (explicit.has("render.memoryBudget") && config?.render?.memoryBudget !== undefined) {
    if (typeof config.render.memoryBudget === "number") {
      parsedCfgBudget = config.render.memoryBudget;
    } else {
      const mb = parseMemoryBudgetMb(config.render.memoryBudget);
      if (mb !== undefined) parsedCfgBudget = mb;
    }
  }
  const cfgMem = parsedCfgBudget !== undefined
    ? { value: parsedCfgBudget, key: "render.memoryBudget" }
    : undefined;
  const memoryBudgetMb = field(flagMem, undefined, cfgMem, undefined as number | undefined);

  // Alpha
  const flagAlpha = flags.alpha !== undefined ? { value: flags.alpha, source: "--alpha" } : undefined;
  const cfgAlpha = explicit.has("render.alpha") && config?.render?.alpha !== undefined
    ? { value: config.render.alpha, key: "render.alpha" }
    : undefined;
  const defaultAlpha = formatPlan.alpha;
  const alpha = field(flagAlpha, undefined, cfgAlpha, defaultAlpha);

  // Color Management
  const flagColor = flags.colorManagement !== undefined ? { value: flags.colorManagement, source: "--color" } : undefined;
  const cfgColor = explicit.has("render.colorManagement") && config?.render?.colorManagement !== undefined
    ? { value: config.render.colorManagement, key: "render.colorManagement" }
    : undefined;
  const colorManagement = field(flagColor, undefined, cfgColor, "srgb" as ColorManagementInput);

  // Two-Pass
  const flagTwoPass = flags.twoPass !== undefined ? { value: flags.twoPass, source: "--two-pass" } : undefined;
  const cfgTwoPass = explicit.has("render.twoPass") && config?.render?.twoPass !== undefined
    ? { value: config.render.twoPass, key: "render.twoPass" }
    : undefined;
  const twoPass = field(flagTwoPass, undefined, cfgTwoPass, false);

  // 12. Frame Window
  if (flags.range !== undefined && (flags.from !== undefined || flags.to !== undefined)) {
    throw createError(ErrorCode.CC0001, {
      reason: "Conflicting options: --range cannot be used together with --from or --to",
    });
  }

  const parsedFps = fps.value;
  const conv = createConversion(parsedFps);
  let computedDurationFrames = 0;
  if (sel?.duration !== undefined) {
    const rawDur = typeof sel.duration === "number" ? sel.duration : parseFloat(String(sel.duration));
    if (Number.isFinite(rawDur)) computedDurationFrames = durationToFrames(rawDur, conv);
  } else if (explicit.has("video.defaultDuration") && config?.video?.defaultDuration !== undefined) {
    const rawDur = typeof config.video.defaultDuration === "number" ? config.video.defaultDuration : parseFloat(String(config.video.defaultDuration));
    if (Number.isFinite(rawDur)) computedDurationFrames = durationToFrames(rawDur, conv);
  }

  let rangeFrom: number | undefined;
  let rangeTo: number | undefined;
  if (flags.range !== undefined) {
    const rangeStr = String(flags.range).trim();
    const parts = rangeStr.split("-");
    if (parts.length === 2 && parts[0]!.trim().length > 0 && parts[1]!.trim().length > 0) {
      rangeFrom = parseFrameOrTimeArgument(parts[0]!.trim(), parsedFps);
      rangeTo = parseFrameOrTimeArgument(parts[1]!.trim(), parsedFps);
    } else {
      throw createError(ErrorCode.CC0001, {
        reason: `Invalid --range value "${rangeStr}". Expected format "start-end" (e.g. 0-100 or 0s-5s)`,
      });
    }
  }

  const rawFrom = rangeFrom ?? flags.from;
  const startFrame = rawFrom !== undefined
    ? parseFrameOrTimeArgument(rawFrom, parsedFps)
    : 0;
  if (startFrame < 0) {
    throw createError(ErrorCode.CC0001, { reason: `Frame window start frame must be non-negative, got ${startFrame}` });
  }

  const lastCompFrame = computedDurationFrames > 0 ? computedDurationFrames - 1 : 0;
  const rawTo = rangeTo ?? flags.to;
  let endFrame: number;

  if (isStill) {
    endFrame = startFrame;
  } else if (rawTo !== undefined) {
    endFrame = parseFrameOrTimeArgument(rawTo, parsedFps);
    if (endFrame < startFrame) {
      throw createError(ErrorCode.CC0001, {
        reason: `Frame window start frame ${startFrame} cannot be greater than end frame ${endFrame}`,
      });
    }
    if (computedDurationFrames > 0 && endFrame > lastCompFrame) {
      recordDegradation({
        code: ErrorCode.CC4001,
        what: "frame window extends beyond composition duration",
        reason: `requested to=${endFrame} exceeds composition duration (last frame ${lastCompFrame})`,
        instead: `clamped to=${lastCompFrame}`,
      });
      endFrame = lastCompFrame;
    }
  } else {
    endFrame = computedDurationFrames > 0 ? lastCompFrame : startFrame;
  }

  const totalFrames = isStill ? 1 : Math.max(0, endFrame - startFrame + 1);

  const resolvedWindow: ResolvedFrameWindow = {
    from: startFrame,
    to: endFrame,
    totalFrames,
  };

  const windowSource = flags.range !== undefined
    ? "--range"
    : flags.from !== undefined && flags.to !== undefined
      ? "--from/--to"
      : flags.from !== undefined
        ? "--from"
        : flags.to !== undefined
          ? "--to"
          : undefined;

  const frameWindow = field(
    windowSource !== undefined ? { value: resolvedWindow, source: windowSource } : undefined,
    sel?.duration !== undefined ? { value: resolvedWindow, source: "selection" } : undefined,
    explicit.has("video.defaultDuration") ? { value: resolvedWindow, key: "video.defaultDuration" } : undefined,
    resolvedWindow,
  );

  // 13. Output Path
  const targetExt = isStill ? formatPlan.extension || `.${format.value}` : formatPlan.extension;
  const outName = sel?.id ?? sel?.name ?? "output";
  const previewSuffix = flags.preview || quality.value === "preview" ? ".preview" : "";
  const subFolder = isStill ? OUTPUT_SUBDIRS.images : OUTPUT_SUBDIRS.videos;
  const defaultDir = project?.roots?.output
    ?? (project?.root ? resolve(project.root, config?.outputDir ?? "output") : resolve("output"));
  const fallbackPath = resolve(defaultDir, subFolder, `${outName}${previewSuffix}${targetExt}`);

  const flagOut = flags.out !== undefined
    ? { value: resolve(project?.root ?? ".", flags.out), source: "--out" }
    : undefined;
  const outputPath = field(flagOut, undefined, undefined, fallbackPath);

  // 14. Overwrite
  const flagOverwrite = flags.overwrite !== undefined ? { value: flags.overwrite, source: "--overwrite" } : undefined;
  const cfgOverwrite = explicit.has("render.overwrite") && config?.render?.overwrite !== undefined
    ? { value: config.render.overwrite, key: "render.overwrite" }
    : undefined;
  const overwrite = field(flagOverwrite, undefined, cfgOverwrite, false);

  const aux = resolveAuxiliaryParameters(flags, config, explicit, preset, presetSource);

  const parameters: ResolvedRenderParameters = {
    width,
    height,
    fps,
    format,
    codec,
    quality,
    crf,
    bitrate,
    concurrency,
    chunkSize,
    hardwareAcceleration,
    memoryBudgetMb,
    alpha,
    colorManagement,
    twoPass,
    outputPath,
    frameWindow,
    overwrite,
    ...aux,
  };

  validatePrecedenceConflicts(parameters, preset);

  const resourcePlan = createResourcePlan({
    width: parameters.width.value,
    height: parameters.height.value,
    frameCount: resolvedWindow.totalFrames,
    concurrency: parameters.concurrency.value,
    chunkSize: parameters.chunkSize.value,
    memoryBudgetMb: parameters.memoryBudgetMb.value,
  });

  const explain: ExplainReport = {
    root: project?.root ?? "",
    configPath: project?.configPath ?? "",
    manifestPath: project?.manifestPath ?? "",
    mode: project?.mode ?? "file",
    selection: project?.selection ?? (sel?.id ? `timeline ${sel.id}` : sel?.name ? `composition ${sel.name}` : "none"),
    frameWindow: resolvedWindow,
    parameters,
    resourcePlan,
  };

  return { parameters, explain, preset };
}
