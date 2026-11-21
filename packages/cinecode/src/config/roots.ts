import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { CinecodeConfig } from "../core/types/index.js";
import { createError, ErrorCode, type CinecodeError } from "../errors/index.js";

export interface ProjectRoots {
  readonly project: string;
  readonly source: string;
  readonly media: string;
  readonly output: string;
  readonly cache: string;
}

export const ROOT_KEYS = ["source", "media", "output", "cache"] as const;

export type RootKey = (typeof ROOT_KEYS)[number];

const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";

/** Resolves one authored root against the project root, never the working directory. */
export function resolveProjectRoots(root: string, config: CinecodeConfig): ProjectRoots {
  const project = resolve(root);
  const authored = authoredRoots(config);
  return {
    project,
    source: resolve(project, authored.source),
    media: resolve(project, authored.media),
    output: resolve(project, authored.output),
    cache: resolve(project, authored.cache),
  };
}

export function authoredRoots(config: CinecodeConfig): Record<RootKey, string> {
  return {
    source: config.project?.sourceDir ?? config.sourceDir ?? "./src",
    media: config.project?.mediaDir ?? config.mediaDir ?? "./media",
    output: config.project?.outputDir ?? config.outputDir ?? "./output",
    cache: config.project?.cacheDir ?? config.cacheDir ?? ".cinecode/cache",
  };
}

function stripTrailing(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/[\\/]+$/, "") : path;
  return trimmed === "" ? sep : trimmed;
}

/** Real path where the platform allows it, then trailing separators, then case. */
export function normalizeRoot(path: string): string {
  const absolute = resolve(path);
  let existing = absolute;
  try {
    existing = realpathSync.native(absolute);
  } catch {
    existing = absolute;
  }
  const collapsed = stripTrailing(existing);
  return CASE_INSENSITIVE ? collapsed.toLowerCase() : collapsed;
}

/** Segment comparison so `/a/src` never contains `/a/src-media`. */
export function containsPath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

interface ResolvedRoots {
  readonly project: string;
  readonly values: ReadonlyArray<{ readonly key: RootKey; readonly absolute: string; readonly compare: string }>;
}

function resolved(root: string, config: CinecodeConfig): ResolvedRoots {
  const roots = resolveProjectRoots(root, config);
  return {
    project: normalizeRoot(roots.project),
    values: ROOT_KEYS.map((key) => ({ key, absolute: roots[key], compare: normalizeRoot(roots[key]) })),
  };
}

function rootError(
  key: string,
  path: string,
  reason: string,
  configPath: string | undefined,
  fixHint: string,
): CinecodeError {
  return createError(
    ErrorCode.CC1003,
    { key, path, reason },
    { location: { file: configPath }, fixHint },
  );
}

/** Every violated root rule, one error per offender, all reported in one run. */
export function validateProjectRoots(
  root: string,
  config: CinecodeConfig,
  options: { readonly configPath?: string } = {},
): CinecodeError[] {
  const { project, values } = resolved(root, config);
  const errors: CinecodeError[] = [];
  const authored = authoredRoots(config);

  for (const value of values) {
    if (value.compare === project) {
      errors.push(
        rootError(
          value.key === "source" ? "sourceDir" : `${value.key}Dir`,
          value.absolute,
          `root equals the project root "${resolve(root)}"; the four roots must be non-nested directories inside it`,
          options.configPath,
          `Point ${value.key}Dir at a subdirectory of the project root, for example "./${value.key}".`,
        ),
      );
    }
  }

  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      const a = values[i]!;
      const b = values[j]!;
      if (a.compare === b.compare) {
        errors.push(
          rootError(
            `${a.key}Dir/${b.key}Dir`,
            `${a.absolute}, ${b.absolute}`,
            `${a.key} root "${a.absolute}" and ${b.key} root "${b.absolute}" resolve to the same directory; every root must be distinct`,
            options.configPath,
            `Give ${a.key}Dir and ${b.key}Dir different values in ${options.configPath ?? "the config"}.`,
          ),
        );
        continue;
      }
      for (const [outer, inner] of [
        [a, b],
        [b, a],
      ] as const) {
        if (containsPath(outer.compare, inner.compare)) {
          errors.push(
            rootError(
              `${inner.key}Dir`,
              inner.absolute,
              `${inner.key} root "${inner.absolute}" is nested inside ${outer.key} root "${outer.absolute}"; roots must not contain one another`,
              options.configPath,
              `Move ${inner.key}Dir out of ${outer.key}Dir so it is a sibling: ${describeSibling(authored[outer.key])}.`,
            ),
          );
        }
      }
    }
  }

  return errors;
}

function describeSibling(root: string): string {
  const cleaned = stripTrailing(root).replace(/[\\/]+$/, "");
  return `"./${cleaned.split(/[\\/]/).pop() ?? "root"}-data"`;
}

/** Illegal characters, reserved device names, trailing dots or spaces, empty segments. */
export function validateRootFilenames(
  config: CinecodeConfig,
  options: { readonly configPath?: string } = {},
): CinecodeError[] {
  const authored = authoredRoots(config);
  const errors: CinecodeError[] = [];
  for (const key of ROOT_KEYS) {
    const value = authored[key];
    const label = key === "source" ? "sourceDir" : `${key}Dir`;
    if (/[<>:"|?*]/.test(value)) {
      errors.push(rootError(label, value, "contains characters illegal on Windows: <>:\"|?*", options.configPath, "Rename the directory using portable characters."));
    }
    if (/[\\/]{2,}/.test(value)) {
      errors.push(rootError(label, value, "contains an empty path segment", options.configPath, "Collapse repeated separators in the directory path."));
    }
    const parts = value.split(/[/\\]/);
    for (const part of parts) {
      if (part === "" || part === "." || part === "..") continue;
      if (RESERVED_NAMES.has(part.toUpperCase()) || RESERVED_NAMES.has(part.toUpperCase().split(".")[0]!)) {
        errors.push(rootError(label, value, `contains the reserved Windows device name "${part}"`, options.configPath, "Rename the directory segment to a non-reserved name."));
      }
      if (/[. ]+$/.test(part)) {
        errors.push(rootError(label, value, `segment "${part}" ends with a dot or space`, options.configPath, "Remove trailing dots and spaces from the directory name."));
      }
    }
  }
  return errors;
}

export const RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

/** Root used for validation when a caller only knows the config file. */
export function rootOfConfig(configPath: string): string {
  return dirname(resolve(configPath));
}
