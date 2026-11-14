export type TerminationSignal = "SIGINT" | "SIGTERM";

export interface CancellationOptions {
  readonly onCancel: (signal: TerminationSignal) => Promise<void> | void;
  readonly gracePeriodMs?: number;
  readonly exitCodes?: Partial<Record<TerminationSignal, number>>;
  readonly forceExitCode?: number;
  readonly exitProcess?: boolean;
  readonly onForceExit?: (signal: TerminationSignal) => void;
}

export const DEFAULT_SIGNAL_EXIT_CODES: Readonly<Record<TerminationSignal, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

export class CancellationController {
  private readonly options: CancellationOptions;
  private installed = false;
  private cancelRequested = false;
  private completing = false;
  private pressCount = 0;
  private readonly handler = (signal: TerminationSignal): void => {
    void this.handleSignal(signal);
  };

  constructor(options: CancellationOptions) {
    this.options = options;
  }

  get cancelled(): boolean {
    return this.cancelRequested;
  }

  install(): void {
    if (this.installed) return;
    this.installed = true;
    process.on("SIGINT", this.handler);
    process.on("SIGTERM", this.handler);
  }

  dispose(): void {
    if (!this.installed) return;
    this.installed = false;
    process.off("SIGINT", this.handler);
    process.off("SIGTERM", this.handler);
  }

  private exitCodeFor(signal: TerminationSignal): number {
    return this.options.exitCodes?.[signal] ?? DEFAULT_SIGNAL_EXIT_CODES[signal];
  }

  private async handleSignal(signal: TerminationSignal): Promise<void> {
    this.pressCount += 1;
    if (this.pressCount > 1 || this.completing) {
      this.options.onForceExit?.(signal);
      if (this.options.exitProcess !== false) process.exit(this.options.forceExitCode ?? 1);
      return;
    }
    this.completing = true;
    await this.cancel(signal);
    if (this.options.exitProcess !== false) process.exit(this.exitCodeFor(signal));
  }

  async cancel(signal: TerminationSignal = "SIGINT"): Promise<void> {
    if (this.cancelRequested) return;
    this.cancelRequested = true;
    const gracePeriod = Math.max(0, this.options.gracePeriodMs ?? 3000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, gracePeriod);
    });
    try {
      await Promise.race([Promise.resolve(this.options.onCancel(signal)), timeout]);
    } catch {
      void 0;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

export function createCancellationController(options: CancellationOptions): CancellationController {
  return new CancellationController(options);
}

export function installSignalHandlers(options: CancellationOptions): CancellationController {
  const controller = new CancellationController(options);
  controller.install();
  return controller;
}
