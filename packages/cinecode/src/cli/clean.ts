import { Command } from "commander";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import pc from "picocolors";
import prompts from "prompts";
import { loadProjectContext } from "./project-context.js";
import { pruneStaleEntries } from "../pipeline/cache-gc.js";
import { runReport } from "./run-report.js";
import { sweepSpools } from "./spool.js";
import { createError, ErrorCode } from "../errors/index.js";
import { CancellationSignal } from "./exit-codes.js";
import type { PreflightContext } from "./preflight.js";
import { findCommand, buildCommanderCommand } from "./command-registry.js";

export interface CleanOptions {
  cache?: boolean;
  output?: boolean;
  prune?: boolean;
  all?: boolean;
  yes?: boolean;
  force?: boolean;
  dryRun?: boolean;
  config?: string;
  root?: string;
  pruneStaleDays?: number;
  deleteOrphans?: boolean;
}

export interface TargetFileInfo {
  path: string;
  size: number;
}

async function collectFilesRecursively(dir: string): Promise<TargetFileInfo[]> {
  const result: TargetFileInfo[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await collectFilesRecursively(fullPath);
        result.push(...nested);
      } else {
        try {
          const s = await stat(fullPath);
          result.push({ path: fullPath, size: s.size });
        } catch {
          result.push({ path: fullPath, size: 0 });
        }
      }
    }
  } catch {
    // Note: Directory might not exist or not be readable
  }
  return result;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

async function collectPrunableCacheEntries(cacheDir: string, projectRoot: string): Promise<TargetFileInfo[]> {
  const prunable: TargetFileInfo[] = [];
  const metaDir = join(cacheDir, "metadata");
  if (!existsSync(metaDir)) return prunable;

  try {
    const files = await readdir(metaDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const metaPath = join(metaDir, file);
      try {
        const raw = await readFile(metaPath, "utf-8");
        const parsed = JSON.parse(raw) as { sourcePath?: string };
        const sourcePath = parsed?.sourcePath;

        let isUnreferenced = false;
        if (!sourcePath || !existsSync(sourcePath)) {
          isUnreferenced = true;
        }

        if (isUnreferenced) {
          const s = await stat(metaPath).catch(() => ({ size: 0 }));
          prunable.push({ path: metaPath, size: s.size });

          // Also check for corresponding frame cache file
          const baseHash = file.slice(0, -5);
          const frameDir = join(cacheDir, "frames");
          if (existsSync(frameDir)) {
            const frameFiles = await readdir(frameDir).catch(() => []);
            for (const ff of frameFiles) {
              if (ff.startsWith(baseHash)) {
                const fp = join(frameDir, ff);
                const fsStat = await stat(fp).catch(() => ({ size: 0 }));
                prunable.push({ path: fp, size: fsStat.size });
              }
            }
          }
        }
      } catch {
        // Corrupt metadata entry is also prunable
        const s = await stat(metaPath).catch(() => ({ size: 0 }));
        prunable.push({ path: metaPath, size: s.size });
      }
    }
  } catch {
    // Note: Ignore read errors
  }
  return prunable;
}

