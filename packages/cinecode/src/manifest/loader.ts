import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";

export interface LoadModuleOptions {
  /** Append a cache-busting query so HMR picks up edits. */
  readonly fresh?: boolean;
}

/** Resolves an entry file path against a project root. */
export function resolveEntryFile(file: string, rootDir: string): string {
  return isAbsolute(file) ? file : resolve(rootDir, file);
}

let importCounter = 0;

/**
 * Imports an isolated asset module. Works for `.js`, `.mjs`, `.cjs` and (on
 * Node 22.6+/23+) `.ts` files through native type stripping. The source file's
 * own relative imports must carry their real extension (e.g. `./theme.ts`).
 */
export async function loadModuleFile<T>(file: string, baseDir: string, options: LoadModuleOptions = {}): Promise<T> {
  const resolved = resolveEntryFile(file, baseDir);
  if (!existsSync(resolved)) {
    throw new Error(`Module file not found: ${resolved}`);
  }
  const url = pathToFileURL(resolved);
  if (options.fresh) {
    url.searchParams.set("t", String(Date.now()) + "-" + importCounter++);
  }
  const module = (await import(url.href)) as Record<string, unknown>;
  return (module.default ?? module) as T;
}

/** Returns the default export of a module as an unknown value. */
export async function loadDefault(file: string, baseDir: string, options: LoadModuleOptions = {}): Promise<unknown> {
  return loadModuleFile<unknown>(file, baseDir, options);
}
