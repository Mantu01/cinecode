import { Command } from "commander";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { stat } from "node:fs/promises";
import { join, basename, extname, dirname } from "node:path";
import { renderCommand, type RenderCliOptions } from "./render.js";

export interface PreviewCliOptions extends RenderCliOptions {
  open: boolean;
}

async function openFile(filePath: string): Promise<void> {
  const plat = platform();
  let command = "";
  let args: string[] = [];

  if (plat === "win32") {
    command = "cmd";
    args = ["/c", "start", "", filePath];
  } else if (plat === "darwin") {
    command = "open";
    args = [filePath];
  } else {
    command = "xdg-open";
    args = [filePath];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
    child.on("error", reject);
    child.on("exit", () => resolve());
    setTimeout(resolve, 100);
  });
}

export async function previewCommand(options: PreviewCliOptions): Promise<void> {
  await renderCommand({ ...options, preview: true });

  if (options.open) {
    const { loadComposition, selectComposition } = await import("./still.js");
    const compositions = await loadComposition(options.config ?? options.props ?? "cinecode.config.js", options.composition);
    const composition = selectComposition(compositions, options.composition);
    const outputDir = join(process.cwd(), "output");
    const unresolvedPath = options.out ?? join(outputDir, `${composition.name}.preview.mp4`);
    const outputPath = await resolveOutputPath(unresolvedPath, options.overwrite);

    try {
      await openFile(outputPath);
    } catch (error) {
      console.warn(`Could not open preview: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}

async function resolveOutputPath(basePath: string, overwrite: boolean): Promise<string> {
  if (overwrite) return basePath;
  try {
    await stat(basePath);
  } catch {
    return basePath;
  }
  const dir = dirname(basePath);
  const stem = basename(basePath, extname(basePath));
  let i = 2;
  while (true) {
    const candidate = join(dir, `${stem}-v${i}${extname(basePath)}`);
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
    i++;
  }
}

export function createPreviewCommand(): Command {
  const cmd = new Command("preview")
    .description("Render and optionally open a preview (half resolution, faster)")
    .option("-c, --composition <name>", "Composition name")
    .option("--fps <number>", "Override FPS", (v) => parseInt(v, 10))
    .option("--resolution <WIDTHxHEIGHT>", "Override resolution")
    .option("-o, --out <path>", "Output file path")
    .option("--from <timecode|seconds|frames>", "Start time (HH:MM:SS:FF, seconds, or frames(N))")
    .option("--to <timecode|seconds|frames>", "End time (HH:MM:SS:FF, seconds, or frames(N))")
    .option("--concurrency <number|auto>", "Number of worker threads", (v) => v === "auto" ? "auto" : parseInt(v, 10))
    .option("--no-cache", "Disable render cache", false)
    .option("--fresh", "Ignore resume state, start fresh", false)
    .option("--overwrite", "Overwrite existing output file", false)
    .option("--dry-run", "Print render plan without rendering", false)
    .option("--seed <number>", "Random seed", (v) => parseInt(v, 10))
    .option("--open", "Open preview in system default player", false)
    .action(async (options: PreviewCliOptions) => {
      await previewCommand(options);
    });

  return cmd;
}