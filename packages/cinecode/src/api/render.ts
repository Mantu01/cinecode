import { loadComposition, selectComposition } from "../cli/composition-loader.js";
import { parseTimeInput } from "../cli/shared.js";
import { createRenderJob, type RenderOptions, type RenderJob } from "../pipeline/index.js";
import { getDefaultCacheDir } from "../cli/render.js";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface RenderApiOptions {
  readonly entry: string;
  readonly composition?: string;
  readonly preview?: boolean;
  readonly fps?: number;
  readonly resolution?: { width: number; height: number };
  readonly out?: string;
  readonly from?: string | number;
  readonly to?: string | number;
  readonly props?: Record<string, unknown>;
  readonly concurrency?: number | "auto";
  readonly noCache?: boolean;
  readonly fresh?: boolean;
  readonly overwrite?: boolean;
  readonly seed?: number;
  readonly cacheDir?: string;
  /** Override render quality; supersedes config and preview flag. */
  readonly quality?: "final" | "medium" | "low";
  /** Chunk size in frames for worker parallelism. */
  readonly chunkSize?: number;
}

export interface RenderApiResult {
  readonly outputPath: string;
  readonly duration: number;
  readonly fileSize: number;
  readonly timeTaken: number;
  readonly cacheReuse: number;
}

export async function render(options: RenderApiOptions): Promise<RenderJob> {
  const {
    entry,
    composition: compositionName,
    preview = false,
    fps,
    resolution,
    out,
    from,
    to,
    concurrency = "auto",
    noCache = false,
    fresh = false,
    overwrite = false,
    seed = 0,
    cacheDir = getDefaultCacheDir(),
    quality,
  } = options;

  await mkdir(cacheDir, { recursive: true });
  await mkdir(resolve("output"), { recursive: true });

  const compositions = await loadComposition(entry);
  const composition = selectComposition(compositions, compositionName);

  const effectiveFps = fps ?? composition.fps;
  const effectiveResolution = resolution ?? {
    width: composition.width,
    height: composition.height,
  };

  let fromFrame = 0;
  let toFrame: number | undefined;

  if (composition.duration) {
    const dur =
      typeof composition.duration === "number"
        ? composition.duration
        : parseFloat(composition.duration as string);
    toFrame = Math.ceil(dur * effectiveFps);
  }

  if (from !== undefined) {
    fromFrame = typeof from === "number" ? from : parseTimeInput(from as string, effectiveFps);
  }
  if (to !== undefined) {
    toFrame = typeof to === "number" ? to : parseTimeInput(to as string, effectiveFps);
  }

  const outputName = `${composition.name}${preview ? ".preview" : ""}`;
  const outputPath = out ?? resolve("output", `${outputName}.mp4`);
  await mkdir(dirname(outputPath), { recursive: true });

  const renderOptions: RenderOptions = {
    composition: {
      ...composition,
      width: effectiveResolution.width,
      height: effectiveResolution.height,
      fps: effectiveFps,
    },
    outputPath,
    cacheDir,
    seed,
    concurrency,
    chunkSize: options.chunkSize ?? 8,
    quality: quality ?? (preview ? "preview" : "final"),
    overwrite,
    fresh,
    noCache,
    fromFrame,
    toFrame,
    silent: true,
  };

  return createRenderJob(renderOptions);
}

export async function renderSync(options: RenderApiOptions): Promise<RenderApiResult> {
  const job = await render(options);
  return job.promise;
}
