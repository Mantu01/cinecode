import type { Worker } from "node:worker_threads";
import type { FrameChunk } from "./chunk-identity.js";
import type { ActiveWorker, QueuedChunk, WorkerResult } from "./worker-types.js";
import type { ChunkReservations } from "./worker-reservations.js";

export interface QueueRunnerHost {
  readonly workers: Worker[];
  readonly activeWorkers: ActiveWorker[];
  readonly workQueue: QueuedChunk[];
  readonly reservations: ChunkReservations;
  readonly isTerminated: () => boolean;
  readonly beforeChunk: (hook: QueuedChunk["onBeforeChunk"], chunk: FrameChunk) => Promise<void>;
  readonly dispatch: (
    worker: Worker,
    chunk: FrameChunk,
    estimatedBytes: number,
    resolve: (result: WorkerResult) => void,
    reject: (error: Error) => void,
    onChunk?: (result: WorkerResult) => Promise<void> | void,
  ) => void;
  readonly recordSuccess: (value: WorkerResult) => void;
  readonly recordFailure: () => void;
  readonly setBudgetNotifier: (cb: (() => void) | undefined) => void;
}

export async function executeWorkQueue(host: QueueRunnerHost): Promise<number> {
  const started = Date.now();
  const freeWorkers: Worker[] = host.workers.filter(
    (w) => !host.activeWorkers.some((a) => a.worker === w),
  );

  const dispatchNext = async (worker: Worker): Promise<boolean> => {
    if (host.workQueue.length === 0) return false;
    const candidate = host.workQueue[0]!;
    const reserved = host.reservations.tryReserve(candidate.chunk);
    if (reserved === null) return false;
    host.workQueue.shift();
    await host.beforeChunk(candidate.onBeforeChunk, candidate.chunk);
    host.dispatch(worker, candidate.chunk, reserved, candidate.resolve, candidate.reject, candidate.onChunk);
    return true;
  };

  while (!host.isTerminated() && freeWorkers.length > 0 && (await dispatchNext(freeWorkers[0]!))) {
    freeWorkers.shift();
  }

  while (!host.isTerminated() && (host.activeWorkers.length > 0 || host.workQueue.length > 0)) {
    if (host.activeWorkers.length === 0 && host.workQueue.length > 0) {
      const head = host.workQueue[0]!;
      const worker = freeWorkers.shift();
      if (!worker) break;
      const reserved = await host.reservations.reserve(head.chunk);
      host.workQueue.shift();
      await host.beforeChunk(head.onBeforeChunk, head.chunk);
      host.dispatch(worker, head.chunk, reserved, head.resolve, head.reject, head.onChunk);
      while (!host.isTerminated() && freeWorkers.length > 0 && (await dispatchNext(freeWorkers[0]!))) {
        freeWorkers.shift();
      }
      continue;
    }

    type RaceResult =
      | { kind: "worker"; value: WorkerResult; active: ActiveWorker }
      | { kind: "worker_error"; error: Error; active: ActiveWorker }
      | { kind: "budget" };

    const raced: Promise<RaceResult>[] = host.activeWorkers.map((a) =>
      a.promise.then(
        (value): RaceResult => ({ kind: "worker", value, active: a }),
        (error): RaceResult => ({ kind: "worker_error", error, active: a }),
      ),
    );

    if (freeWorkers.length > 0 && host.workQueue.length > 0) {
      raced.push(
        new Promise<RaceResult>((resolve) => {
          host.setBudgetNotifier(() => resolve({ kind: "budget" }));
        }),
      );
    }

    const winner = await Promise.race(raced);
    if (winner.kind === "budget") {
      while (!host.isTerminated() && freeWorkers.length > 0 && (await dispatchNext(freeWorkers[0]!))) {
        freeWorkers.shift();
      }
      continue;
    }

    const completed = winner.active;
    const completedIndex = host.activeWorkers.indexOf(completed);
    if (completedIndex >= 0) {
      host.activeWorkers.splice(completedIndex, 1);
      freeWorkers.push(completed.worker);
    }

    if (winner.kind === "worker_error") {
      completed.reject(winner.error);
    } else {
      host.recordSuccess(winner.value);
      try {
        if (completed.onChunk) await completed.onChunk(winner.value);
      } catch (error) {
        completed.reject(error instanceof Error ? error : new Error(String(error)));
        continue;
      }
      completed.resolve(winner.value);
    }

    while (!host.isTerminated() && freeWorkers.length > 0 && (await dispatchNext(freeWorkers[0]!))) {
      freeWorkers.shift();
    }
  }

  return Date.now() - started;
}
