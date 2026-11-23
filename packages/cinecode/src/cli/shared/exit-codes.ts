import { ErrorCode } from "../../errors/codes.js";

/** One exit-code table for every command. */
export const EXIT_CODES = {
  success: 0,
  runtime: 1,
  usage: 2,
  validation: 3,
  environment: 4,
  unsupportedRuntime: 78,
  cancelled: 130,
} as const;

export const RUNTIME_EXIT_CODE = EXIT_CODES.unsupportedRuntime;

export type ExitCodeName = keyof typeof EXIT_CODES;

export const EXIT_CODE_MEANINGS: Readonly<Record<ExitCodeName, string>> = {
  success: "command completed",
  runtime: "render, pipeline or unexpected failure",
  usage: "invalid arguments, flags or command",
  validation: "config, media, timeline or plugin validation failure",
  environment: "missing binary or network failure",
  unsupportedRuntime: "Node.js version below the declared minimum (exit 78, no other work done)",
  cancelled: "cancelled by user or timeout",
};

/**
 * The closed mapping from error code to exit code. Longest prefix wins, so an
 * exception such as `CC1014` must sit before the `CC1` validation family.
 * A code that matches no prefix is a defect, not an implicit runtime failure;
 * `exitCodeForError` reports it as runtime and the tests enumerate every code.
 */
export const EXIT_CODE_RULES: ReadonlyArray<{ readonly prefix: string; readonly exit: ExitCodeName }> = [
  { prefix: "CC7001", exit: "unsupportedRuntime" },
  { prefix: "CC1014", exit: "usage" },
  { prefix: "CC0001", exit: "usage" },
  { prefix: "CC4003", exit: "cancelled" },
  { prefix: "CC1", exit: "validation" },
  { prefix: "CC2", exit: "validation" },
  { prefix: "CC3", exit: "validation" },
  { prefix: "CC8", exit: "validation" },
  { prefix: "CC6", exit: "environment" },
  { prefix: "CC7", exit: "environment" },
  { prefix: "CC4", exit: "runtime" },
  { prefix: "CC5", exit: "runtime" },
  { prefix: "CC9", exit: "runtime" },
];

/** Thrown by command bodies that end the run without an error object. */
export class ExitSignal extends Error {
  constructor(readonly exitCode: number, message = "command stopped") {
    super(message);
    this.name = "ExitSignal";
  }
}

export class CancellationSignal extends ExitSignal {
  readonly isCancellation = true;
  constructor(message = "operation cancelled") {
    super(EXIT_CODES.cancelled, message);
    this.name = "CancellationSignal";
  }
}

export function isCancellation(error: unknown): boolean {
  if (error instanceof CancellationSignal) return true;
  if (error instanceof ExitSignal && error.exitCode === EXIT_CODES.cancelled) return true;
  if (typeof error === "object" && error !== null && (error as { isCancellation?: boolean }).isCancellation === true) return true;
  const code = (error as { code?: unknown })?.code;
  if (code === ErrorCode.CC4003 || code === "CC4003") return true;
  return false;
}

export function exitCodeForError(code: ErrorCode | string): number {
  if (typeof code !== "string" || !code) return EXIT_CODES.runtime;
  const matching = EXIT_CODE_RULES.filter((entry) => code.startsWith(entry.prefix));
  if (matching.length === 0) return EXIT_CODES.runtime;
  const effective = [...matching].sort((a, b) => b.prefix.length - a.prefix.length)[0]!;
  return EXIT_CODES[effective.exit] ?? EXIT_CODES.runtime;
}
