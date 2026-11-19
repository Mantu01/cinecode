import { logger } from "../observability/logger.js";

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

    const timeoutTimer = setTimeout(() => {
      logger.error("drain", `Graceful drain timed out after ${this.timeoutMs / 1000}s, forcing exit.`);
      process.exit(143);
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
      logger.info("drain", "Graceful shutdown complete.");
      process.exit(0);
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      logger.error("drain", `Error during graceful drain: ${err.message}`);
      process.exit(1);
    }
  }
}
