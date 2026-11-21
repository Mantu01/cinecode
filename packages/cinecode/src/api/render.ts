import { loadComposition, selectComposition } from "../cli/composition-loader.js";
import { createRenderJob, type RenderOptions, type RenderJob } from "../pipeline/index.js";
import { resolveRenderParameters } from "../cli/precedence.js";
import { loadProjectContext } from "../cli/project-context.js";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

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
  /** Render memory budget in MiB (frames queued + chunks in flight). */
  readonly memoryBudgetMb?: number;
  /** Configured fonts registered in every render process before drawing. */
  readonly fonts?: readonly import("../core/types/index.js").FontEntry[];
  /** Project root; defaults to the configured/discovered project. */
  readonly root?: string;
  readonly config?: string;
  readonly cwd?: string;
  readonly projectRoot?: string;
  readonly mediaDir?: string;
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
    quality,
  } = options;

  const context = await loadProjectContext({
    root: options.root ?? options.projectRoot,
    config: options.config,
    cwd: options.cwd,
    allowStandalone: true,
  });
  const entryPath = isAbsolute(entry) ? entry : resolve(context.root, entry);
  const resolvedCacheDir = options.cacheDir ?? context.roots.cache;

  await mkdir(resolvedCacheDir, { recursive: true });

  const compositions = await loadComposition(entryPath);
  const composition = selectComposition(compositions, compositionName);

  const { parameters } = resolveRenderParameters({
    flags: {
      fps,
      width: resolution?.width,
      height: resolution?.height,
      out,
      from,
      to,
      concurrency,
      memoryBudgetMb: options.memoryBudgetMb,
      preview,
      quality: quality as any,
    },
    selection: {
      name: composition.name,
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      duration: composition.duration,
    },
    project: {
      root: context.root,
      configPath: context.configPath,
      config: context.config,
      mode: "file",
      selection: `composition ${composition.name}`,
      roots: context.roots,
    },
    explicit: context.explicit,
  });

  const outputPath = parameters.outputPath.value;
  await mkdir(dirname(outputPath), { recursive: true });

  const renderOptions: RenderOptions = {
    composition: {
      ...composition,
      width: parameters.width.value,
      height: parameters.height.value,
      fps: parameters.fps.value,
    },
    outputPath,
    cacheDir: resolvedCacheDir,
    seed,
    concurrency: parameters.concurrency.value,
    chunkSize: options.chunkSize ?? 8,
    memoryBudgetMb: parameters.memoryBudgetMb.value,
    quality: parameters.quality.value,
    overwrite,
    fresh,
    noCache,
    fromFrame: parameters.frameWindow.value.from,
    toFrame: parameters.frameWindow.value.to,
    silent: true,
    fonts: options.fonts,
    projectRoot: context.root,
    mediaDir: options.mediaDir ?? context.config.mediaDir,
  };

  return createRenderJob(renderOptions);
}

export async function renderSync(options: RenderApiOptions): Promise<RenderApiResult> {
  const job = await render(options);
  return job.promise;
}
