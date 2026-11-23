import type { Worker } from "node:worker_threads";
import { createError, ErrorCode } from "../errors/codes.js";
import type { ActiveWorker, QueuedChunk } from "./worker-types.js";

export interface ShutdownHost {
  readonly cacheChannelCleanups: (() => void)[];
  readonly takeActive: () => ActiveWorker[];
  readonly releaseReservations: () => void;
  readonly takeQueue: () => QueuedChunk[];
  readonly notifyBudget: () => void;
  readonly takeWorkers: () => Worker[];
}

export async function shutdownWorkerPool(host: ShutdownHost): Promise<void> {
  for (const detach of host.cacheChannelCleanups) {
    try {
      detach();
    } catch {}
  }
  host.cacheChannelCleanups.length = 0;

  for (const entry of host.takeActive()) {
    entry.reject(createError(ErrorCode.CC4003, { details: "worker pool terminated" }));
    entry.internalReject(createError(ErrorCode.CC4003, { details: "worker pool terminated" }));
  }
  host.releaseReservations();

  for (const item of host.takeQueue()) {
    item.reject(createError(ErrorCode.CC4003, { details: "worker pool terminated" }));
  }
  host.notifyBudget();

  const workers = host.takeWorkers();
  for (const worker of workers) {
    try {
      worker.postMessage({ type: "shutdown" });
    } catch {}
  }
  await Promise.all(workers.map((worker) => worker.terminate()));
}
