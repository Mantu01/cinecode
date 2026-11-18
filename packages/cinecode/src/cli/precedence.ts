import { join, resolve } from "node:path";
import type {
  CinecodeConfig,
  QualitySetting,
  RenderFormat,
  VideoCodec,
} from "../core/types/index.js";
import { explicitConfigPaths } from "../config/schema.js";
import { clampCrf, resolveVideoEncoding } from "../core/quality.js";
import { getPreset, validatePreset, type FullPlatformPreset } from "../encoder/platform-presets.js";
import { validateCodecContainer } from "../encoder/index.js";
import { ALPHA_FORMATS, STILL_FORMATS, outputPlanFor } from "../core/output-plan.js";
import { createError, ErrorCode } from "../errors/index.js";
import { parseTimeInput, OUTPUT_SUBDIRS, resolveOutputDir } from "./shared.js";

export type ColorManagementInput =
  | "srgb"
  | "linear"
  | {
      readonly workingColorSpace?: "srgb" | "linear-srgb" | "rec709" | "acescg";
      readonly outputColorSpace?: "srgb" | "rec709" | "display-p3" | "rec2020";
      readonly enabled?: boolean;
    };

export function normalizeColorManagement(
  input: ColorManagementInput | undefined,
): { workingColorSpace?: "srgb" | "linear-srgb" | "rec709" | "acescg"; outputColorSpace?: "srgb" | "rec709" | "display-p3" | "rec2020"; enabled?: boolean } | undefined {
  if (!input) return undefined;
  if (typeof input === "string") {
    if (input === "linear") {
      return { workingColorSpace: "linear-srgb", outputColorSpace: "srgb", enabled: true };
    }
    return { workingColorSpace: "srgb", outputColorSpace: "srgb", enabled: true };
  }
  return input;
}

export type ParameterOrigin = "flag" | "selection" | "config" | "default";

export interface ResolvedField<T> {
  readonly value: T;
  readonly origin: ParameterOrigin;
  readonly source: string;
  readonly originLabel: string;
}

export interface ResolvedFrameWindow {
  readonly from: number;
  readonly to: number;
  readonly totalFrames: number;
}

export interface ResolvedRenderParameters {
  readonly width: ResolvedField<number>;
  readonly height: ResolvedField<number>;
  readonly fps: ResolvedField<number>;
  readonly format: ResolvedField<RenderFormat>;
  readonly codec: ResolvedField<VideoCodec>;
  readonly quality: ResolvedField<QualitySetting>;
  readonly crf: ResolvedField<number>;
  readonly bitrate: ResolvedField<string | undefined>;
  readonly concurrency: ResolvedField<number | "auto">;
  readonly memoryBudgetMb: ResolvedField<number | undefined>;
  readonly alpha: ResolvedField<boolean>;
  readonly colorManagement: ResolvedField<ColorManagementInput>;
  readonly twoPass: ResolvedField<boolean>;
  readonly outputPath: ResolvedField<string>;
  readonly frameWindow: ResolvedField<ResolvedFrameWindow>;
}

export interface ExplainReport {
  readonly root: string;
  readonly configPath: string;
  readonly manifestPath: string;
  readonly mode: string;
  readonly selection: string;
  readonly frameWindow: ResolvedFrameWindow;
  readonly parameters: ResolvedRenderParameters;
}

export interface PrecedenceFlags {
  readonly width?: number;
  readonly height?: number;
  readonly resolution?: string;
  readonly fps?: number;
  readonly format?: RenderFormat;
  readonly codec?: VideoCodec;
  readonly quality?: QualitySetting;
  readonly crf?: number;
  readonly bitrate?: string;
  readonly concurrency?: number | "auto";
  readonly memoryBudgetMb?: number;
  readonly alpha?: boolean;
  readonly colorManagement?: ColorManagementInput;
  readonly twoPass?: boolean;
  readonly out?: string;
  readonly from?: string | number;
  readonly to?: string | number;
  readonly preset?: string;
  readonly preview?: boolean;
}

export interface PrecedenceSelection {
  readonly id?: string;
  readonly name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly duration?: number | string;
  readonly format?: RenderFormat;
  readonly codec?: VideoCodec;
  readonly quality?: QualitySetting;
}

