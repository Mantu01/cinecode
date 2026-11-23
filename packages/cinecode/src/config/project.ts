import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createError, ErrorCode } from "../errors/index.js";

export const CONFIG_FILENAMES = [
  "cinecode.config.ts",
  "cinecode.config.js",
  "cinecode.config.mjs",
  "cinecode.config.cjs",
  "cinecode.config.mts",
  "cinecode.config.cts",
  "cinecode.json",
] as const;

/** Discovery never crosses a directory carrying one of these markers. */
export const PROJECT_MARKERS = ["package.json", ".git"] as const;

export type ConfigSource = "root-flag" | "config-flag" | "discovered";

export interface ProjectLocation {
  readonly root: string;
  readonly configPath: string;
  readonly source: ConfigSource;
  readonly searched?: readonly string[];
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

export function findConfigUpwardDetailed(startDir: string): { configPath: string | null; searched: string[] } {
  let current = resolve(startDir);
  const searched: string[] = [];
  for (;;) {
    searched.push(current);
    const found = configIn(current);
    if (found) return { configPath: found, searched };
    if (isProjectMarker(current)) return { configPath: null, searched };
    const parent = dirname(current);
    if (parent === current) return { configPath: null, searched };
    current = parent;
  }
}

/** Finds a config from `startDir` upward, stopping at the project marker. */
export function findConfigUpward(startDir: string): string | null {
  return findConfigUpwardDetailed(startDir).configPath;
}

/** Explicit config, explicit root, then bounded upward search. */
export function resolveProjectLocation(options: ProjectLocationOptions = {}): ProjectLocation {
  const cwd = resolve(options.cwd ?? process.cwd());

  // 1. Explicit config path wins or combines with explicit root
  if (options.config) {
    const configPath = isAbsolute(options.config) ? options.config : resolve(cwd, options.config);
    if (!existsSync(configPath)) {
      throw createError(ErrorCode.CC1005, { path: configPath, reason: `Config file does not exist: ${configPath}` });
    }
    const lower = configPath.toLowerCase();
    if (lower.endsWith(".cinecode.ts") || lower.endsWith(".composition.ts")) {
      throw createError(ErrorCode.CC1002, {
        key: "config",
        reason: `Specified path '${options.config}' is a composition, not a config file. Use a cinecode.config.ts file.`,
      });
    }

    const derivedRoot = dirname(configPath);
    if (options.root) {
      const root = resolve(cwd, options.root);
      if (!existsSync(root)) {
        throw createError(ErrorCode.CC1005, { path: root, reason: `Project root directory does not exist: ${root}` });
      }
      if (root !== derivedRoot) {
        throw createError(
          ErrorCode.CC0001,
          {
            reason: `Conflicting --root and --config options: root '${root}' does not match config directory '${derivedRoot}'`,
          },
          { fixHint: "Ensure --config is located in --root, or specify only one of --root and --config." },
        );
      }
      return { root, configPath, source: "config-flag" };
    }

    return { root: derivedRoot, configPath, source: "config-flag" };
  }

  // 2. Explicit root requires a canonical config inside it
  if (options.root) {
    const root = resolve(cwd, options.root);
    if (!existsSync(root)) {
      throw createError(ErrorCode.CC1005, { path: root, reason: `Project root directory does not exist: ${root}` });
    }
    const configPath = configIn(root);
    if (!configPath) {
      throw createError(
        ErrorCode.CC1005,
        {
          path: root,
          reason: `No cinecode configuration found in ${root}. Looked for: ${CONFIG_FILENAMES.join(", ")}`,
        },
        { location: { file: root } },
      );
    }
    return { root, configPath, source: "root-flag" };
  }

  // 3. Upward bounded walk from cwd stopping before crossing package.json or .git
  const { configPath, searched } = findConfigUpwardDetailed(cwd);
  if (!configPath) {
    throw createError(
      ErrorCode.CC1005,
      {
        path: cwd,
        reason: `No cinecode config found (${CONFIG_FILENAMES.join(", ")}). Searched: ${searched.join(", ")}`,
      },
      {
        location: { file: cwd },
        fixHint: `Pass --root <dir> or --config <path>, or create ${CONFIG_FILENAMES[0]}. Discovery stops at ${PROJECT_MARKERS.join(" or ")} and never searches parent projects.`,
      },
    );
  }
  return { root: dirname(configPath), configPath, source: "discovered", searched };
}
