import { Command } from "commander";
import { createError, ErrorCode } from "../errors/codes.js";
import { runReport } from "./run-report.js";
import { resolve } from "node:path";
import { selectComposition } from "./composition-loader.js";

import { createProjectResolver, reportResolution } from "./project-resolver.js";
import { parseVariantLabel, renderMultiResolution, PREDEFINED_VARIANTS } from "../pipeline/multiResolution.js";
import type { ResolutionVariant } from "../core/types/index.js";
import { resolveRenderParameters, describeExplainReport } from "./precedence.js";
import { assertRenderableFormat } from "./format-preflight.js";

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
    .option("--variants <list>", "Comma-separated variants (480p,720p,1080p,WIDTHxHEIGHT)", "480p,720p,1080p")
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
      const { parameters, explain, preset } = resolveRenderParameters({
        flags: {
          out: options.out,
          concurrency: options.concurrency ? parseInt(options.concurrency, 10) : undefined,
        },
        selection: {
          name: composition.name,
          width: composition.width,
          height: composition.height,
          fps: composition.fps,
          duration: composition.duration,
        },
        project: {
          root: resolution.root,
          configPath: resolution.configPath,
          manifestPath: resolution.manifestPath,
          mode: resolution.mode,
          selection: `composition ${composition.name}`,
          config,
        },
        explicit: resolution.context.explicit,
      });
      runReport.result({ explain: describeExplainReport(explain) });
      assertRenderableFormat({
        command: "render",
        format: parameters.format.value,
        fromFrame: parameters.frameWindow.value.from,
        toFrame: parameters.frameWindow.value.to,
        preset: preset?.id,
      });
      const rawLabels = options.variants.split(",").map((label) => label.trim()).filter(Boolean);
      if (rawLabels.length === 0) {
        throw createError(ErrorCode.CC1002, {
          flag: "--variants",
          received: options.variants,
          expected: "a comma-separated list of valid variants (e.g. 480p, 720p, 1080p, 1440p, 4k, or WIDTHxHEIGHT)",
        });
      }
      const validPresetKeys = Object.keys(PREDEFINED_VARIANTS).join(", ");
      const variants: ResolutionVariant[] = [];
      for (const label of rawLabels) {
        try {
          variants.push(parseVariantLabel(label));
        } catch {
          throw createError(ErrorCode.CC1002, {
            flag: "--variants",
            received: label,
            expected: `one of [${validPresetKeys}], a WIDTHxHEIGHT dimension (e.g. 1920x1080), or a scale factor like 0.5x`,
          });
        }
      }
      const outputDir = options.out ? resolve(resolution.context.root, options.out) : resolution.context.roots.output;
      const concurrency = parameters.concurrency.value === "auto" ? 4 : parameters.concurrency.value;

      const result = await renderMultiResolution({
        composition,
        variants,
        outputDir,
        cacheDir: resolution.context.roots.cache,
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
