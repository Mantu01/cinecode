import { Command } from "commander";
import { rm, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../config/schema.js";
import { formatCacheGcResult, pruneStaleEntries } from "../pipeline/cache-gc.js";

interface CleanOptions {
  output?: boolean;
  all?: boolean;
  force?: boolean;
  dryRun?: boolean;
  config?: string;
  pruneStaleDays?: number;
}

async function getDirectorySize(dir: string): Promise<{ files: number; size: number }> {
  let files = 0;
  let size = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await getDirectorySize(fullPath);
        files += sub.files;
        size += sub.size;
      } else {
        try {
          const s = await stat(fullPath);
          files++;
          size += s.size;
        } catch {
          void 0;
        }
      }
    }
  } catch {
    void 0;
  }
  return { files, size };
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

export async function cleanCommand(options: CleanOptions): Promise<void> {
  const configPath = options.config ?? "cinecode.config.js";
  const config = await loadConfig(resolve(configPath));

  const cacheDir = resolve(config.cacheDir ?? ".cinecode/cache");
  const outputDir = resolve(config.outputDir ?? "output");

  if (options.pruneStaleDays !== undefined) {
    const result = await pruneStaleEntries(cacheDir, options.pruneStaleDays, { dryRun: options.dryRun === true });
    console.log(formatCacheGcResult(result));
    return;
  }

  const cleanCache = !options.output || options.all;
  const cleanOutput = options.output || options.all;

  const targets: Array<{ name: string; path: string }> = [];
  if (cleanCache) targets.push({ name: "cache", path: cacheDir });
  if (cleanOutput) targets.push({ name: "output", path: outputDir });

  if (targets.length === 0) {
    console.log("Nothing to clean");
    return;
  }

  const summary: Array<{ name: string; path: string; files: number; size: number }> = [];

  for (const target of targets) {
    const { files, size } = await getDirectorySize(target.path);
    summary.push({ name: target.name, path: target.path, files, size });
  }

  if (options.dryRun) {
    console.log("Dry run - would delete:");
    for (const item of summary) {
      console.log(`  ${item.name}: ${item.files} files, ${formatSize(item.size)} at ${item.path}`);
    }
    return;
  }

  if (!options.force) {
    console.log("The following will be deleted:");
    for (const item of summary) {
      console.log(`  ${item.name}: ${item.files} files, ${formatSize(item.size)} at ${item.path}`);
    }
    console.log("");
    console.log("This action cannot be undone. Continue? (y/N)");

    const answer = await new Promise<string>(resolvePromise => {
      const stdin = process.stdin;
      stdin.setEncoding("utf-8");
      stdin.once("data", (data: Buffer) => {
        resolvePromise(data.toString().trim().toLowerCase());
      });
    });

    if (answer !== "y" && answer !== "yes") {
      console.log("Cancelled");
      return;
    }
  }

  for (const target of targets) {
    try {
      await rm(target.path, { recursive: true, force: true });
      console.log(`Deleted ${target.name}: ${target.path}`);
    } catch (e) {
      console.error(`Failed to delete ${target.name} (${target.path}): ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  }
}

export function createCleanCommand(): Command {
  const cmd = new Command("clean")
    .description("Delete cache and/or output directories")
    .option("--output", "Also empty output directory", false)
    .option("--all", "Clean both cache and output", false)
    .option("--force", "Skip confirmation prompt", false)
    .option("--dry-run", "Print what would be deleted without deleting", false)
    .option("--prune-stale-days <days>", "Prune cache entries unreferenced for N days instead of deleting everything", (value) => parseInt(value, 10))
    .option("-c, --config <path>", "Path to config file")
    .action(async (options: CleanOptions, command: Command) => {
      await cleanCommand({ ...command.optsWithGlobals(), ...options });
    });
  return cmd;
}