import type { Worker } from "node:worker_threads";
import { createError, ErrorCode } from "../errors/codes.js";
import type { ChunkIdentity } from "./chunk-identity.js";
import type { ActiveWorker, TransportOutput } from "./worker-types.js";
import { normalizeWorkerResult } from "./worker-lifecycle.js";

export interface WorkerSocketHost {
  readonly activeFor: (worker: Worker) => ActiveWorker | undefined;
  readonly removeActive: (worker: Worker) => ActiveWorker | undefined;
  readonly dropReservation: (identity: ChunkIdentity, bytes: number) => void;
  readonly countFailure: () => void;
  readonly countTransfer: () => void;
  readonly isTerminated: () => boolean;
}

export function bindWorkerEvents(worker: Worker, host: WorkerSocketHost): void {
  worker.on("message", (output: TransportOutput) => {
    const msgType = (output as { type?: string }).type;
    if (msgType === "cache-request" || msgType === "cache-batch-request") return;
    const active = host.activeFor(worker);
    if (active) {
      active.internalResolve(
        normalizeWorkerResult(output, active.identity, host.countTransfer),
      );
    }
  });

  worker.on("error", (error) => {
    host.countFailure();
    const active = host.removeActive(worker);
    if (active) {
      host.dropReservation(active.identity, active.estimatedBytes);
      active.internalReject(
        createError(
          ErrorCode.CC4001,
          { frame: active.chunkIndex, source: "worker", reason: error.message },
          { cause: error },
        ),
      );
    }
  });

  worker.on("exit", (code) => {
    const active = host.removeActive(worker);
    if (!active) return;
    host.dropReservation(active.identity, active.estimatedBytes);
    if (code !== 0 && !host.isTerminated()) {
      active.internalReject(
        createError(ErrorCode.CC4001, {
          frame: active.chunkIndex,
          source: "worker",
          reason: `Worker exited unexpectedly with code ${code}`,
        }),
      );
    } else {
      active.internalReject(createError(ErrorCode.CC4003, { details: "worker pool terminated" }));
    }
  });
}
