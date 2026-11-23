import { ErrorCode } from "./code-enum.js";
export { ErrorCode } from "./code-enum.js";
import { ErrorMessages, FIX_HINTS } from "./catalog.js";
export { ErrorMessages, FIX_HINTS } from "./catalog.js";
export { formatError, categorizeError, formatErrorReport } from "./format.js";

export interface ErrorLocation {
  file?: string;
  line?: number;
  column?: number;
  clip?: string;
  track?: string;
  time?: string;
}

export interface CinecodeError extends Error {
  code: ErrorCode;
  location?: ErrorLocation;
  fixHint?: string;
  severity: "error" | "warning";
  cause?: unknown;
}

export interface ErrorOptions {
  readonly location?: ErrorLocation;
  readonly fixHint?: string;
  readonly severity?: "error" | "warning";
  readonly cause?: unknown;
}

export function createError(
  code: ErrorCode,
  params: Record<string, string | number> = {},
  options: ErrorOptions = {},
): CinecodeError {
  let message = ErrorMessages[code] ?? "Unknown error";
  if (code === ErrorCode.CC1001) {
    if (params.key) {
      message = `Configuration missing required key: ${params.key}`;
    } else {
      message = `Configuration missing required key${params.reason ? `: ${params.reason}` : ""}`;
    }
  } else {
    for (const [key, value] of Object.entries(params)) {
      message = message.split(`{${key}}`).join(String(value).replace(/[{}]/g, "\\$&"));
    }
  }

  const error = new Error(message, options.cause === undefined ? undefined : { cause: options.cause }) as CinecodeError;
  error.code = code;
  error.location = options.location;
  error.fixHint = options.fixHint ?? FIX_HINTS[code];
  error.severity = options.severity ?? "error";
  return error;
}

export function wrapError(
  error: unknown,
  code: ErrorCode,
  params: Record<string, string | number> = {},
  options: ErrorOptions = {},
): CinecodeError {
  if (isCinecodeError(error)) return error;
  return createError(code, params, { ...options, cause: options.cause ?? error });
}

export function errorPath(error: CinecodeError): string | undefined {
  return error.location?.file;
}

export function isCinecodeError(error: unknown): error is CinecodeError {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^CC\d{4}$/.test(code);
}
