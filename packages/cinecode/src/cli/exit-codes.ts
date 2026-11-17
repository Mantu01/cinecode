import { ErrorCode } from "../errors/codes.js";

/** One exit-code table for every command. */
export const EXIT_CODES = {
  success: 0,
  runtime: 1,
  usage: 2,
  validation: 3,
  environment: 4,
  cancelled: 130,
} as const;

export type ExitCodeName = keyof typeof EXIT_CODES;

export const EXIT_CODE_MEANINGS: Readonly<Record<ExitCodeName, string>> = {
  success: "command completed",
  runtime: "render, pipeline or unexpected failure",
  usage: "invalid arguments, flags or command",
  validation: "config, media, timeline or plugin validation failure",
  environment: "missing binary, unsupported runtime or network failure",
  cancelled: "cancelled by user or timeout",
};

const VALIDATION_PREFIXES = ["CC1", "CC2", "CC3", "CC8"];
const ENVIRONMENT_PREFIXES = ["CC6", "CC7"];

/** Thrown by command bodies that end the run without an error object. */
export class ExitSignal extends Error {
  constructor(readonly exitCode: number, message = "command stopped") {
    super(message);
    this.name = "ExitSignal";
  }
}

export function exitCodeForError(code: ErrorCode | string): number {
  if (code === ErrorCode.CC4003) return EXIT_CODES.cancelled;
  if (code === ErrorCode.CC0001 || code === ErrorCode.CC1014) return EXIT_CODES.usage;
  if (VALIDATION_PREFIXES.some((prefix) => code.startsWith(prefix))) return EXIT_CODES.validation;
  if (ENVIRONMENT_PREFIXES.some((prefix) => code.startsWith(prefix))) return EXIT_CODES.environment;
  return EXIT_CODES.runtime;
}
