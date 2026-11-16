import { loadUserModule, resolveUserModule } from "../loader/index.js";
import type { LoadUserModuleOptions } from "../loader/index.js";

export type LoadModuleOptions = LoadUserModuleOptions;

export function resolveEntryFile(file: string, rootDir: string): string {
  return resolveUserModule(file, rootDir);
}

export async function loadModuleFile<T>(file: string, baseDir: string, options: LoadModuleOptions = {}): Promise<T> {
  return loadUserModule<T>(file, baseDir, options);
}

export async function loadDefault(file: string, baseDir: string, options: LoadModuleOptions = {}): Promise<unknown> {
  return loadUserModule<unknown>(file, baseDir, options);
}