export interface PrecedenceOptions {
  readonly flags?: PrecedenceFlags;
  readonly selection?: PrecedenceSelection;
  readonly project?: {
    readonly root: string;
    readonly configPath?: string;
    readonly manifestPath?: string;
    readonly mode?: string;
    readonly selection?: string;
    readonly config: CinecodeConfig;
  };
  readonly kind?: "video" | "still";
}

function parseResolutionPair(input: string): { width: number; height: number } {
  const match = input.match(/^(\d+)x(\d+)$/i);
  if (!match) throw createError(ErrorCode.CC1012, { reason: `Invalid resolution format: ${input}. Use WIDTHxHEIGHT (e.g. 1920x1080)` });
  return { width: parseInt(match[1]!, 10), height: parseInt(match[2]!, 10) };
}

function field<T>(
  flagVal: { value: T; source: string } | undefined,
  selVal: { value: T; source: string } | undefined,
  cfgVal: { value: T; key: string } | undefined,
  defVal: T,
): ResolvedField<T> {
  if (flagVal !== undefined) return { value: flagVal.value, origin: "flag", source: flagVal.source, originLabel: "flag" };
  if (selVal !== undefined) return { value: selVal.value, origin: "selection", source: selVal.source, originLabel: "selection" };
  if (cfgVal !== undefined) return { value: cfgVal.value, origin: "config", source: cfgVal.key, originLabel: cfgVal.key };
  return { value: defVal, origin: "default", source: "default", originLabel: "default" };
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
  const explicit = config ? explicitConfigPaths(config) : new Set<string>();
  const isStill = options.kind === "still";

  let preset: FullPlatformPreset | undefined;
  if (flags.preset) {
    preset = getPreset(flags.preset) ?? undefined;
    if (!preset) throw createError(ErrorCode.CC1011, { name: flags.preset });
    const containerErr = validatePreset(flags.preset);
    if (containerErr) throw createError(ErrorCode.CC1012, { reason: containerErr });
  }

  // 1 & 2. Width and Height
  let flagRes: { value: { width: number; height: number }; source: string } | undefined;
  if (flags.resolution) {
    flagRes = { value: parseResolutionPair(flags.resolution), source: "--resolution" };
  } else if (flags.width !== undefined && flags.height !== undefined) {
    flagRes = { value: { width: flags.width, height: flags.height }, source: "--width/--height" };
  } else if (preset) {
    flagRes = { value: { width: preset.width, height: preset.height }, source: `--preset ${flags.preset}` };
  }

  let selRes: { value: { width: number; height: number }; source: string } | undefined;
  if (sel?.width !== undefined && sel?.height !== undefined) {
    selRes = { value: { width: sel.width, height: sel.height }, source: "selection" };
  }

  let cfgRes: { value: { width: number; height: number }; key: string } | undefined;
  if (explicit.has("render.resolution") && config?.render?.resolution) {
    cfgRes = { value: parseResolutionPair(config.render.resolution), key: "render.resolution" };
  } else if ((explicit.has("video.width") || explicit.has("video.height")) && config?.video?.width && config?.video?.height) {
    cfgRes = { value: { width: config.video.width, height: config.video.height }, key: "video.width" };
  } else if ((explicit.has("width") || explicit.has("height")) && (config as any)?.width && (config as any)?.height) {
    cfgRes = { value: { width: (config as any).width, height: (config as any).height }, key: "width" };
  }

  const width = field(
    flagRes ? { value: flagRes.value.width, source: flagRes.source } : undefined,
    selRes ? { value: selRes.value.width, source: selRes.source } : undefined,
    cfgRes ? { value: cfgRes.value.width, key: cfgRes.key } : undefined,
    1920,
  );
  const height = field(
    flagRes ? { value: flagRes.value.height, source: flagRes.source } : undefined,
    selRes ? { value: selRes.value.height, source: selRes.source } : undefined,
    cfgRes ? { value: cfgRes.value.height, key: cfgRes.key } : undefined,
    1080,
  );

  // 3. FPS
  const flagFps = flags.fps !== undefined
    ? { value: flags.fps, source: "--fps" }
    : preset
      ? { value: preset.fps, source: `--preset ${flags.preset}` }
      : undefined;
  const selFps = sel?.fps !== undefined ? { value: sel.fps, source: "selection" } : undefined;
  let cfgFps: { value: number; key: string } | undefined;
  if (explicit.has("render.fps") && config?.render?.fps !== undefined) {
    cfgFps = { value: config.render.fps, key: "render.fps" };
  } else if (explicit.has("video.fps") && config?.video?.fps !== undefined) {
    cfgFps = { value: config.video.fps, key: "video.fps" };
  } else if (explicit.has("fps") && (config as any)?.fps !== undefined) {
    cfgFps = { value: (config as any).fps, key: "fps" };
  }
  const fps = field(flagFps, selFps, cfgFps, 30);

  // 4. Format
  const flagFmt = flags.format !== undefined
    ? { value: flags.format, source: "--format" }
    : preset
      ? { value: preset.format, source: `--preset ${flags.preset}` }
      : undefined;
  const selFmt = sel?.format !== undefined ? { value: sel.format, source: "selection" } : undefined;
  const cfgFmt = explicit.has("render.format") && config?.render?.format !== undefined
    ? { value: config.render.format, key: "render.format" }
    : undefined;
  const format = field(flagFmt, selFmt, cfgFmt, (isStill ? STILL_FORMATS[0]! : "mp4") as RenderFormat);

  // 5. Codec
  const formatPlan = outputPlanFor(format.value);
  const defaultCodec: VideoCodec = formatPlan.defaultCodec ?? "h264";

  const flagCodec = flags.codec !== undefined
    ? { value: flags.codec, source: "--codec" }
    : preset
      ? { value: preset.video.codec, source: `--preset ${flags.preset}` }
      : undefined;
  const selCodec = sel?.codec !== undefined ? { value: sel.codec, source: "selection" } : undefined;
  const cfgCodec = explicit.has("render.codec") && config?.render?.codec !== undefined
    ? { value: config.render.codec, key: "render.codec" }
    : undefined;
  const codec = field(flagCodec, selCodec, cfgCodec, defaultCodec);

  // 6. Quality & CRF
  const flagQuality = flags.quality !== undefined
    ? { value: flags.quality, source: "--quality" }
    : flags.preview
      ? { value: "preview" as QualitySetting, source: "--preview" }
      : undefined;
  const selQuality = sel?.quality !== undefined ? { value: sel.quality, source: "selection" } : undefined;
  const cfgQuality = explicit.has("render.quality") && config?.render?.quality !== undefined
    ? { value: config.render.quality, key: "render.quality" }
    : undefined;
  const quality = field(flagQuality, selQuality, cfgQuality, "final" as QualitySetting);

  const flagCrf = flags.crf !== undefined
    ? { value: clampCrf(flags.crf, codec.value), source: "--crf" }
    : preset
      ? { value: preset.video.crf, source: `--preset ${flags.preset}` }
      : undefined;
  const cfgCrf = explicit.has("render.crf") && config?.render?.crf !== undefined
    ? { value: clampCrf(config.render.crf, codec.value), key: "render.crf" }
    : undefined;
  const derivedCrf = resolveVideoEncoding({
    render: config?.render ? { ...config.render, codec: codec.value } : undefined,
    quality: quality.value,
  }).crf;
  const crf = field(flagCrf, undefined, cfgCrf, derivedCrf);

  // 7. Bitrate
  const flagBitrate = flags.bitrate !== undefined ? { value: String(flags.bitrate), source: "--bitrate" } : undefined;
  const cfgBitrate = explicit.has("render.bitrate") && config?.render?.bitrate !== undefined
    ? { value: String(config.render.bitrate), key: "render.bitrate" }
    : undefined;
  const bitrate = field(flagBitrate, undefined, cfgBitrate, undefined as string | undefined);

  // 8. Concurrency
  const flagConcurrency = flags.concurrency !== undefined ? { value: flags.concurrency, source: "--concurrency" } : undefined;
  let cfgConcurrency: { value: number | "auto"; key: string } | undefined;
  if (explicit.has("render.concurrency") && config?.render?.concurrency !== undefined) {
    cfgConcurrency = { value: config.render.concurrency, key: "render.concurrency" };
  } else if (explicit.has("concurrency") && config?.concurrency !== undefined) {
    cfgConcurrency = { value: config.concurrency, key: "concurrency" };
  }
  const concurrency = field(flagConcurrency, undefined, cfgConcurrency, "auto" as number | "auto");

  // 8b. Render memory budget
  const flagMemory = flags.memoryBudgetMb !== undefined
    ? { value: flags.memoryBudgetMb, source: "--memory-budget" }
    : undefined;
  const cfgMemory = explicit.has("render.memoryBudgetMb") && config?.render?.memoryBudgetMb !== undefined
    ? { value: config.render.memoryBudgetMb, key: "render.memoryBudgetMb" }
    : undefined;
  const memoryBudgetMb = field(flagMemory, undefined, cfgMemory, undefined as number | undefined);

  // 9. Alpha
  const flagAlpha = flags.alpha !== undefined ? { value: flags.alpha, source: "--alpha" } : undefined;
  const selAlpha = sel?.format === "webm-alpha" || sel?.format === "prores-alpha" ? { value: true, source: "selection" } : undefined;
  const cfgAlpha = explicit.has("render.alpha") && config?.render?.alpha !== undefined
    ? { value: config.render.alpha, key: "render.alpha" }
    : undefined;
  const alpha = field(flagAlpha, selAlpha, cfgAlpha, false);

  // 10. Color Management
  const flagColor = flags.colorManagement !== undefined ? { value: flags.colorManagement, source: "--color-management" } : undefined;
  const cfgColor = explicit.has("render.colorManagement") && config?.render?.colorManagement !== undefined
    ? { value: config.render.colorManagement as ColorManagementInput, key: "render.colorManagement" }
    : undefined;
  const colorManagement = field(flagColor, undefined, cfgColor, "srgb" as ColorManagementInput);

  // 11. Two-pass
  const flagTwoPass = flags.twoPass !== undefined ? { value: flags.twoPass, source: "--two-pass" } : undefined;
  const cfgTwoPass = explicit.has("render.twoPass") && config?.render?.twoPass !== undefined
    ? { value: config.render.twoPass, key: "render.twoPass" }
    : undefined;
  const twoPass = field(flagTwoPass, undefined, cfgTwoPass, false);

  // 12. Frame Window
  const parsedFps = fps.value;
  let computedDurationFrames = 0;
  if (sel?.duration !== undefined) {
    const rawDur = typeof sel.duration === "number" ? sel.duration : parseFloat(String(sel.duration));
    if (Number.isFinite(rawDur)) computedDurationFrames = Math.ceil(rawDur * parsedFps);
  } else if (explicit.has("video.defaultDuration") && config?.video?.defaultDuration !== undefined) {
    const rawDur = typeof config.video.defaultDuration === "number" ? config.video.defaultDuration : parseFloat(String(config.video.defaultDuration));
    if (Number.isFinite(rawDur)) computedDurationFrames = Math.ceil(rawDur * parsedFps);
  }

  const startFrame = flags.from !== undefined
    ? typeof flags.from === "number" ? flags.from : parseTimeInput(String(flags.from), parsedFps)
    : 0;
  const endFrame = flags.to !== undefined
    ? typeof flags.to === "number" ? flags.to : parseTimeInput(String(flags.to), parsedFps)
    : computedDurationFrames;

  const resolvedWindow: ResolvedFrameWindow = {
    from: startFrame,
    to: endFrame,
    totalFrames: Math.max(0, endFrame - startFrame),
  };

  const frameWindow = field(
    flags.from !== undefined || flags.to !== undefined
      ? { value: resolvedWindow, source: flags.from !== undefined && flags.to !== undefined ? "--from/--to" : flags.from !== undefined ? "--from" : "--to" }
      : undefined,
    sel?.duration !== undefined ? { value: resolvedWindow, source: "selection" } : undefined,
    explicit.has("video.defaultDuration") ? { value: resolvedWindow, key: "video.defaultDuration" } : undefined,
    resolvedWindow,
  );

  // 13. Output Path
  const targetExt = isStill ? formatPlan.extension || `.${format.value}` : formatPlan.extension;
  const outName = sel?.id ?? sel?.name ?? "output";
  const previewSuffix = flags.preview ? ".preview" : "";
  const subFolder = isStill ? OUTPUT_SUBDIRS.images : OUTPUT_SUBDIRS.videos;
  const defaultDir = config ? resolveOutputDir(config) : resolve("output");
  const fallbackPath = resolve(defaultDir, subFolder, `${outName}${previewSuffix}${targetExt}`);

  const flagOut = flags.out !== undefined ? { value: resolve(flags.out), source: "--out" } : undefined;
  let cfgOut: { value: string; key: string } | undefined;
  if (explicit.has("project.outputDir") && config?.project?.outputDir) {
    cfgOut = { value: resolve(project?.root ?? process.cwd(), config.project.outputDir, subFolder, `${outName}${previewSuffix}${targetExt}`), key: "project.outputDir" };
  } else if (explicit.has("outputDir") && config?.outputDir) {
    cfgOut = { value: resolve(project?.root ?? process.cwd(), config.outputDir, subFolder, `${outName}${previewSuffix}${targetExt}`), key: "outputDir" };
  }

  const outputPath = field(flagOut, undefined, cfgOut, fallbackPath);

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
    memoryBudgetMb,
    alpha,
    colorManagement,
    twoPass,
    outputPath,
    frameWindow,
  };

  validatePrecedenceConflicts(parameters, preset);

  const explain: ExplainReport = {
    root: project?.root ?? resolve(process.cwd()),
    configPath: project?.configPath ?? "",
    manifestPath: project?.manifestPath ?? "",
    mode: project?.mode ?? "file",
    selection: project?.selection ?? (sel?.id ? `timeline ${sel.id}` : sel?.name ? `composition ${sel.name}` : "none"),
    frameWindow: resolvedWindow,
    parameters,
  };

  return { parameters, explain, preset };
}

