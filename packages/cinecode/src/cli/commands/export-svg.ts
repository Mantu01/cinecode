import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { pc } from "../output/palette.js";
import { serializeFrameToSvg, unsupportedSvgClips } from "../../svg/serializer.js";
import { runReport } from "../output/run-report.js";
import { createProjectResolver, reportResolution } from "../resolve/project-resolver.js";
import { createError, ErrorCode } from "../../errors/codes.js";

export async function exportSvgCommand(
  entryOrOptions?: string | Record<string, unknown>,
  maybeOptions?: Record<string, unknown>,
  maybeContext?: import("../gate/preflight.js").PreflightContext,
): Promise<void> {
  const isPositional = typeof entryOrOptions === "string";
  const options = (isPositional ? (maybeOptions ?? {}) : (entryOrOptions ?? {})) as {
    root?: string;
    config?: string;
    composition?: string;
    out?: string;
    viewBoxPrecision?: string | number;
    optimize?: boolean;
    range?: string;
    frame?: string | number;
    verbose?: boolean;
  };
  const context = isPositional ? maybeContext : (maybeOptions as unknown as import("../gate/preflight.js").PreflightContext | undefined);
  const entry = isPositional ? entryOrOptions : undefined;
  const resolution = context?.resolution ?? await createProjectResolver({ root: options.root, config: options.config, file: entry, composition: options.composition, requireSelection: true }).resolve();
  if (!context?.resolution) {
    reportResolution(resolution, options.verbose === true);
  }
  const selected = await resolution.selected();
  if (!selected || selected.length === 0 || !selected[0]) {
    throw createError(ErrorCode.CC1002, { reason: `no composition selected or found in ${entry}` });
  }
  const comp = selected[0]!;
  runReport.expectArtifact("svg");

  const unsupported = unsupportedSvgClips(comp);
  if (unsupported.length > 0) {
    const list = unsupported.map((clip) => `${clip.id}:${clip.type}@${clip.track}[${clip.start}-${clip.start + clip.duration}]`).join(", ");
    throw createError(ErrorCode.CC4009, { reason: `SVG export unsupported clips: ${list}. Render a raster frame instead.` });
  }

  const outDir = path.resolve(resolution.context.root, options.out ?? "./dist/svg");
  fs.mkdirSync(outDir, { recursive: true });

  const serializerOpts = {
    viewBoxPrecision: typeof options.viewBoxPrecision === "number" ? options.viewBoxPrecision : parseInt(options.viewBoxPrecision ?? "3", 10),
    optimize: Boolean(options.optimize),
  };

  const fps = comp.fps || 30;
  const durationSec = typeof comp.duration === "number" ? comp.duration : typeof comp.duration === "string" ? parseFloat(comp.duration) : (comp.contentDuration ?? 5);
  const totalFrames = Math.max(1, Math.round(durationSec * fps));

  if (options.range !== undefined) {
    const trimmed = options.range.trim();
    const match = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!match) {
      throw createError(ErrorCode.CC0001, {
        reason: `Invalid range '${options.range}'. Range must be numeric in the form <start>-<end>`,
      });
    }
    const start = parseInt(match[1]!, 10);
    const end = parseInt(match[2]!, 10);
    if (start < 0 || end < 0) {
      throw createError(ErrorCode.CC0001, {
        reason: `Invalid range '${options.range}': frames must be non-negative`,
      });
    }
    if (start > end) {
      throw createError(ErrorCode.CC0001, {
        reason: `Invalid range '${options.range}': start (${start}) cannot be greater than end (${end})`,
      });
    }
    const count = end - start + 1;
    if (count <= 0) {
      throw createError(ErrorCode.CC0001, {
        reason: `Invalid range '${options.range}': range is empty`,
      });
    }
    if (start >= totalFrames || end >= totalFrames) {
      throw createError(ErrorCode.CC0001, {
        reason: `Range [${start}, ${end}] is out of range for composition with ${totalFrames} frames [0..${totalFrames - 1}]`,
      });
    }
    if (!runReport.isMachine()) runReport.diagnostic(`Exporting frames ${start} to ${end} as SVG for composition "${comp.name}"...`);

    for (let f = start; f <= end; f++) {
      const svg = serializeFrameToSvg(comp, f, serializerOpts);
      const fname = `frame-${String(f).padStart(4, "0")}.svg`;
      fs.writeFileSync(path.join(outDir, fname), svg, "utf8");
    }
    runReport.artifact({ kind: "svg-sequence", path: outDir, units: count, unit: "frames" });
    runReport.result({ composition: comp.name, frame: start, frames: count, output: outDir });
    if (!runReport.isMachine()) runReport.diagnostic(pc.green(`✔ Exported ${count} SVG frames for "${comp.name}" to ${outDir}`));
  } else {
    let f = 0;
    if (options.frame !== undefined) {
      f = typeof options.frame === "number" ? options.frame : parseInt(String(options.frame), 10);
      if (isNaN(f) || f < 0) {
        throw createError(ErrorCode.CC0001, { reason: `Frame index must be a non-negative integer, got ${options.frame}` });
      }
      if (f >= totalFrames) {
        throw createError(ErrorCode.CC0001, { reason: `Frame index ${f} is out of range for composition with ${totalFrames} frames [0..${totalFrames - 1}]` });
      }
    }
    const svg = serializeFrameToSvg(comp, f, serializerOpts);
    const outPath = outDir.endsWith(".svg") ? outDir : path.join(outDir, `frame-${String(f).padStart(4, "0")}.svg`);
    fs.writeFileSync(outPath, svg, "utf8");
    runReport.artifact({ kind: "svg", path: outPath, units: 1, unit: "frame" });
    runReport.result({ composition: comp.name, frame: f, frames: 1, output: outPath });
    if (!runReport.isMachine()) runReport.diagnostic(pc.green(`✔ Exported SVG frame ${f} for "${comp.name}" to ${outPath}`));
  }
}

