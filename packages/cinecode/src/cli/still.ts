import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Composition } from "../core/types/index.js";
import { renderStill } from "../renderer/engine.js";

export interface StillOptions {
  composition?: string;
  frame?: number;
  time?: string;
  out: string;
  format: "png" | "jpg";
  props?: string;
  seed: number;
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
  const ext = file.split(".").pop()?.toLowerCase();
  if (ext === "js" || ext === "mjs" || ext === "ts") {
    const resolvedPath = resolve(file);
    const fileUrl = pathToFileURL(resolvedPath).href;
    const module = await import(fileUrl);
    const compositions = module.main ?? module.default ?? module;
    if (Array.isArray(compositions)) return compositions;
    if (compositions && typeof compositions === "object") return [compositions];
    throw new Error("Module must export a composition or array of compositions");
  }
  if (ext === "json") {
    return JSON.parse(readFileSync(file, "utf-8"));
  }
  throw new Error(`Unsupported file type: ${ext}`);
}

export function selectComposition(compositions: Composition[], name?: string): Composition {
  if (name) {
    const found = compositions.find(c => c.name === name);
    if (!found) throw new Error(`Composition "${name}" not found`);
    return found;
  }
  if (compositions.length === 1) return compositions[0]!;
  throw new Error("Multiple compositions found, specify --composition");
}

export async function stillCommand(options: StillOptions): Promise<void> {
  const format = (options.format ?? "png").toLowerCase();
  if (format !== "png" && format !== "jpg" && format !== "webp") {
    const { assertOutputFormat } = await import("../media/formats.js");
    assertOutputFormat(format, "image");
  }
  const compositions = await loadComposition(options.props ?? "cinecode.config.js", options.composition);
  const composition = selectComposition(compositions, options.composition);

  // Video clips decode through the renderer's media cache; a still rendered
  // outside the render pipeline has to install it itself.
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
  writeFileSync(options.out, buffer);
  console.log(`Rendered frame ${frame} (${composition.width}x${composition.height}) to ${options.out}`);
}

export function createStillCommand(): Command {
  const cmd = new Command("still")
    .description("Render a single frame to PNG or JPEG")
    .option("-c, --composition <name>", "Composition name")
    .option("-f, --frame <number>", "Frame number", (v) => parseInt(v, 10))
    .option("-t, --time <timecode|seconds>", "Time (HH:MM:SS:FF or seconds)")
    .option("-o, --out <path>", "Output file path", "still.png")
    .option("--format <png|jpg|webp>", "Output format", "png")
    .option("--props <path>", "Path to composition file or config")
    .option("--seed <number>", "Random seed", (v) => parseInt(v, 10), 0)
    .action(async (options: StillOptions) => {
      await stillCommand(options);
    });
  return cmd;
}