export function validatePrecedenceConflicts(params: ResolvedRenderParameters, preset?: FullPlatformPreset): void {
  // Format vs Alpha
  const plan = outputPlanFor(params.format.value);
  if (params.alpha.value && !plan.alpha) {
    throw createError(ErrorCode.CC1012, {
      reason: `Conflicting parameters: format '${params.format.value}' (from ${params.format.source}) does not support alpha channel (requested by ${params.alpha.source}); alpha formats are ${ALPHA_FORMATS.join(", ")}`,
    });
  }

  // Codec vs Format
  if (plan.codecs.length === 0 && params.codec.origin === "flag") {
    throw createError(ErrorCode.CC1012, {
      reason: `Conflicting parameters: format '${params.format.value}' (from ${params.format.source}) has no video codec; drop --codec`,
    });
  }
  if (plan.codecs.length > 0) {
    const containerError = validateCodecContainer(params.format.value, params.codec.value);
    if (containerError) {
      throw createError(ErrorCode.CC1012, {
        reason: `Conflicting parameters: codec '${params.codec.value}' (from ${params.codec.source}) is not compatible with format '${params.format.value}' (from ${params.format.source}): ${containerError}`,
      });
    }
  }

  // Resolution vs Preset Aspect
  if (preset) {
    const [wStr, hStr] = preset.aspectRatio.split(":");
    const pw = Number(wStr);
    const ph = Number(hStr);
    if (pw && ph) {
      const targetAspect = pw / ph;
      const actualAspect = params.width.value / params.height.value;
      if (Math.abs(actualAspect - targetAspect) > 0.02) {
        throw createError(ErrorCode.CC1012, {
          reason: `Conflicting parameters: resolution ${params.width.value}x${params.height.value} (from ${params.width.source}) does not match preset '${preset.id}' aspect ratio ${preset.aspectRatio} (from ${preset.id})`,
        });
      }
    }
  }

  // Frame window start <= end
  if (params.frameWindow.value.from > params.frameWindow.value.to) {
    throw createError(ErrorCode.CC1012, {
      reason: `Conflicting parameters: start frame ${params.frameWindow.value.from} (from ${params.frameWindow.source}) cannot be greater than end frame ${params.frameWindow.value.to} (from ${params.frameWindow.source})`,
    });
  }
}

