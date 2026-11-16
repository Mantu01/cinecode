import { existsSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export * from "./runtime.js";

const MODULE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);

export type UserModuleErrorCode =
  | "USER_MODULE_NOT_FOUND"
  | "USER_MODULE_IMPORT_NOT_FOUND"
  | "USER_MODULE_UNSUPPORTED_SYNTAX"
  | "USER_MODULE_UNKNOWN_EXTENSION"
  | "USER_MODULE_LOAD_FAILED";

export class UserModuleError extends Error {
  readonly code: UserModuleErrorCode;
  readonly file: string;

  constructor(code: UserModuleErrorCode, file: string, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "UserModuleError";
    this.code = code;
    this.file = file;
  }
}

export interface LoadUserModuleOptions {
  readonly fresh?: boolean;
}

let reloadCounter = 0;
let hotReload = false;

export function setHotReload(enabled: boolean): void {
  hotReload = enabled;
}

export function hotReloadEnabled(): boolean {
  return hotReload;
}

export function isUserModuleFile(file: string): boolean {
  return MODULE_EXTENSIONS.has(extname(file).toLowerCase());
}

export function resolveUserModule(file: string, rootDir: string): string {
  return isAbsolute(file) ? file : resolve(rootDir, file);
}

function lineOf(error: unknown): string {
  const stack = error instanceof Error ? error.stack : undefined;
  if (!stack) return "";
  const frame = stack.split("\n").find((line) => line.includes("file://"));
  if (!frame) return "";
  const match = frame.match(/file:\/\/[^:)]+:(\d+):(\d+)/);
  return match ? ` (line ${match[1]}, column ${match[2]})` : "";
}

function toUserModuleError(error: unknown, file: string): UserModuleError {
  const cause = error as { code?: string; message?: string };
  const detail = cause?.message ?? String(error);
  if (cause?.code === "ERR_MODULE_NOT_FOUND") {
    return new UserModuleError(
      "USER_MODULE_IMPORT_NOT_FOUND",
      file,
      `Cannot import from ${file}: ${detail}. Relative imports in user modules must name the file extension, e.g. "./theme.ts".`,
      error,
    );
  }
  if (cause?.code === "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX" || cause?.code === "ERR_UNKNOWN_FILE_EXTENSION") {
    return new UserModuleError(
      "USER_MODULE_UNSUPPORTED_SYNTAX",
      file,
      `Cannot load ${file}: ${detail}. User modules must use erasable TypeScript syntax: no enums, namespaces, parameter properties or decorators.`,
      error,
    );
  }
  return new UserModuleError("USER_MODULE_LOAD_FAILED", file, `Cannot load ${file}${lineOf(error)}: ${detail}`, error);
}

export async function loadUserModule<T = unknown>(
  file: string,
  rootDir: string = process.cwd(),
  options: LoadUserModuleOptions = {},
): Promise<T> {
  const resolved = resolveUserModule(file, rootDir);
  if (!existsSync(resolved)) {
    throw new UserModuleError("USER_MODULE_NOT_FOUND", resolved, `Module not found: ${resolved}`);
  }
  const url = pathToFileURL(resolved);
  if (options.fresh) url.searchParams.set("reload", `${process.pid}-${reloadCounter++}`);
  try {
    const module = (await import(url.href)) as Record<string, unknown>;
    return (module.default ?? module) as T;
  } catch (error) {
    throw toUserModuleError(error, resolved);
  }
}

export async function loadUserModuleNamespace<T = Record<string, unknown>>(
  file: string,
  rootDir: string = process.cwd(),
  options: LoadUserModuleOptions = {},
): Promise<T> {
  const resolved = resolveUserModule(file, rootDir);
  if (!existsSync(resolved)) {
    throw new UserModuleError("USER_MODULE_NOT_FOUND", resolved, `Module not found: ${resolved}`);
  }
  const url = pathToFileURL(resolved);
  if (options.fresh) url.searchParams.set("reload", `${process.pid}-${reloadCounter++}`);
  try {
    return (await import(url.href)) as T;
  } catch (error) {
    throw toUserModuleError(error, resolved);
  }
}
