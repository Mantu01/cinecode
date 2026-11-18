import { Command } from "commander";
import { resolve } from "node:path";
import { assertExclusive } from "./usage-error.js";
import { renderStill, setMediaCacheForRenderer } from "../renderer/engine.js";
import { runReport } from "./run-report.js";
import { createProjectResolver, reportResolution } from "./project-resolver.js";
import { registerProjectFonts } from "../renderer/text/fonts.js";
import { createError, ErrorCode } from "../errors/index.js";
import { resolveRenderParameters, formatExplainReport, describeExplainReport } from "./precedence.js";
import { STILL_FORMATS, outputPlanFor, type RenderFormat } from "../core/output-plan.js";
import { assertOutputFormat } from "../media/formats.js";
import { encodeStillImage, type StillImageFormat } from "../encoder/outputs.js";
import { withAtomicOutput } from "../encoder/output.js";

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
  props?: string;
  seed?: number;
  dryRun?: boolean;
  explain?: boolean;
  resolution?: string;
}

/** Rejects any format that is not a still image, naming the alternatives. */
function assertStillFormat(format: string): RenderFormat {
  const normalized = format.toLowerCase();
  assertOutputFormat(normalized, "image");
  if (!STILL_FORMATS.includes(normalized as RenderFormat)) {
    throw createError(
      ErrorCode.CC2002,
      { type: "image", path: format },
      { fixHint: `${format} is not a still image format; use one of ${STILL_FORMATS.join(", ")}.` },
    );
  }
  return normalized as RenderFormat;
}

export async function stillCommand(options: StillOptions): Promise<void> {
  if (options.format) assertStillFormat(options.format);
  const resolver = createProjectResolver({
    root: options.root,
    config: options.config ?? options.props,
    file: options.file,
    composition: options.composition,
    timeline: options.timeline,
    scene: options.scene,
    requireSelection: true,
  });
  const project = await resolver.resolve();
  reportResolution(project, (options as { verbose?: boolean }).verbose === true);
  const composition = (await resolver.selected())[0]!;
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
      format: options.format as any,
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
    },
    kind: "still",
  });

  runReport.result({ explain: describeExplainReport(explain) });

  if (options.explain || options.dryRun) {
    console.log(formatExplainReport(explain));
    return;
  }

  const media = await project.media();
  setMediaCacheForRenderer(media.cache);

  const frame = Math.max(0, parameters.frameWindow.value.from);
  const out = parameters.outputPath.value;
  const format = assertStillFormat(parameters.format.value);
  const plan = outputPlanFor(format);

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
  console.log(`Rendered frame ${frame} (${parameters.width.value}x${parameters.height.value}) to ${out}`);
}

export function createStillCommand(): Command {
  const cmd = new Command("still")
    .description("Render a single frame to PNG or JPEG")
    .option("--file <path>", "Standalone composition file (file mode)")
    .option("-c, --composition <name>", "Composition name (requires --file)")
    .option("-T, --timeline <id>", "Timeline id from main.ts")
    .option("-s, --scene <id>", "Scene id from main.ts")
    .option("-f, --frame <number>", "Frame number", (v) => parseInt(v, 10))
    .option("-t, --time <timecode|seconds>", "Time (HH:MM:SS:FF or seconds)")
    .option("-o, --out <path>", "Output file path")
    .option("--format <format>", `Output format: ${STILL_FORMATS.join(", ")}`)
    .option("--resolution <WIDTHxHEIGHT>", "Override resolution")
    .option("--seed <number>", "Random seed", (v) => parseInt(v, 10))
    .option("--dry-run", "Print render plan without rendering", false)
    .option("--explain", "Print resolved parameters and their origins without rendering", false)
    .action(async (options: StillOptions) => {
      assertExclusive([
        ["--frame", options.frame !== undefined],
        ["--time", options.time !== undefined],
      ]);
      await stillCommand(options);
    });
  return cmd;
}
