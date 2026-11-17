import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertExclusive } from "./usage-error.js";
import { renderStill, setMediaCacheForRenderer } from "../renderer/engine.js";
import { runReport } from "./run-report.js";
import { createProjectResolver, reportResolution } from "./project-resolver.js";

export interface StillOptions {
  composition?: string;
  file?: string;
  timeline?: string;
  scene?: string;
  frame?: number;
  time?: string;
  out?: string;
  format?: "png" | "jpg" | "webp";
  config?: string;
  root?: string;
  props?: string;
  seed?: number;
}

export async function stillCommand(options: StillOptions): Promise<void> {
  const out = options.out ?? "still.png";
  const format = (options.format ?? "png").toLowerCase();
  if (format !== "png" && format !== "jpg" && format !== "webp") {
    const { assertOutputFormat } = await import("../media/formats.js");
    assertOutputFormat(format, "image");
  }
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
  const media = await project.media();
  setMediaCacheForRenderer(media.cache);

  let frame = options.frame ?? 0;
  if (options.time) {
    const { parseTimeInput } = await import("./shared.js");
    frame = parseTimeInput(options.time, composition.fps);
  }
  if (frame < 0) frame = 0;

  runReport.expectArtifact("image");
  const canvas = await renderStill(composition, frame, options.seed);

  let buffer: Buffer;
  if (format === "png") {
    buffer = (canvas as { toBuffer(mime: "image/png"): Buffer }).toBuffer("image/png");
  } else if (format === "webp") {
    buffer = (canvas as { toBuffer(mime: "image/webp", quality?: number): Buffer }).toBuffer("image/webp", 0.9);
  } else {
    buffer = (canvas as { toBuffer(mime: "image/jpeg", quality?: number): Buffer }).toBuffer("image/jpeg", 0.9);
  }
  writeFileSync(out, buffer);
  runReport.artifact({ kind: "image", path: resolve(out), units: 1, unit: "frame" });
  runReport.result({ composition: composition.name, frame, output: resolve(out), format });
  console.log(`Rendered frame ${frame} (${composition.width}x${composition.height}) to ${out}`);
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
    .option("--format <png|jpg|webp>", "Output format")
    .option("--seed <number>", "Random seed", (v) => parseInt(v, 10))
    .action(async (options: StillOptions) => {
      assertExclusive([
        ["--frame", options.frame !== undefined],
        ["--time", options.time !== undefined],
      ]);
      await stillCommand(options);
    });
  return cmd;
}
