import { Command } from "commander";
import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { selectComposition } from "./composition-loader.js";
import { generateThumbnail } from "../encoder/thumbnail/index.js";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";
import { createProjectResolver, reportResolution } from "./project-resolver.js";
import { resolveOutputDir } from "./shared.js";

interface ThumbnailCliOptions {
  composition?: string;
  outputDir?: string;
  count: number;
  frame?: number;
  format: "png" | "jpg" | "webp";
  seed: number;
  root?: string;
  config?: string;
}

export async function thumbnailCommand(file: string, options: ThumbnailCliOptions): Promise<void> {
  const resolver = createProjectResolver({ root: options.root, config: options.config, file, composition: options.composition });
  const resolution = await resolver.resolve();
  reportResolution(resolution, false);
  const composition = selectComposition([...resolution.compositions], options.composition);
  const outputDir = resolve(options.outputDir ?? resolveOutputDir(resolution.config));
  await mkdir(outputDir, { recursive: true });
  runReport.setProject({ root: resolution.root, manifest: resolution.manifestPath ?? resolve(file) });
  runReport.expectArtifact("thumbnail");

  const targetFile = join(outputDir, `thumbnail.${options.format}`);
  const result = await generateThumbnail(composition, targetFile, {
    outputDir,
    formats: [options.format],
    frame: options.frame,
    seed: options.seed,
  });

  console.log(`Best frame: ${result.selection.frame} (score ${result.selection.score.score.toFixed(3)})`);
  const candidates = result.selection.candidates.slice(0, Math.max(1, options.count));
  for (const candidate of candidates) {
    console.log(`  frame ${candidate.frame.toString().padStart(6)}  score ${candidate.score.toFixed(3)}`);
  }
  for (const output of result.files) {
    runReport.artifact({ kind: "thumbnail", path: resolve(output.path), units: 1, unit: "image" });
    console.log(`  wrote ${output.path} (${output.width}x${output.height})`);
  }
  if (result.files.length === 0) throw createError(ErrorCode.CC4004, { path: targetFile });
  runReport.result({ frame: result.selection.frame, files: result.files.map((output) => output.path) });
}

export function createThumbnailCommand(): Command {
  return new Command("thumbnail")
    .description("Pick the best frame of a composition and write poster images")
    .argument("<composition>", "Composition file")
    .option("-c, --composition <name>", "Composition name")
    .option("-o, --output-dir <dir>", "Output directory")
    .option("-n, --count <number>", "Number of candidates to list", (value) => parseInt(value, 10), 5)
    .option("-f, --frame <number>", "Force a specific frame", (value) => parseInt(value, 10))
    .option("--format <png|jpg|webp>", "Image format", "png")
    .option("--seed <number>", "Random seed", (value) => parseInt(value, 10), 0)
    .action(async (file: string, options: ThumbnailCliOptions, command: Command) => {
      await thumbnailCommand(file, { ...command.optsWithGlobals(), ...options });
    });
}
