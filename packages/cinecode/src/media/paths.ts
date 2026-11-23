import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { CinecodeConfig } from "../core/types/index.js";
import { createError, ErrorCode } from "../errors/codes.js";
import { runReport } from "../cli/output/run-report.js";

/** Converts backslashes to forward slashes for POSIX-compliant relative paths. */
export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/** Computes a relative path formatted with POSIX forward slashes. */
export function toPosixRelative(from: string, to: string): string {
  return relative(from, to).replace(/\\/g, "/");
}

/** Checks whether `child` is located inside `parent`, handling case-insensitivity on Windows. */
export function isPathInside(parent: string, child: string): boolean {
  const p = resolve(parent);
  const c = resolve(child);
  const pNorm = process.platform === "win32" ? p.toLowerCase() : p;
  const cNorm = process.platform === "win32" ? c.toLowerCase() : c;
  const rel = relative(pNorm, cNorm);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

/** Canonical path identity for caching and indexing (resolved, lowercase on Windows, with optional mtime/size). */
export function canonicalPathIdentity(
  filePath: string,
  statInfo?: { readonly mtimeMs?: number; readonly size?: number },
): string {
  let resolved = resolve(filePath);
  try {
    resolved = realpathSync(filePath);
  } catch {
    // Note: fallback to lexical path if file does not exist yet
  }
  if (process.platform === "win32") {
    resolved = resolved.toLowerCase();
  }
  const posix = resolved.replace(/\\/g, "/");
  if (statInfo && statInfo.mtimeMs !== undefined && statInfo.size !== undefined) {
    return `${posix}:${statInfo.mtimeMs}:${statInfo.size}`;
  }
  return posix;
}

export interface MediaResolutionOptions {
  readonly reportNote?: boolean;
}

/**
 * Single authoritative media file resolver.
 *
 * Resolves references against `mediaDir` (or `sourceDir` when `allowCoLocatedMedia` is true).
 * Canonicalizes using realpath, enforces root boundaries, rejects symlink escapes,
 * and eliminates silent project root fallback.
 */
export function resolveMediaFilePath(
  ref: string,
  rootDir: string,
  config: Partial<CinecodeConfig> | { mediaDir?: string; sourceDir?: string; allowCoLocatedMedia?: boolean },
  options: MediaResolutionOptions = {},
): string {
  const projectRoot = resolve(rootDir);
  const mediaDir = resolve(projectRoot, config.mediaDir ?? "media");
  const sourceDir = resolve(projectRoot, config.sourceDir ?? "src");
  const allowCoLocated = config.allowCoLocatedMedia === true;

  // Re-encode or traversal checks on ref
  const lexicalMedia = resolve(mediaDir, ref);
  const escapesMedia = !isPathInside(mediaDir, lexicalMedia);

  if (escapesMedia) {
    if (!allowCoLocated) {
      throw createError(
        ErrorCode.CC1003,
        {
          key: "media",
          path: ref,
          reason: `media reference "${ref}" resolves to "${lexicalMedia}" which escapes allowed media root "${mediaDir}"`,
        },
        {
          location: { file: lexicalMedia },
          fixHint: `Keep media files inside "${mediaDir}" or set allowCoLocatedMedia: true in config`,
        },
      );
    }
    // Co-location enabled: verify it doesn't escape project root
    if (!isPathInside(projectRoot, lexicalMedia)) {
      throw createError(
        ErrorCode.CC1003,
        {
          key: "media",
          path: ref,
          reason: `media reference "${ref}" resolves to "${lexicalMedia}" which escapes project root "${projectRoot}"`,
        },
        {
          location: { file: lexicalMedia },
          fixHint: `Keep media references inside project root "${projectRoot}"`,
        },
      );
    }
  }

  // 1. Check in mediaDir
  if (existsSync(lexicalMedia)) {
    let canonicalMedia = lexicalMedia;
    try {
      canonicalMedia = realpathSync(lexicalMedia);
    } catch {
      // Note: fallback to lexical path if file does not exist
    }

    const canonicalMediaRoot = existsSync(mediaDir) ? realpathSync(mediaDir) : mediaDir;
    if (!isPathInside(canonicalMediaRoot, canonicalMedia)) {
      if (!allowCoLocated) {
        throw createError(
          ErrorCode.CC1003,
          {
            key: "media",
            path: ref,
            reason: `media reference "${ref}" resolves via symlink to "${canonicalMedia}" which escapes allowed media root "${mediaDir}"`,
          },
          {
            location: { file: canonicalMedia },
            fixHint: `Ensure symlink target stays inside media root "${mediaDir}"`,
          },
        );
      }
      const canonicalProjectRoot = existsSync(projectRoot) ? realpathSync(projectRoot) : projectRoot;
      if (!isPathInside(canonicalProjectRoot, canonicalMedia)) {
        throw createError(
          ErrorCode.CC1003,
          {
            key: "media",
            path: ref,
            reason: `media reference "${ref}" resolves via symlink to "${canonicalMedia}" which escapes project root "${projectRoot}"`,
          },
          {
            location: { file: canonicalMedia },
            fixHint: `Ensure symlink target stays inside project root "${projectRoot}"`,
          },
        );
      }
      if (options.reportNote !== false) {
        runReport.note(`Resolved co-located media "${ref}" from ${canonicalMedia}`);
      }
      return canonicalMedia;
    }
    return canonicalMedia;
  }

  // 2. Check in sourceDir if co-located media allowed
  if (allowCoLocated) {
    const lexicalSource = resolve(sourceDir, ref);
    if (!isPathInside(projectRoot, lexicalSource)) {
      throw createError(
        ErrorCode.CC1003,
        {
          key: "media",
          path: ref,
          reason: `media reference "${ref}" resolves to "${lexicalSource}" which escapes project root "${projectRoot}"`,
        },
        {
          location: { file: lexicalSource },
          fixHint: `Keep media references inside project root "${projectRoot}"`,
        },
      );
    }
    if (existsSync(lexicalSource)) {
      let canonicalSource = lexicalSource;
      try {
        canonicalSource = realpathSync(lexicalSource);
      } catch {
        // Note: fallback to lexical path if file does not exist
      }
      const canonicalProjectRoot = existsSync(projectRoot) ? realpathSync(projectRoot) : projectRoot;
      if (!isPathInside(canonicalProjectRoot, canonicalSource)) {
        throw createError(
          ErrorCode.CC1003,
          {
            key: "media",
            path: ref,
            reason: `media reference "${ref}" resolves via symlink to "${canonicalSource}" which escapes project root "${projectRoot}"`,
          },
          {
            location: { file: canonicalSource },
            fixHint: `Ensure symlink target stays inside project root "${projectRoot}"`,
          },
        );
      }
      if (options.reportNote !== false) {
        runReport.note(`Resolved co-located media "${ref}" from ${canonicalSource}`);
      }
      return canonicalSource;
    }
  }

  // 3. Not found anywhere (no project-root fallback)
  const searched = [lexicalMedia];
  if (allowCoLocated) {
    searched.push(resolve(sourceDir, ref));
  } else {
    searched.push(`${resolve(sourceDir, ref)} (co-located search disabled; enable allowCoLocatedMedia in config)`);
  }

  throw createError(
    ErrorCode.CC2001,
    { path: `${ref}. Searched locations:\n  - ${searched.join("\n  - ")}` },
    {
      location: { file: lexicalMedia },
      fixHint: `Verify media exists in media root at ${mediaDir} or enable allowCoLocatedMedia in config`,
    },
  );
}

/** Resolves an explicit output path against the project root. */
export function resolveOutputPath(projectRoot: string, outputPath: string): string {
  return resolve(projectRoot, outputPath);
}
