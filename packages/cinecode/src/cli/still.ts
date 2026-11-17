import { Command } from "commander";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { isUserModuleFile, loadUserModuleNamespace } from "../loader/index.js";
import { assertExclusive } from "./usage-error.js";
import type { Composition } from "../core/types/index.js";
import { renderStill } from "../renderer/engine.js";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";

export interface StillOptions {
  composition?: string;
  frame?: number;
  time?: string;
  out?: string;
  format?: "png" | "jpg" | "webp";
  config?: string;
  props?: string;
  seed?: number;
}

export function parseTimeInput(input: string, fps: number): number {
  if (input.includes(":")) {
    const parts = input.split(":").map(Number);
    if (parts.length === 4) {
      return ((parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)) * fps + (parts[3] ?? 0);
    }
    if (parts.length === 3) {
      return ((parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)) * fps;
    }
  }
  return Math.round(parseFloat(input) * fps);
}

export async function loadComposition(file: string, _compositionName?: string): Promise<Composition[]> {
  const resolvedPath = resolve(file);
  if (isUserModuleFile(resolvedPath)) {
    const module = await loadUserModuleNamespace<Record<string, unknown>>(resolvedPath, dirname(resolvedPath));
    const compositions = module.main ?? module.default ?? module;
    if (Array.isArray(compositions)) return compositions;
    if (compositions && typeof compositions === "object") return [compositions as Composition];
    throw createError(ErrorCode.CC3008, { path: resolvedPath, expected: "a composition or array of compositions" }, { location: { file: resolvedPath } });
  }
  const ext = file.split(".").pop()?.toLowerCase();
  if (ext === "json") {
    try {
      return JSON.parse(readFileSync(file, "utf-8"));
    } catch (error) {
      throw createError(ErrorCode.CC1006, { path: resolvedPath, reason: error instanceof Error ? error.message : String(error) }, { location: { file: resolvedPath }, cause: error });
    }
  }
  throw createError(ErrorCode.CC1007, { path: resolvedPath }, { location: { file: resolvedPath } });
}

export function selectComposition(compositions: Composition[], name?: string): Composition {
  if (name) {
    const found = compositions.find(c => c.name === name);
    if (!found) {
      const available = compositions.map((composition) => composition.name).join(", ") || "none";
      throw createError(ErrorCode.CC3007, { kind: "composition", id: name, available });
    }
    return found;
  }
  if (compositions.length === 1) return compositions[0]!;
  throw createError(ErrorCode.CC1012, { reason: "Multiple compositions found, specify --composition" });
}

export async function stillCommand(options: StillOptions): Promise<void> {
  const out = options.out ?? "still.png";
  const format = (options.format ?? "png").toLowerCase();
  if (format !== "png" && format !== "jpg" && format !== "webp") {
    const { assertOutputFormat } = await import("../media/formats.js");
    assertOutputFormat(format, "image");
  }
  const compositions = await loadComposition(options.config ?? options.props ?? "cinecode.config.js", options.composition);
  const composition = selectComposition(compositions, options.composition);

  const { createMediaCache } = await import("../media/cache.js");
  const { setMediaCacheForRenderer } = await import("../renderer/engine.js");
  const { getDefaultCacheDir } = await import("./render.js");
  const mediaCache = createMediaCache(join(getDefaultCacheDir(), "media"));
  await mediaCache.initialize();
  setMediaCacheForRenderer(mediaCache);

  let frame = options.frame ?? 0;
  if (options.time) {
    frame = parseTimeInput(options.time, composition.fps);
  }
  if (frame < 0) frame = 0;

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
  runReport.setProject({ root: process.cwd(), config: resolve(options.config ?? options.props ?? "cinecode.config.js") });
  runReport.expectArtifact("image");
  runReport.artifact({ kind: "image", path: resolve(out), units: 1, unit: "frame" });
  runReport.result({ composition: composition.name, frame, output: resolve(out), format });
  console.log(`Rendered frame ${frame} (${composition.width}x${composition.height}) to ${out}`);
}

export function createStillCommand(): Command {
  const cmd = new Command("still")
    .description("Render a single frame to PNG or JPEG")
    .option("-c, --composition <name>", "Composition name")
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