import { Command } from "commander";
import { readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pc } from "../output/palette.js";
import prompts from "prompts";
import { loadProjectContext } from "../resolve/project-context.js";
import { collectFrameCacheGarbage, type CacheGcResult } from "../../pipeline/cache-gc.js";
import { runReport } from "../output/run-report.js";
import { sweepSpools } from "../shared/spool.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { CancellationSignal } from "../shared/exit-codes.js";
import type { PreflightContext } from "../gate/preflight.js";

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

  // Spool sweep is safe and idempotent
  const spools = sweepSpools(resolvedCacheDir);

  const cacheTargets: TargetFileInfo[] = [];
  const outputTargets: TargetFileInfo[] = [];

  if (options.pruneStaleDays !== undefined && (!Number.isInteger(options.pruneStaleDays) || options.pruneStaleDays <= 0)) {
    throw createError(ErrorCode.CC0001, { reason: `--prune-stale-days must be a positive integer, received ${String(options.pruneStaleDays)}.` });
  }

  let prunePlan: CacheGcResult | null = null;
  if (cleanCache) {
    const files = await collectFilesRecursively(resolvedCacheDir);
    cacheTargets.push(...files);
  } else if (pruneCache) {
    prunePlan = await collectFrameCacheGarbage({
      cacheDir: resolvedCacheDir,
      maxAgeDays: options.pruneStaleDays,
      deleteOrphans: options.deleteOrphans === true,
      dryRun: true,
    });
  }

  if (cleanOutput) {
    const files = await collectFilesRecursively(resolvedOutputDir);
    outputTargets.push(...files);
  }

  // Safety invariant: Ensure no targets are outside their respective roots
  for (const t of cacheTargets) {
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

  const allTargets = [...cacheTargets, ...outputTargets];
  const totalBytes = allTargets.reduce((sum, t) => sum + t.size, 0);
  const pruneFiles = prunePlan ? prunePlan.removedIndexes + prunePlan.removedObjects + prunePlan.removedOrphans : 0;
  const pruneBytes = prunePlan ? prunePlan.removedBytes + prunePlan.orphanBytes : 0;

  const summary = [
    ...(cleanCache ? [{ name: "cache", path: resolvedCacheDir, files: cacheTargets.length, size: cacheTargets.reduce((s, t) => s + t.size, 0) }] : []),
    ...(cleanOutput ? [{ name: "output", path: resolvedOutputDir, files: outputTargets.length, size: outputTargets.reduce((s, t) => s + t.size, 0) }] : []),
    ...(prunePlan ? [{ name: "prune", path: resolvedCacheDir, files: pruneFiles, size: pruneBytes }] : []),
  ];

  if (options.dryRun === true) {
    runReport.result({
      dryRun: true,
      summary,
      targets: allTargets.map((t) => t.path),
      deleted: [],
      cache: {
        files: cacheTargets.length,
        bytes: cacheTargets.reduce((s, t) => s + t.size, 0),
        removedFiles: [],
      },
      output: {
        files: outputTargets.length,
        bytes: outputTargets.reduce((s, t) => s + t.size, 0),
        removedFiles: [],
      },
      prune: {
        files: pruneFiles,
        bytes: pruneBytes,
        removedFiles: [],
      },
      files: allTargets.length + pruneFiles,
      bytes: totalBytes + pruneBytes,
      spoolsSwept: spools.sweptCount,
      spoolsBytes: spools.sweptBytes,
    });
    if (!runReport.isMachine()) {
      runReport.diagnostic(pc.bold("Dry run — would delete:"));
      for (const item of summary) {
        runReport.diagnostic(`  ${item.name}: ${item.files} files, ${formatSize(item.size)} at ${item.path}`);
      }
      if (allTargets.length + pruneFiles > 0) {
        runReport.diagnostic(pc.dim(`  Total: ${allTargets.length + pruneFiles} files (${formatSize(totalBytes + pruneBytes)})`));
      }
    }
    return;
  }

  // Consent & Confirmation
  const hasConsent = options.yes === true || options.force === true;
  if (!hasConsent) {
    if (!process.stdin.isTTY || runReport.isMachine()) {
      throw createError(ErrorCode.CC1012, {
        reason: "Destructive command 'clean' requires explicit consent via --yes or --force in non-interactive mode.",
      });
    }

    runReport.diagnostic(pc.yellow("The following will be deleted:"));
    for (const item of summary) {
      runReport.diagnostic(`  ${item.name}: ${item.files} files, ${formatSize(item.size)} at ${item.path}`);
    }
    runReport.diagnostic("");

    const { confirmed } = await prompts({
      type: "confirm",
      name: "confirmed",
      message: "Are you sure you want to delete these files? (cannot be undone)",
      initial: false,
    });

    if (!confirmed) {
      runReport.diagnostic(pc.dim("Clean operation cancelled by user."));
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

  const pruned = prunePlan
    ? await collectFrameCacheGarbage({
        cacheDir: resolvedCacheDir,
        maxAgeDays: options.pruneStaleDays,
        deleteOrphans: options.deleteOrphans === true,
        dryRun: false,
      })
    : null;

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
      files: pruned ? pruned.removedIndexes + pruned.removedObjects + pruned.removedOrphans : 0,
      bytes: pruned ? pruned.removedBytes + pruned.orphanBytes : 0,
      removedFiles: [],
      removedIndexes: pruned?.removedIndexes ?? 0,
      removedObjects: pruned?.removedObjects ?? 0,
      removedOrphans: pruned?.removedOrphans ?? 0,
    },
    summary,
    files: deleted.length,
    bytes: totalBytes,
    spoolsSwept: spools.sweptCount,
    spoolsBytes: spools.sweptBytes,
  });

  if (!runReport.isMachine()) {
    if (cleanCache) {
      runReport.diagnostic(pc.green(`✔ Removed ${cacheTargets.length} file(s) from cache (${formatSize(cacheTargets.reduce((s, t) => s + t.size, 0))})`));
    }
    if (pruned) {
      runReport.diagnostic(pc.green(`✔ Pruned ${pruned.removedIndexes} index file(s), ${pruned.removedObjects} object(s), ${pruned.removedOrphans} orphan(s) (${formatSize(pruned.removedBytes + pruned.orphanBytes)})`));
    }
    if (cleanOutput) {
      runReport.diagnostic(pc.green(`✔ Removed ${outputTargets.length} file(s) from output (${formatSize(outputTargets.reduce((s, t) => s + t.size, 0))})`));
    }
  }
}