export async function cleanCommand(options: CleanOptions = {}, context?: PreflightContext): Promise<void> {
  const cleanCache = options.cache === true || options.all === true;
  const cleanOutput = options.output === true || options.all === true;
  const pruneCache = options.prune === true || options.pruneStaleDays !== undefined || options.deleteOrphans === true;

  if (!cleanCache && !cleanOutput && !pruneCache) {
    throw createError(
      ErrorCode.CC0001,
      { reason: "Nothing to clean. Specify at least one target: --cache, --output, --prune, or --all." },
      { fixHint: "Run `cinecode clean --cache`, `cinecode clean --output`, `cinecode clean --prune`, or `cinecode clean --all`." },
    );
  }

  const ctx = context ?? (await loadProjectContext({ root: options.root, config: options.config, allowStandalone: true }));
  const resolvedCacheDir = resolve(ctx.roots.cache);
  const resolvedOutputDir = resolve(ctx.roots.output);
  const projectRoot = resolve(ctx.root);

  // Spool sweep is safe and idempotent
  const spools = sweepSpools(resolvedCacheDir);

  const cacheTargets: TargetFileInfo[] = [];
  const outputTargets: TargetFileInfo[] = [];
  const pruneTargets: TargetFileInfo[] = [];

  if (cleanCache) {
    const files = await collectFilesRecursively(resolvedCacheDir);
    cacheTargets.push(...files);
  } else if (pruneCache) {
    if (options.pruneStaleDays !== undefined) {
      // Age-based prune
      const gcRes = await pruneStaleEntries(resolvedCacheDir, options.pruneStaleDays, { dryRun: true });
      if (gcRes.removedObjects > 0) {
        pruneTargets.push({ path: join(resolvedCacheDir, "index"), size: gcRes.removedBytes });
      }
    }
    const unref = await collectPrunableCacheEntries(resolvedCacheDir, projectRoot);
    pruneTargets.push(...unref);
  }

  if (cleanOutput) {
    const files = await collectFilesRecursively(resolvedOutputDir);
    outputTargets.push(...files);
  }

  // Safety invariant: Ensure no targets are outside their respective roots
  for (const t of [...cacheTargets, ...pruneTargets]) {
    const resolved = resolve(t.path);
    if (!resolved.startsWith(resolvedCacheDir)) {
      throw createError(ErrorCode.CC1003, {
        reason: `Safety violation: cache target ${t.path} is outside cache directory ${resolvedCacheDir}`,
      });
    }
  }
  for (const t of outputTargets) {
    const resolved = resolve(t.path);
    if (!resolved.startsWith(resolvedOutputDir)) {
      throw createError(ErrorCode.CC1003, {
        reason: `Safety violation: output target ${t.path} is outside output directory ${resolvedOutputDir}`,
      });
    }
  }

  const allTargets = [
    ...cacheTargets,
    ...outputTargets,
    ...pruneTargets,
  ];

  const totalBytes = allTargets.reduce((sum, t) => sum + t.size, 0);

  const summary = [
    ...(cleanCache ? [{ name: "cache", path: resolvedCacheDir, files: cacheTargets.length, size: cacheTargets.reduce((s, t) => s + t.size, 0) }] : []),
    ...(cleanOutput ? [{ name: "output", path: resolvedOutputDir, files: outputTargets.length, size: outputTargets.reduce((s, t) => s + t.size, 0) }] : []),
    ...(pruneCache && !cleanCache ? [{ name: "prune", path: resolvedCacheDir, files: pruneTargets.length, size: pruneTargets.reduce((s, t) => s + t.size, 0) }] : []),
  ];

  if (options.dryRun === true) {
    runReport.result({
      dryRun: true,
      summary,
      targets: allTargets.map((t) => t.path),
      deleted: [],
      files: allTargets.length,
      bytes: totalBytes,
      spoolsSwept: spools.sweptCount,
      spoolsBytes: spools.sweptBytes,
    });
    console.log(pc.bold("Dry run — would delete:"));
    for (const item of summary) {
      console.log(`  ${item.name}: ${item.files} files, ${formatSize(item.size)} at ${item.path}`);
    }
    if (allTargets.length > 0) {
      console.log(pc.dim(`  Total: ${allTargets.length} files (${formatSize(totalBytes)})`));
    }
    return;
  }

  // Consent & Confirmation
  const hasConsent = options.yes === true || options.force === true;
  if (!hasConsent) {
    if (!process.stdin.isTTY) {
      throw createError(ErrorCode.CC1012, {
        reason: "Destructive command 'clean' requires explicit consent via --yes or --force in non-interactive mode.",
      });
    }

    console.log(pc.yellow("The following will be deleted:"));
    for (const item of summary) {
      console.log(`  ${item.name}: ${item.files} files, ${formatSize(item.size)} at ${item.path}`);
    }
    console.log("");

    const { confirmed } = await prompts({
      type: "confirm",
      name: "confirmed",
      message: "Are you sure you want to delete these files? (cannot be undone)",
      initial: false,
    });

    if (!confirmed) {
      console.log(pc.dim("Clean operation cancelled by user."));
      throw new CancellationSignal("Clean operation cancelled by user");
    }
  }

  // Perform deletion
  const deleted: string[] = [];

  for (const t of cacheTargets) {
    try {
      await rm(t.path, { force: true });
      deleted.push(t.path);
    } catch {
      // Note: Continue removing remaining targets
    }
  }

  for (const t of pruneTargets) {
    try {
      await rm(t.path, { force: true });
      deleted.push(t.path);
    } catch {
      // Note: Continue removing remaining prune targets
    }
  }

  for (const t of outputTargets) {
    try {
      await rm(t.path, { force: true });
      deleted.push(t.path);
    } catch {
      // Note: Continue removing remaining output targets
    }
  }

  const cacheDeleted = deleted.filter((p) => p.startsWith(resolvedCacheDir));
  const outputDeleted = deleted.filter((p) => p.startsWith(resolvedOutputDir));

  runReport.result({
    deleted,
    cache: {
      files: cacheDeleted.length,
      bytes: cacheTargets.reduce((s, t) => s + t.size, 0),
      removedFiles: cacheDeleted,
    },
    output: {
      files: outputDeleted.length,
      bytes: outputTargets.reduce((s, t) => s + t.size, 0),
      removedFiles: outputDeleted,
    },
    prune: {
      files: pruneTargets.length,
      bytes: pruneTargets.reduce((s, t) => s + t.size, 0),
      removedFiles: pruneTargets.map((t) => t.path),
    },
    summary,
    files: deleted.length,
    bytes: totalBytes,
    spoolsSwept: spools.sweptCount,
    spoolsBytes: spools.sweptBytes,
  });

  if (cleanCache) {
    console.log(pc.green(`✔ Removed ${cacheTargets.length} file(s) from cache (${formatSize(cacheTargets.reduce((s, t) => s + t.size, 0))})`));
  }
  if (pruneCache && !cleanCache) {
    console.log(pc.green(`✔ Pruned ${pruneTargets.length} unreferenced cache entry(ies) (${formatSize(pruneTargets.reduce((s, t) => s + t.size, 0))})`));
  }
  if (cleanOutput) {
    console.log(pc.green(`✔ Removed ${outputTargets.length} file(s) from output (${formatSize(outputTargets.reduce((s, t) => s + t.size, 0))})`));
  }
}

export function createCleanCommand(): Command {
  const spec = findCommand("clean");
  if (!spec) throw new Error("Command 'clean' not found in registry");
  return buildCommanderCommand(spec);
}
