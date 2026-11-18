import { Command } from "commander";
import { createError, ErrorCode } from "../errors/codes.js";
import { runReport } from "./run-report.js";
import { resolve } from "node:path";
import { selectComposition } from "./composition-loader.js";
import { resolveCacheDir, resolveOutputDir } from "./shared.js";
import { createProjectResolver, reportResolution } from "./project-resolver.js";
import { parseVariantLabel, renderMultiResolution } from "../pipeline/multiResolution.js";
import { resolveRenderParameters, describeExplainReport } from "./precedence.js";

interface MultiResOptions {
  composition?: string;
  dryRun?: boolean;
  config?: string;
  root?: string;
  variants: string;
  out?: string;
  seed?: number;
  concurrency?: string;
}

export function createMultiResCommand(): Command {
  return new Command("render-multi")
    .description("Render one composition at multiple resolutions in a single run")
    .argument("<file>", "Composition file")
    .option("-c, --composition <name>", "Composition name")
    .option("-v, --variants <list>", "Comma-separated variants (480p,720p,1080p,WIDTHxHEIGHT)", "480p,720p,1080p")
    .option("-o, --out <dir>", "Output directory")
    .option("--seed <number>", "Random seed", (value) => parseInt(value, 10))
    .option("--concurrency <number>", "Worker count")
    .action(async (file: string, options: MultiResOptions, command: Command) => {
      const merged = { ...command.optsWithGlobals(), ...options } as MultiResOptions;
      const resolver = createProjectResolver({ root: merged.root, config: merged.config, file, composition: options.composition });
      const resolution = await resolver.resolve();
      reportResolution(resolution, merged.dryRun === true);
      const config = resolution.config;
      const composition = selectComposition([...resolution.compositions], options.composition);
      const { parameters, explain } = resolveRenderParameters({
        flags: {
          out: options.out,
          concurrency: options.concurrency ? parseInt(options.concurrency, 10) : undefined,
        },
        selection: {
          name: composition.name,
          width: composition.width,
          height: composition.height,
          fps: composition.fps,
        },
        project: {
          root: resolution.root,
          configPath: resolution.configPath,
          manifestPath: resolution.manifestPath,
          mode: resolution.mode,
          selection: `composition ${composition.name}`,
          config,
        },
      });
      runReport.result({ explain: describeExplainReport(explain) });
      const variants = options.variants.split(",").map((label) => parseVariantLabel(label.trim())).filter(Boolean);
      const outputDir = options.out ? resolve(options.out) : resolveOutputDir(config);
      const concurrency = parameters.concurrency.value === "auto" ? 4 : parameters.concurrency.value;

      const result = await renderMultiResolution({
        composition,
        variants,
        outputDir,
        cacheDir: resolveCacheDir(config),
        seed: options.seed ?? 0,
        concurrency,
        overwrite: false,
        format: parameters.format.value,
      });

      for (const variant of result.variants) {
        if (variant.error) {
          console.error(`✗ ${variant.label}: ${variant.error}`);
        } else {
          const mb = (variant.fileSize / (1024 * 1024)).toFixed(1);
          console.log(`✓ ${variant.label.padEnd(6)} ${variant.width}x${variant.height}  ${mb} MB  ${variant.outputPath}`);
        }
      }
      const failedVariants = result.variants.filter((variant) => variant.error);
      runReport.result({ variants: result.variants.map(({ label, width, height, outputPath, error }) => ({ label, width, height, outputPath, error })) });
      for (const variant of result.variants) {
        if (!variant.error) runReport.artifact({ kind: "video", path: variant.outputPath, units: 1, unit: "file" });
      }
      if (failedVariants.length > 0) {
        throw createError(ErrorCode.CC4009, {
          count: failedVariants.length,
          reason: failedVariants.map((variant) => `${variant.label}: ${variant.error}`).join("; "),
        }, { location: { file: failedVariants[0]!.outputPath } });
      }
    });
}
