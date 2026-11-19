import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { serializeFrameToSvg, type CssMode, type FontStrategy } from "../svg/serializer.js";
import { runReport } from "./run-report.js";
import { createProjectResolver, reportResolution } from "./project-resolver.js";
import { createError, ErrorCode } from "../errors/codes.js";

export function createExportSvgCommand(): Command {
  const cmd = new Command("export-svg")
    .description("Export composition frames as high-precision vector SVG graphics")
    .argument("[entry]", "Composition entry file", "src/main.ts")
    .option("-f, --frame <number>", "Single frame number to export", "0")
    .option("-r, --range <range>", "Frame range to export (e.g. 0-60)")
    .option("-o, --out <path>", "Output directory or file path", "./dist/svg")
    .option("--viewBox-precision <digits>", "Coordinate precision digits", "3")
    .option("--css-mode <mode>", "CSS styling mode: inline, embedded, external", "inline")
    .option("--font-strategy <strategy>", "Font strategy: embed-base64, link-webfont, convert-to-paths", "convert-to-paths")
    .option("--optimize", "Run SVGO optimization passes", false)
    .option("-c, --composition <name>", "Composition name")
    .action(async (entry: string, options) => {
      const resolver = createProjectResolver({ root: options.root, config: options.config, file: entry, composition: options.composition });
      const resolution = await resolver.resolve();
      reportResolution(resolution, (options as { verbose?: boolean }).verbose === true);
      const selected = await resolver.selected();
      if (!selected || selected.length === 0 || !selected[0]) {
        throw createError(ErrorCode.CC1002, { reason: `no composition selected or found in ${entry}` });
      }
      const comp = selected[0]!;
      runReport.expectArtifact("svg");

      const outDir = path.resolve(options.out);
      fs.mkdirSync(outDir, { recursive: true });

      const serializerOpts = {
        viewBoxPrecision: parseInt(options.viewBoxPrecision, 10),
        cssMode: options.cssMode as CssMode,
        fontStrategy: options.fontStrategy as FontStrategy,
        optimize: Boolean(options.optimize),
      };

      if (options.range) {
        const [startStr, endStr] = options.range.split("-");
        const start = parseInt(startStr || "0", 10);
        const end = parseInt(endStr || "30", 10);
        const count = end - start + 1;
        console.log(`Exporting frames ${start} to ${end} as SVG for composition "${comp.name}"...`);

        for (let f = start; f <= end; f++) {
          const svg = serializeFrameToSvg(comp, f, serializerOpts);
          const fname = `frame-${String(f).padStart(4, "0")}.svg`;
          fs.writeFileSync(path.join(outDir, fname), svg, "utf8");
        }
        runReport.artifact({ kind: "svg-sequence", path: outDir, units: count, unit: "frames" });
        runReport.result({ composition: comp.name, frames: count, output: outDir });
        console.log(pc.green(`✔ Exported ${count} SVG frames for "${comp.name}" to ${outDir}`));
      } else {
        const f = parseInt(options.frame, 10);
        const svg = serializeFrameToSvg(comp, f, serializerOpts);
        const outPath = outDir.endsWith(".svg") ? outDir : path.join(outDir, `frame-${String(f).padStart(4, "0")}.svg`);
        fs.writeFileSync(outPath, svg, "utf8");
        runReport.artifact({ kind: "svg", path: outPath, units: 1, unit: "frame" });
        runReport.result({ composition: comp.name, frame: f, frames: 1, output: outPath });
        console.log(pc.green(`✔ Exported SVG frame ${f} for "${comp.name}" to ${outPath}`));
      }
    });

  return cmd;
}