export function formatExplainReport(explain: ExplainReport): string {
  const p = explain.parameters;
  const lines = [
    `Resolved Execution Plan:`,
    `  Project Root:     ${explain.root}`,
    `  Config:           ${explain.configPath || "none (standalone)"}`,
    `  Manifest:         ${explain.manifestPath || "none"}`,
    `  Mode:             ${explain.mode}`,
    `  Selection:        ${explain.selection}`,
    `  Frame Window:     ${p.frameWindow.value.from}..${p.frameWindow.value.to} (${p.frameWindow.value.totalFrames} frames)`,
    ``,
    `Resolved Render Parameters:`,
    `  width:            ${p.width.value} (origin: ${p.width.originLabel})`,
    `  height:           ${p.height.value} (origin: ${p.height.originLabel})`,
    `  fps:              ${p.fps.value} (origin: ${p.fps.originLabel})`,
    `  format:           ${p.format.value} (origin: ${p.format.originLabel})`,
    `  codec:            ${p.codec.value} (origin: ${p.codec.originLabel})`,
    `  quality:          ${p.quality.value} (origin: ${p.quality.originLabel})`,
    `  crf:              ${p.crf.value} (origin: ${p.crf.originLabel})`,
    `  bitrate:          ${p.bitrate.value ?? "unset"} (origin: ${p.bitrate.originLabel})`,
    `  concurrency:      ${p.concurrency.value} (origin: ${p.concurrency.originLabel})`,
    `  memoryBudgetMb:   ${p.memoryBudgetMb.value ?? "auto (available memory)"} (origin: ${p.memoryBudgetMb.originLabel})`,
    `  alpha:            ${p.alpha.value} (origin: ${p.alpha.originLabel})`,
    `  colorManagement:  ${typeof p.colorManagement.value === "string" ? p.colorManagement.value : JSON.stringify(p.colorManagement.value)} (origin: ${p.colorManagement.originLabel})`,
    `  twoPass:          ${p.twoPass.value} (origin: ${p.twoPass.originLabel})`,
    `  outputPath:       ${p.outputPath.value} (origin: ${p.outputPath.originLabel})`,
    `  frameWindow:      ${p.frameWindow.value.from}..${p.frameWindow.value.to} (origin: ${p.frameWindow.originLabel})`,
  ];
  return lines.join("\n");
}

