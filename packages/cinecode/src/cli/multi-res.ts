import { Command } from "commander";
import { resolve } from "node:path";
import { loadComposition, selectComposition } from "./still.js";
import { resolveCacheDir, resolveOutputDir } from "./shared.js";
import { getDefaultConfig, loadConfig } from "../config/schema.js";
import { parseVariantLabel, renderMultiResolution } from "../pipeline/multiResolution.js";

interface MultiResOptions {
  composition?: string;
  variants: string;
  out?: string;
  seed: number;
  concurrency?: string;
}

export function createMultiResCommand(): Command {
  return new Command("render-multi")
    .description("Render one composition at multiple resolutions in a single run")
    .argument("<file>", "Composition file")
    .option("-c, --composition <name>", "Composition name")
    .option("-v, --variants <list>", "Comma-separated variants (480p,720p,1080p,WIDTHxHEIGHT)", "480p,720p,1080p")
    .option("-o, --out <dir>", "Output directory")
    .option("--seed <number>", "Random seed", (value) => parseInt(value, 10), 0)
    .option("--concurrency <number>", "Worker count")
    .action(async (file: string, options: MultiResOptions) => {
      const config = await loadConfig(resolve("cinecode.config.ts")).catch(() => getDefaultConfig());
      const compositions = await loadComposition(file, options.composition);
      const composition = selectComposition(compositions, options.composition);
      const variants = options.variants.split(",").map((label) => parseVariantLabel(label.trim())).filter(Boolean);
      const outputDir = options.out ? resolve(options.out) : resolveOutputDir(config);
      const concurrency = options.concurrency ? Number.parseInt(options.concurrency, 10) : 4;

      const result = await renderMultiResolution({
        composition,
        variants,
        outputDir,
        cacheDir: resolveCacheDir(config),
        seed: options.seed,
        concurrency: Number.isFinite(concurrency) ? concurrency : 4,
        overwrite: false,
        format: config.render?.format ?? "mp4",
      });

      for (const variant of result.variants) {
        if (variant.error) {
          console.error(`✗ ${variant.label}: ${variant.error}`);
        } else {
          const mb = (variant.fileSize / (1024 * 1024)).toFixed(1);
          console.log(`✓ ${variant.label.padEnd(6)} ${variant.width}x${variant.height}  ${mb} MB  ${variant.outputPath}`);
        }
      }
      const failures = result.variants.filter((variant) => variant.error).length;
      if (failures > 0) process.exitCode = 1;
    });
}
