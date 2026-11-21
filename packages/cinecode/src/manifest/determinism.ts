import { readFileSync, statSync } from "node:fs";
import type { MainManifest } from "../core/types/index.js";
import { createError, ErrorCode, type CinecodeError } from "../errors/index.js";
import { scanSourceForNonDeterminism } from "../core/validation/index.js";
import { resolveUserModule } from "../loader/index.js";

const scanned = new Map<string, readonly CinecodeError[]>();

/** Same module identity (path + size + mtime) never scans twice in one process. */
function identity(file: string): string {
  try {
    const stats = statSync(file);
    return `${file}:${stats.size}:${stats.mtimeMs}`;
  } catch {
    return file;
  }
}

export function scanAuthoredModule(file: string, rootDir: string): readonly CinecodeError[] {
  const resolved = resolveUserModule(file, rootDir);
  const key = identity(resolved);
  const cached = scanned.get(key);
  if (cached) return cached;

  let source: string;
  try {
    source = readFileSync(resolved, "utf-8");
  } catch {
    return [];
  }
  const errors = scanSourceForNonDeterminism(source, resolved).map((issue) =>
    createError(
      ErrorCode.CC3005,
      { context: resolved, function: /"([^"]+)"/.exec(issue.message)?.[1] ?? "unknown" },
      { location: issue.position ?? { file: resolved }, fixHint: issue.hint },
    ),
  );
  scanned.set(key, errors);
  return errors;
}

/** Fails a load before frame one when authored code calls a non-deterministic API. */
export function assertDeterministicAuthoredModules(
  manifest: MainManifest,
  entryPath: string,
  rootDir: string,
): void {
  const targets = [entryPath];
  for (const collection of [manifest.images, manifest.audio, manifest.scenes, manifest.timelines]) {
    for (const entry of collection ?? []) {
      if (entry.file) targets.push(resolveUserModule(entry.file, rootDir));
    }
  }
  const errors = [...new Set(targets)].flatMap((file) => scanAuthoredModule(file, rootDir));
  if (errors.length === 0) return;
  (errors[0] as { issues?: readonly unknown[] }).issues = errors;
  throw errors[0];
}
