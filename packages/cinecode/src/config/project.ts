import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createError, ErrorCode } from "../errors/index.js";

export const CONFIG_FILENAMES = [
  "cinecode.config.ts",
  "cinecode.config.js",
  "cinecode.config.mjs",
  "cinecode.config.json",
] as const;

/** Discovery never crosses a directory carrying one of these markers. */
export const PROJECT_MARKERS = ["package.json", ".git"] as const;

export type ConfigSource = "root-flag" | "config-flag" | "discovered";

export interface ProjectLocation {
  readonly root: string;
  readonly configPath: string;
  readonly source: ConfigSource;
}

export interface ProjectLocationOptions {
  readonly root?: string;
  readonly config?: string;
  readonly cwd?: string;
}

function configIn(dir: string): string | null {
  for (const filename of CONFIG_FILENAMES) {
    const candidate = resolve(dir, filename);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function isProjectMarker(dir: string): boolean {
  return PROJECT_MARKERS.some((marker) => existsSync(join(dir, marker)));
}

/** Finds a config from `startDir` upward, stopping at the project marker. */
export function findConfigUpward(startDir: string): string | null {
  let current = resolve(startDir);
  for (;;) {
    const found = configIn(current);
    if (found) return found;
    if (isProjectMarker(current)) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Explicit root, explicit config, then bounded upward search. */
export function resolveProjectLocation(options: ProjectLocationOptions = {}): ProjectLocation {
  const cwd = resolve(options.cwd ?? process.cwd());

  if (options.root) {
    const root = resolve(cwd, options.root);
    const configPath = options.config ? resolve(root, options.config) : configIn(root) ?? resolve(root, CONFIG_FILENAMES[0]);
    return { root, configPath, source: "root-flag" };
  }

  if (options.config) {
    const configPath = isAbsolute(options.config) ? options.config : resolve(cwd, options.config);
    return { root: dirname(configPath), configPath, source: "config-flag" };
  }

  const configPath = findConfigUpward(cwd);
  if (!configPath) {
    throw createError(
      ErrorCode.CC1005,
      {
        path: cwd,
        reason: `No cinecode config found (${CONFIG_FILENAMES.join(", ")}). Run from a project directory or pass --root/--config.`,
      },
      {
        location: { file: cwd },
        fixHint: `Pass --root <dir> or --config <path>, or create cinecode.config.ts. Discovery stops at ${PROJECT_MARKERS.join(" or ")} and never searches parent projects.`,
      },
    );
  }
  return { root: dirname(configPath), configPath, source: "discovered" };
}
