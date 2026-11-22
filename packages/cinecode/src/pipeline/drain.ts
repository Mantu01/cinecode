import { logger } from "../observability/logger.js";
import { createError, ErrorCode } from "../errors/index.js";

export interface DrainOptions {
  drainTimeoutSeconds?: number;
  onDrainStart?: () => Promise<void> | void;
  onFinishInFlight?: () => Promise<void> | void;
  onFinalizeContainer?: () => Promise<void> | void;
  onTerminateWorkers?: () => Promise<void> | void;
}

export class GracefulDrainManager {
  private isDraining = false;
  private readonly timeoutMs: number;
  private readonly options: DrainOptions;

  constructor(options: DrainOptions = {}) {
    this.options = options;
    this.timeoutMs = (options.drainTimeoutSeconds ?? 30) * 1000;
  }

  get draining(): boolean {
    return this.isDraining;
  }

  registerSignalHandlers(): void {
    const handleSignal = (signal: string) => {
      if (this.isDraining) return;
      logger.warn("drain", `Received ${signal}, initiating graceful shutdown and worker drain...`);
      void this.executeDrain(signal);
    };

    process.once("SIGTERM", () => handleSignal("SIGTERM"));
    process.once("SIGINT", () => handleSignal("SIGINT"));
  }

  async executeDrain(signal = "SIGTERM"): Promise<void> {
    this.isDraining = true;
    let timedOut = false;

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      logger.error("drain", `Graceful drain timed out after ${this.timeoutMs / 1000}s.`);
    }, this.timeoutMs);

    try {
      if (this.options.onDrainStart) {
        await this.options.onDrainStart();
      }

      if (this.options.onFinishInFlight) {
        logger.info("drain", "Waiting for in-flight workers to complete active chunk...");
        await this.options.onFinishInFlight();
      }

      if (this.options.onFinalizeContainer) {
        logger.info("drain", "Finalizing container output stream...");
        await this.options.onFinalizeContainer();
      }

      if (this.options.onTerminateWorkers) {
        await this.options.onTerminateWorkers();
      }

      clearTimeout(timeoutTimer);
      if (timedOut) {
        throw createError(ErrorCode.CC4003, { details: `Graceful drain timed out after ${this.timeoutMs / 1000}s` });
      }
      logger.info("drain", "Graceful shutdown complete.");
    } catch (err: unknown) {
      clearTimeout(timeoutTimer);
      logger.error("drain", `Error during graceful drain: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}
