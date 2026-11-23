import { existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertSupportedRuntime } from "./runtime.js";
import { isCinecodeError } from "../errors/index.js";
import { isVerbose } from "../observability/invocation-context.js";

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

interface CachedModule {
  readonly digest: string;
  readonly namespace: Record<string, unknown>;
}

const MODULE_CACHE_LIMIT = 500;
const moduleCache = new Map<string, CachedModule>();
let cacheHits = 0;
let cacheMisses = 0;
let hotReload = false;

export function fileDigest(file: string): string {
  const stat = statSync(file);
  return createHash("sha1").update(`${stat.mtimeMs}:${stat.size}`).digest("hex").slice(0, 12);
}

export function invalidateUserModules(files: readonly string[]): void {
  for (const file of files) moduleCache.delete(resolve(file));
}

export function disposeUserModuleCache(): void {
  moduleCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

export function getUserModuleCacheStats(): { readonly size: number; readonly hits: number; readonly misses: number } {
  return { size: moduleCache.size, hits: cacheHits, misses: cacheMisses };
}

function cacheNamespace(resolved: string, digest: string, namespace: Record<string, unknown>): void {
  moduleCache.delete(resolved);
  moduleCache.set(resolved, { digest, namespace });
  while (moduleCache.size > MODULE_CACHE_LIMIT) {
    const oldest = moduleCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    moduleCache.delete(oldest);
  }
}

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

/** A coded error raised by the module itself keeps its code and gains the file. */
function userModuleFailure(error: unknown, file: string): Error {
  if (isCinecodeError(error)) {
    if (!error.location?.file) (error as { location?: { file?: string } }).location = { ...error.location, file };
    return error;
  }
  return toUserModuleError(error, file);
}

/** User modules read their own assets relative to the project root, never the caller's cwd. */
async function importFromRoot(url: URL, rootDir: string): Promise<unknown> {
  const previous = process.cwd();
  const target = resolve(rootDir);
  const changed = target !== resolve(previous);
  if (changed) process.chdir(target);
  try {
    return await import(url.href);
  } finally {
    if (changed) process.chdir(previous);
  }
}

export async function loadUserModule<T = unknown>(
  file: string,
  rootDir: string = process.cwd(),
  options: LoadUserModuleOptions = {},
): Promise<T> {
  assertSupportedRuntime();
  const resolved = resolveUserModule(file, rootDir);
  if (!existsSync(resolved)) {
    throw new UserModuleError("USER_MODULE_NOT_FOUND", resolved, `Module not found: ${resolved}`);
  }
  const digest = fileDigest(resolved);
  if (!options.fresh) {
    const cached = moduleCache.get(resolved);
    if (cached && cached.digest === digest) {
      cacheHits += 1;
      return (cached.namespace.default ?? cached.namespace) as T;
    }
  }
  const url = pathToFileURL(resolved);
  url.searchParams.set("v", digest);
  try {
    const module = (await importFromRoot(url, rootDir)) as Record<string, unknown>;
    cacheMisses += 1;
    cacheNamespace(resolved, digest, module);
    if (isVerbose()) process.stderr.write(`[loader] import ${resolved} (v=${digest})\n`);
    return (module.default ?? module) as T;
  } catch (error) {
    throw userModuleFailure(error, resolved);
  }
}

export async function loadUserModuleNamespace<T = Record<string, unknown>>(
  file: string,
  rootDir: string = process.cwd(),
  options: LoadUserModuleOptions = {},
): Promise<T> {
  assertSupportedRuntime();
  const resolved = resolveUserModule(file, rootDir);
  if (!existsSync(resolved)) {
    throw new UserModuleError("USER_MODULE_NOT_FOUND", resolved, `Module not found: ${resolved}`);
  }
  const digest = fileDigest(resolved);
  if (!options.fresh) {
    const cached = moduleCache.get(resolved);
    if (cached && cached.digest === digest) {
      cacheHits += 1;
      return cached.namespace as T;
    }
  }
  const url = pathToFileURL(resolved);
  url.searchParams.set("v", digest);
  try {
    const module = (await importFromRoot(url, rootDir)) as Record<string, unknown>;
    cacheMisses += 1;
    cacheNamespace(resolved, digest, module);
    if (isVerbose()) process.stderr.write(`[loader] import ${resolved} (v=${digest})\n`);
    return module as T;
  } catch (error) {
    throw userModuleFailure(error, resolved);
  }
}
