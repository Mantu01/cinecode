import { Command } from "commander";
import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadComposition, selectComposition } from "./still.js";
import { generateThumbnail } from "../encoder/thumbnail/index.js";

interface ThumbnailCliOptions {
  composition?: string;
  outputDir: string;
  count: number;
  frame?: number;
  format: "png" | "jpg" | "webp";
  seed: number;
}

export async function thumbnailCommand(file: string, options: ThumbnailCliOptions): Promise<void> {
  const compositions = await loadComposition(file, options.composition);
  const composition = selectComposition(compositions, options.composition);
  const outputDir = resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true });

  const result = await generateThumbnail(composition, join(outputDir, `thumbnail.${options.format}`), {
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
  for (const file of result.files) {
    console.log(`  wrote ${file.path} (${file.width}x${file.height})`);
  }
}

export function createThumbnailCommand(): Command {
  return new Command("thumbnail")
    .description("Pick the best frame of a composition and write poster images")
    .argument("<composition>", "Composition file")
    .option("-c, --composition <name>", "Composition name")
    .option("-o, --output-dir <dir>", "Output directory", "./thumbs")
    .option("-n, --count <number>", "Number of candidates to list", (value) => parseInt(value, 10), 5)
    .option("-f, --frame <number>", "Force a specific frame", (value) => parseInt(value, 10))
    .option("--format <png|jpg|webp>", "Image format", "png")
    .option("--seed <number>", "Random seed", (value) => parseInt(value, 10), 0)
    .action(async (file: string, options: ThumbnailCliOptions) => {
      await thumbnailCommand(file, options);
    });
}
