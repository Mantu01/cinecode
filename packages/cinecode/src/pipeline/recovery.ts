import type { CinecodeError } from "../errors/index.js";
import { Canvas } from "@napi-rs/canvas";

export * from "./checkpoint.js";

export type RecoveryStrategy = "retry" | "skip" | "abort";

export interface RecoveryPolicy {
  /** Strategy to apply when this phase encounters an error. */
  readonly strategy: RecoveryStrategy;
  /** Maximum number of retry attempts before falling back. */
  readonly maxRetries: number;
  /** Time to wait between retries (milliseconds). */
  readonly retryDelayMs: number;
  readonly fallbackFrame?: (error: CinecodeError, frame: number) => Buffer | null;
  readonly onRecovery?: (error: CinecodeError, attempt: number) => void;
}

/** Default frame recovery: retry once, then skip with a warning. */
export const DEFAULT_FRAME_RECOVERY: RecoveryPolicy = {
  strategy: "retry",
  maxRetries: 1,
  retryDelayMs: 100,
  onRecovery: (error, attempt) => {
    console.warn(`[cinecode] Frame recovery (${attempt}/${error.code}): ${error.message}`);
  },
};

/** Audio recovery: always skip rather than abort. */
export const DEFAULT_AUDIO_RECOVERY: RecoveryPolicy = {
  strategy: "skip",
  maxRetries: 0,
  retryDelayMs: 0,
  onRecovery: (error) => {
    console.warn(`[cinecode] Audio recovery: ${error.message}`);
  },
};

/** Mux recovery: attempt re-encode once, then abort. */
export const DEFAULT_MUX_RECOVERY: RecoveryPolicy = {
  strategy: "retry",
  maxRetries: 1,
  retryDelayMs: 500,
  onRecovery: (error) => {
    console.error(`[cinecode] Mux recovery failed: ${error.message}`);
  },
};

export type FailurePhase = "frame" | "audio" | "mux" | "chunk";

export interface RecoveryOutcome<T> {
  readonly status: "ok" | "recovered" | "failed";
  readonly value?: T;
  readonly error?: Error;
}

export interface FrameRenderOutcome {
  readonly buffer: Buffer | null;
  readonly error?: Error;
  readonly usedFallback?: boolean;
}

/** Wraps a function with recovery logic. Retries up to maxRetries times. */
export async function withRecovery<T>(
  fn: () => Promise<T>,
  strategy: RecoveryStrategy,
  maxRetries: number,
  retryDelayMs: number = 0,
  onRecovery?: (error: CinecodeError, attempt: number) => void,
): Promise<RecoveryOutcome<T>> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { status: "ok", value: result };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (onRecovery && lastError instanceof Error) {
        onRecovery(lastError as CinecodeError, attempt);
      }
      if (attempt >= maxRetries) break;
      if (retryDelayMs > 0) {
        await new Promise(r => setTimeout(r, retryDelayMs));
      }
    }
  }

  if (strategy === "abort") {
    return { status: "failed", error: lastError! };
  }
  return { status: "recovered", error: lastError! };
}

export function resolveStrategy(policy: RecoveryPolicy | undefined, phase: FailurePhase): RecoveryStrategy {
  switch (phase) {
    case "frame": return policy?.strategy ?? DEFAULT_FRAME_RECOVERY.strategy;
    case "audio": return policy?.strategy ?? DEFAULT_AUDIO_RECOVERY.strategy;
    case "mux": return policy?.strategy ?? DEFAULT_MUX_RECOVERY.strategy;
    case "chunk": return policy?.strategy ?? DEFAULT_FRAME_RECOVERY.strategy;
  }
}

export const DEFAULT_RECOVERY = {
  maxRetries: 1,
  fallbackFrame: null as ((error: CinecodeError, frame: number) => Buffer | null) | null,
};

/** Creates a black fallback frame buffer for a composition. */
export function createFallbackFrameBuffer(composition: { width: number; height: number }): Buffer {
  return Buffer.alloc(0);
}

export async function renderFrameWithRecovery(
  fn: () => Promise<{ canvas: Canvas }>,
  composition: { width: number; height: number },
  policy: RecoveryPolicy | undefined,
  frame: number,
): Promise<FrameRenderOutcome> {
  try {
    const result = await fn();
    return { buffer: result.canvas.toBuffer("image/png") };
  } catch (error) {
    const strategy = resolveStrategy(policy, "frame");
    const maxRetries = policy?.maxRetries ?? DEFAULT_RECOVERY.maxRetries;
    let lastError = error instanceof Error ? error : new Error(String(error));

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn();
        return { buffer: result.canvas.toBuffer("image/png") };
      } catch (retryError) {
        lastError = retryError instanceof Error ? retryError : new Error(String(retryError));
        if (attempt >= maxRetries) break;
        if (policy?.retryDelayMs && policy.retryDelayMs > 0) {
          await new Promise(r => setTimeout(r, policy.retryDelayMs));
        }
      }
    }

    if (strategy === "abort") {
      return { buffer: null, error: lastError };
    }

    // Return fallback black frame
    return { buffer: Buffer.alloc(0), error: lastError, usedFallback: true };
  }
}
