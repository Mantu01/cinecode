import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { serializeFrameToSvg, type CssMode, type FontStrategy } from "../svg/serializer.js";
import type { Composition } from "../core/types/index.js";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";

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
    .option("--optimize", "Run SVGO optimization passes", true)
    .option("--no-optimize", "Disable SVGO optimization")
    .action(async (entry: string, options) => {
      const absEntry = path.resolve(entry);
      if (!fs.existsSync(absEntry)) {
        throw createError(ErrorCode.CC1009, { path: absEntry }, { location: { file: absEntry } });
      }
      let comp: Composition;
      if (absEntry.endsWith(".json")) {
        try {
          comp = JSON.parse(fs.readFileSync(absEntry, "utf8"));
        } catch (error) {
          throw createError(ErrorCode.CC1006, { path: absEntry, reason: error instanceof Error ? error.message : String(error) }, { location: { file: absEntry }, cause: error });
        }
      } else {
        try {
          const mod = await import(absEntry);
          comp = mod.default || mod.composition || mod;
        } catch (error) {
          throw createError(ErrorCode.CC3008, { path: absEntry, expected: "a composition export" }, { location: { file: absEntry }, cause: error });
        }
      }
      if (!comp || typeof comp.width !== "number" || !comp.rootTimeline) {
        throw createError(ErrorCode.CC3008, { path: absEntry, expected: "a composition with width, height and rootTimeline" }, { location: { file: absEntry } });
      }
      runReport.setProject({ root: process.cwd(), manifest: absEntry });
      runReport.expectArtifact("svg");

      const outDir = path.resolve(options.out);
      fs.mkdirSync(outDir, { recursive: true });

      const serializerOpts = {
        viewBoxPrecision: parseInt(options.viewBoxPrecision, 10),
        cssMode: options.cssMode as CssMode,
        fontStrategy: options.fontStrategy as FontStrategy,
        optimize: options.optimize !== false,
      };

      if (options.range) {
        const [startStr, endStr] = options.range.split("-");
        const start = parseInt(startStr || "0", 10);
        const end = parseInt(endStr || "30", 10);
        console.log(`Exporting frames ${start} to ${end} as SVG...`);

        for (let f = start; f <= end; f++) {
          const svg = serializeFrameToSvg(comp, f, serializerOpts);
          const fname = `frame-${String(f).padStart(4, "0")}.svg`;
          fs.writeFileSync(path.join(outDir, fname), svg, "utf8");
        }
        runReport.artifact({ kind: "svg-sequence", path: outDir, units: end - start + 1, unit: "frames" });
        runReport.result({ frames: end - start + 1, output: outDir });
        console.log(pc.green(`✔ Exported ${end - start + 1} SVG frames to ${outDir}`));
      } else {
        const f = parseInt(options.frame, 10);
        const svg = serializeFrameToSvg(comp, f, serializerOpts);
        const outPath = outDir.endsWith(".svg") ? outDir : path.join(outDir, `frame-${String(f).padStart(4, "0")}.svg`);
        fs.writeFileSync(outPath, svg, "utf8");
        runReport.artifact({ kind: "svg", path: outPath, units: 1, unit: "frame" });
        runReport.result({ frame: f, output: outPath });
        console.log(pc.green(`✔ Exported SVG frame ${f} to ${outPath}`));
      }
    });

  return cmd;
}
