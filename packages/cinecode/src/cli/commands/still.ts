import { Command } from "commander";
import { existsSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";
import { assertExclusive } from "../shared/usage-error.js";
import { renderStill, setMediaCacheForRenderer } from "../../renderer/engine.js";
import { runReport } from "../output/run-report.js";
import { createProjectResolver, reportResolution } from "../resolve/project-resolver.js";
import { registerProjectFonts } from "../../renderer/text/fonts.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { resolveRenderParameters } from "../resolve/precedence.js";
import { describeExplainReport, formatExplainReport } from "../resolve/explain.js";
import { STILL_FORMATS, outputPlanFor, type RenderFormat } from "../../core/output-plan.js";
import { assertRenderableFormat } from "../gate/format-preflight.js";
import { encodeStillImage, type StillImageFormat } from "../../encoder/outputs.js";
import { withAtomicOutput } from "../../encoder/output.js";
import { TIME_GRAMMAR } from "../../core/time-input.js";
import { parseTimeArgument } from "../shared/shared.js";

export interface StillOptions {
  composition?: string;
  file?: string;
  timeline?: string;
  scene?: string;
  frame?: number;
  time?: string;
  out?: string;
  format?: RenderFormat;
  config?: string;
  root?: string;
  seed?: number;
  dryRun?: boolean;
  explain?: boolean;
  resolution?: string;
}

/** Narrows the resolved format to a still image; the preflight already rejected others. */
function asStillFormat(format: RenderFormat): RenderFormat {
  if (!STILL_FORMATS.includes(format)) throw createError(ErrorCode.CC1012, { reason: `${format} is not a still image format` });
  return format;
}

export async function stillCommand(options: StillOptions, context?: import("../gate/preflight.js").PreflightContext): Promise<void> {
  const project = context?.resolution ?? await createProjectResolver({
    root: options.root,
    config: options.config,
    file: options.file,
    composition: options.composition,
    timeline: options.timeline,
    scene: options.scene,
    requireSelection: true,
  }).resolve();
  if (!context?.resolution) {
    reportResolution(project, (options as { verbose?: boolean }).verbose === true);
  }
  const composition = (await project.selected())[0]!;

  const fps = composition.fps || 30;
  const durationSec = typeof composition.duration === "number" ? composition.duration : typeof composition.duration === "string" ? parseFloat(composition.duration) : (composition.contentDuration ?? 5);
  const totalFrames = Math.max(1, Math.round(durationSec * fps));
  if (options.frame !== undefined) {
    if (isNaN(options.frame) || options.frame < 0) {
      throw createError(ErrorCode.CC0001, { reason: `Frame index must be a non-negative integer, got ${options.frame}` });
    }
    if (options.frame >= totalFrames) {
      throw createError(ErrorCode.CC0001, { reason: `Frame index ${options.frame} is out of range for composition with ${totalFrames} frames [0..${totalFrames - 1}]` });
    }
  }
  if (options.time !== undefined) {
    const parsedTime = parseTimeArgument(options.time, fps);
    if (parsedTime < 0) {
      throw createError(ErrorCode.CC0001, { reason: `Time '${options.time}' resolves to negative frame ${parsedTime}` });
    }
    if (parsedTime >= totalFrames) {
      throw createError(ErrorCode.CC0001, { reason: `Time '${options.time}' resolves to frame ${parsedTime}, which is out of range for composition with ${totalFrames} frames [0..${totalFrames - 1}]` });
    }
  }

  const fontResult = registerProjectFonts(project.config.fonts, {
    projectRoot: project.root,
    mediaDir: project.config.mediaDir ?? "media",
  });
  if (fontResult.errors.length > 0) {
    const font = fontResult.errors[0]!;
    throw createError(ErrorCode.CC3006, { font: font.family, text: "font file" }, {
      location: { file: font.path },
      fixHint: font.message,
    });
  }

  const { parameters, explain } = resolveRenderParameters({
    flags: {
      resolution: options.resolution,
      format: options.format as import("../../core/types/index.js").RenderFormat | undefined,
      out: options.out,
      from: options.frame !== undefined ? options.frame : options.time,
    },
    selection: {
      id: project.selection.id,
      name: composition.name,
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      duration: composition.duration,
    },
    project: {
      root: project.root,
      configPath: project.configPath,
      manifestPath: project.manifestPath,
      mode: project.mode,
      selection: project.selection.id ? `${project.selection.kind} ${project.selection.id}` : project.selection.kind,
      config: project.config,
      roots: project.context.roots,
    },
    explicit: project.context.explicit,
    kind: "still",
  });

  const explained = describeExplainReport(explain);
  runReport.result({ explain: explained });
  runReport.explain(explained);
  assertRenderableFormat({
    command: "still",
    format: parameters.format.value,
    fromFrame: parameters.frameWindow.value.from,
    toFrame: parameters.frameWindow.value.to,
  });

  if (options.explain || options.dryRun) {
    runReport.result({
      composition: composition.name,
      frame: parameters.frameWindow.value.from,
      output: resolve(parameters.outputPath.value),
      format: parameters.format.value,
      explain,
      dryRun: options.dryRun === true,
    });
    if (!runReport.isMachine()) runReport.diagnostic(formatExplainReport(explain));
    return;
  }

  const media = await project.media();
  setMediaCacheForRenderer(media.cache);

  const frame = options.frame !== undefined
    ? options.frame
    : options.time !== undefined
      ? parseTimeArgument(options.time, fps)
      : 0;

  const format = asStillFormat(parameters.format.value);
  const plan = outputPlanFor(format);
  let out = parameters.outputPath.value;

  if (options.out) {
    const rawOut = resolve(project.root, options.out);
    if (existsSync(rawOut) && statSync(rawOut).isDirectory()) {
      throw createError(ErrorCode.CC1003, {
        key: "out",
        path: rawOut,
        reason: "a file path must not be an existing directory",
      });
    }
    const givenExt = extname(out);
    if (plan.extension && givenExt.toLowerCase() !== plan.extension.toLowerCase()) {
      runReport.warn(
        ErrorCode.CC1012,
        `Output extension for format '${format}' should be '${plan.extension}'; corrected '${givenExt}' to '${plan.extension}'`,
        out,
      );
      out = out.slice(0, out.length - givenExt.length) + plan.extension;
    }
  }

  runReport.expectArtifact("image");
  const canvas = await renderStill(
    {
      ...composition,
      width: parameters.width.value,
      height: parameters.height.value,
      fps: parameters.fps.value,
    },
    frame,
    options.seed,
  );

  const png = (canvas as { toBuffer(mime: "image/png"): Buffer }).toBuffer("image/png");
  await withAtomicOutput(out, async (staged) => {
    if (format === "png") {
      await (await import("node:fs/promises")).writeFile(staged, png);
      return;
    }
    const encoded = await encodeStillImage(png, staged, format as StillImageFormat, {
      overwrite: true,
      alpha: plan.alpha,
    });
    if (!encoded.success) {
      throw createError(ErrorCode.CC4002, { details: encoded.error ?? "still encoding failed" }, { location: { file: out } });
    }
  });
  runReport.artifact({ kind: "image", path: resolve(out), units: 1, unit: "frame" });
  runReport.result({ composition: composition.name, frame, output: resolve(out), format });
  if (!runReport.isMachine()) {
    runReport.diagnostic(`Rendered frame ${frame} (${parameters.width.value}x${parameters.height.value}) to ${out}`);
  }
}