export function describeExplainReport(explain: ExplainReport): Record<string, unknown> {
  const p = explain.parameters;
  return {
    root: explain.root,
    config: explain.configPath || null,
    manifest: explain.manifestPath || null,
    mode: explain.mode,
    selection: explain.selection,
    frameWindow: explain.frameWindow,
    parameters: {
      width: { value: p.width.value, origin: p.width.origin, source: p.width.source, originLabel: p.width.originLabel },
      height: { value: p.height.value, origin: p.height.origin, source: p.height.source, originLabel: p.height.originLabel },
      fps: { value: p.fps.value, origin: p.fps.origin, source: p.fps.source, originLabel: p.fps.originLabel },
      format: { value: p.format.value, origin: p.format.origin, source: p.format.source, originLabel: p.format.originLabel },
      codec: { value: p.codec.value, origin: p.codec.origin, source: p.codec.source, originLabel: p.codec.originLabel },
      quality: { value: p.quality.value, origin: p.quality.origin, source: p.quality.source, originLabel: p.quality.originLabel },
      crf: { value: p.crf.value, origin: p.crf.origin, source: p.crf.source, originLabel: p.crf.originLabel },
      bitrate: { value: p.bitrate.value ?? null, origin: p.bitrate.origin, source: p.bitrate.source, originLabel: p.bitrate.originLabel },
      concurrency: { value: p.concurrency.value, origin: p.concurrency.origin, source: p.concurrency.source, originLabel: p.concurrency.originLabel },
      memoryBudgetMb: { value: p.memoryBudgetMb.value ?? null, origin: p.memoryBudgetMb.origin, source: p.memoryBudgetMb.source, originLabel: p.memoryBudgetMb.originLabel },
      alpha: { value: p.alpha.value, origin: p.alpha.origin, source: p.alpha.source, originLabel: p.alpha.originLabel },
      colorManagement: { value: p.colorManagement.value, origin: p.colorManagement.origin, source: p.colorManagement.source, originLabel: p.colorManagement.originLabel },
      twoPass: { value: p.twoPass.value, origin: p.twoPass.origin, source: p.twoPass.source, originLabel: p.twoPass.originLabel },
      outputPath: { value: p.outputPath.value, origin: p.outputPath.origin, source: p.outputPath.source, originLabel: p.outputPath.originLabel },
      frameWindow: { value: p.frameWindow.value, origin: p.frameWindow.origin, source: p.frameWindow.source, originLabel: p.frameWindow.originLabel },
    },
  };
}
