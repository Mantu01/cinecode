import type { Composition, FontEntry } from "../core/types/index.js";
import { formatBytes, type ByteBudget } from "./memory.js";
import { createWorkerManager, type FrameManager } from "./workers.js";
import { createInProcessFrameManager } from "./in-process-manager.js";
import type { SharedDecodeService } from "../media/decode-service.js";
import type { PluginRegistry } from "../plugin/registry.js";
import type { ExtensionDescriptor } from "../plugin/descriptor.js";

export function createPipelineWorkerManager(params: {
  readonly inProcess: boolean;
  readonly resolvedConcurrency: number;
  readonly processedComposition: Composition;
  readonly seed: number;
  readonly cacheDir: string;
  readonly frameBudget: ByteBudget;
  readonly maxChunkBytes: number;
  readonly fonts?: readonly FontEntry[];
  readonly projectRoot?: string;
  readonly mediaDir?: string;
  readonly frameErrorPolicy?: "placeholder" | "repeat-previous" | "abort";
  readonly registry: PluginRegistry;
  readonly extensionDescriptor: ExtensionDescriptor;
  readonly binaries?: { readonly ffmpegPath?: string; readonly ffprobePath?: string };
  readonly verbose: boolean;
  readonly decodeService: SharedDecodeService;
  readonly onWarning: (msg: string) => void;
}): FrameManager {
  const {
    inProcess,
    resolvedConcurrency,
    processedComposition,
    seed,
    cacheDir,
    frameBudget,
    maxChunkBytes,
    fonts,
    projectRoot,
    mediaDir,
    frameErrorPolicy,
    registry,
    extensionDescriptor,
    binaries,
    verbose,
    decodeService,
    onWarning,
  } = params;

  const workerPlugins = registry.getAll().map((entry) => ({
    name: entry.plugin.manifest.name,
    source: entry.source,
    options: entry.options,
  }));

  const workerManagerOptions = {
    concurrency: resolvedConcurrency,
    composition: processedComposition,
    seed,
    cacheDir,
    budget: frameBudget,
    maxChunkBytes,
    fonts,
    projectRoot: projectRoot ?? process.cwd(),
    mediaDir: mediaDir ?? "media",
    errorPolicy: frameErrorPolicy ?? "placeholder",
    plugins: workerPlugins,
    extensions: extensionDescriptor,
    binaries,
    verbose,
    cacheProvider: async (request: { key: string }) => {
      if (!request.key.startsWith("video:")) return undefined;
      const at = request.key.lastIndexOf("@");
      const src = request.key.slice("video:".length, at);
      const sourceFrame = Number(request.key.slice(at + 1));
      if (!Number.isFinite(sourceFrame)) return undefined;
      const frame = await decodeService.requestFrame(src, sourceFrame);
      return {
        data: frame.buffer,
        width: frame.width,
        height: frame.height,
        format: frame.format,
      };
    },
    batchCacheProvider: async (keys: readonly string[]) => {
      const results = new Map<string, { data: Buffer; width?: number; height?: number; format?: "rgba" | "rgb24" }>();
      const bySrc = new Map<string, number[]>();
      for (const key of keys) {
        if (!key.startsWith("video:")) continue;
        const at = key.lastIndexOf("@");
        const src = key.slice("video:".length, at);
        const sourceFrame = Number(key.slice(at + 1));
        if (!Number.isFinite(sourceFrame)) continue;
        const list = bySrc.get(src) ?? [];
        list.push(sourceFrame);
        bySrc.set(src, list);
      }
      for (const [src, frameIndices] of bySrc.entries()) {
        const decodedMap = await decodeService.requestFrames(src, frameIndices);
        for (const [frameIdx, decoded] of decodedMap.entries()) {
          results.set(`video:${src}@${frameIdx}`, {
            data: decoded.buffer,
            width: decoded.width,
            height: decoded.height,
            format: decoded.format,
          });
        }
      }
      return results;
    },
    onMemoryWarning: (usage: number, budget: number) => {
      onWarning(
        `[CC7100] render chunk memory usage at ${formatBytes(usage)} of ${formatBytes(budget)} — reducing chunk size is recommended`,
      );
    },
  };

  return inProcess
    ? createInProcessFrameManager(workerManagerOptions)
    : createWorkerManager(workerManagerOptions);
}
