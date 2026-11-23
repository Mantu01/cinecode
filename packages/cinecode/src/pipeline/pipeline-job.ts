import type { ProgressHandler } from "./progress.js";
import type { RenderJob, RenderOptions, RenderResult } from "./pipeline-types.js";

export function createRenderJob(
  options: RenderOptions,
  executor: (opts: RenderOptions) => Promise<RenderResult>,
): RenderJob {
  const controller = new AbortController();
  const handlers = new Map<string, Set<ProgressHandler>>();

  const jobPromise = (async () => {
    return executor({
      ...options,
      signal: options.signal ?? controller.signal,
      onProgress: (event) => {
        for (const handler of handlers.get(event.type) ?? []) handler(event);
        if (event.type !== "progress") {
          for (const handler of handlers.get("progress") ?? []) handler(event);
        }
      },
    });
  })();

  return {
    promise: jobPromise,
    async cancel() {
      if (!controller.signal.aborted) controller.abort();
      await jobPromise.catch(() => undefined);
    },
    on(event: string, handler: ProgressHandler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off(event: string, handler: ProgressHandler) {
      handlers.get(event)?.delete(handler);
    },
  };
}
