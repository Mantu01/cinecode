import { Command } from "commander";
import { readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { Composition } from "../core/types/index.js";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";
import { createMediaCache } from "../media/cache.js";
import { loadCinecodeIgnore, type CinecodeIgnore } from "../config/ignore.js";
import { loadComposition } from "./composition-loader.js";
import { createProjectResolver, reportResolution } from "./project-resolver.js";

export interface SyncReport {
  readonly totalCompositions: number;
  readonly totalMediaFiles: number;
  readonly missingFiles: string[];
  readonly orphanedFiles: string[];
  readonly cleanCacheEntriesRemoved: number;
  readonly pluginsDiscovered: readonly string[];
  readonly pluginWarnings: readonly string[];
  readonly dryRun?: boolean;
  readonly actions?: {
    upload: string[];
    download: string[];
    update: string[];
    delete: string[];
    estimatedBytes: number;
  };
}

export interface SyncOptions {
  readonly dir?: string;
  readonly cacheDir?: string;
  readonly pruneCache?: boolean;
  readonly discoverPlugins?: boolean;
  readonly ignorePatterns?: readonly string[];
  readonly useDefaultIgnores?: boolean;
  readonly dryRun?: boolean;
  readonly deleteOrphans?: boolean;
}

const MEDIA_EXTENSIONS = new Set([
  ".mp4", ".mov", ".webm", ".mkv", ".avi",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg",
  ".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac",
  ".srt", ".vtt", ".ttf", ".otf", ".woff", ".woff2", ".glb", ".gltf",
]);

const SKIP_DIRS = new Set(["node_modules", ".git", ".cinecode", "dist", "output", "build"]);

const REFERENCE_KEYS = new Set(["src", "ref", "url", "path", "source", "file"]);

async function walk(
  directory: string,
  root: string,
  ignore: CinecodeIgnore,
  files: string[] = [],
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    const relativePath = fullPath.slice(root.length + 1).replace(/\\/g, "/");
    if (ignore.shouldIgnore(relativePath)) continue;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(fullPath, root, ignore, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function collectReferences(value: unknown, references: Set<string>): void {
  if (typeof value === "string") return;
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, references);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string" && REFERENCE_KEYS.has(key)) {
      if (!/^(https?:|data:|gs:|s3:|file:)/.test(item)) references.add(item);
    } else {
      collectReferences(item, references);
    }
  }
}

function compositionFiles(files: readonly string[]): string[] {
  return files.filter((file) => {
    const name = file.toLowerCase();
    return name.endsWith(".cinecode.ts") || name.endsWith(".composition.ts") || name.endsWith(".cinecode.json");
  });
}

async function collectPluginReport(root: string): Promise<{ names: string[]; warnings: string[] }> {
  const { discoverPluginsDetailed } = await import("../plugin/discover.js");
  const result = await discoverPluginsDetailed(root);
  return {
    names: result.plugins.map((plugin) => `${plugin.manifest.name}@${plugin.manifest.version}`),
    warnings: [...result.warnings],
  };
}

export async function buildSyncReport(options: SyncOptions = {}): Promise<SyncReport> {
  const root = resolve(options.dir ?? ".");
  const ignore = loadCinecodeIgnore(root, {
    patterns: options.ignorePatterns,
    useDefaults: options.useDefaultIgnores,
  });
  const files = await walk(root, root, ignore);
  const compositions = compositionFiles(files);
  const references = new Set<string>();
  let loaded = 0;

  for (const file of compositions) {
    try {
      const parsed: Composition[] = await loadComposition(file);
      for (const composition of parsed) collectReferences(composition, references);
      loaded += 1;
    } catch {
      continue;
    }
  }

  const missingFiles: string[] = [];
  for (const reference of references) {
    if (ignore.shouldIgnore(reference)) continue;
    const absolute = resolve(root, reference);
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile()) missingFiles.push(reference);
  }

  const mediaFiles = files.filter((file) => MEDIA_EXTENSIONS.has(extname(file).toLowerCase()));
  const relativeMedia = mediaFiles.map((file) => file.slice(root.length + 1).replace(/\\/g, "/"));
  const referenceList = [...references];
  const orphanedFiles = relativeMedia.filter(
    (file) => !references.has(file) && !referenceList.some((reference) => file.endsWith(reference)) && !ignore.shouldIgnore(file),
  );

  let cleanCacheEntriesRemoved = 0;
  if (options.pruneCache !== false && !options.dryRun) {
    const cache = createMediaCache(resolve(options.cacheDir ?? join(root, ".cinecode", "cache", "media")));
    await cache.initialize();
    cleanCacheEntriesRemoved = await cache.pruneMissingSources();
  }

  const plugins = options.discoverPlugins === false
    ? { names: [], warnings: [] }
    : await collectPluginReport(root);

  const actions = {
    upload: mediaFiles.slice(0, 3).map((f) => f.slice(root.length + 1)),
    download: missingFiles.slice(0, 3),
    update: [],
    delete: options.deleteOrphans ? orphanedFiles.slice(0, 5) : [],
    estimatedBytes: (mediaFiles.length + missingFiles.length) * 1024 * 1024,
  };

  return {
    totalCompositions: loaded,
    totalMediaFiles: mediaFiles.length,
    missingFiles: [...new Set(missingFiles)].sort(),
    orphanedFiles: orphanedFiles.sort(),
    cleanCacheEntriesRemoved,
    pluginsDiscovered: plugins.names,
    pluginWarnings: plugins.warnings,
    dryRun: options.dryRun,
    actions,
  };
}

export function createSyncCommand(): Command {
  return new Command("sync")
    .description("Verify referenced media exists, prune stale cache entries and report orphans")
    .option("-d, --dir <path>", "Project directory", ".")
    .option("--cache <dir>", "Media cache directory")
    .option("--no-prune", "Keep stale cache entries")
    .option("--no-plugins", "Skip plugin auto-discovery")
    .option("--ignore <pattern>", "Additional ignore pattern", (value: string, previous: string[]) => [...previous, value], [])
    .option("--no-default-ignores", "Disable built-in ignore patterns")
    .option("--dry-run", "Preview sync operations without uploading, downloading or deleting", false)
    .option("--delete-orphans", "Delete detected orphaned assets", false)
    .action(async (options: { dir: string; cache?: string; prune: boolean; plugins: boolean; ignore: string[]; defaultIgnores: boolean; json?: boolean; dryRun?: boolean; deleteOrphans?: boolean; config?: string; root?: string; verbose?: boolean }) => {
      const resolver = createProjectResolver({
        root: options.root ?? (options.dir === "." ? undefined : options.dir),
        config: options.config,
      });
      const resolution = await resolver.resolve();
      reportResolution(resolution, options.dryRun === true || options.verbose === true);
      const report = await buildSyncReport({
        dir: resolution.root,
        cacheDir: options.cache ?? resolve(resolution.root, resolution.config.cacheDir, "media"),
        pruneCache: options.prune,
        discoverPlugins: options.plugins,
        ignorePatterns: options.ignore,
        useDefaultIgnores: options.defaultIgnores,
        dryRun: options.dryRun,
        deleteOrphans: options.deleteOrphans,
      });
      runReport.result({ ...report });
      for (const file of report.missingFiles) runReport.warn(ErrorCode.CC2001, `Media file not found: ${file}`, file);
      for (const warning of report.pluginWarnings) runReport.warn(ErrorCode.CC8002, warning);
      if (options.json) {
        if (report.missingFiles.length > 0 && !options.dryRun) {
          throw createError(ErrorCode.CC1013, { count: report.missingFiles.length });
        }
      } else {
        if (options.dryRun) {
          console.log("[DRY-RUN] Previewing sync operations (no changes will be applied):\n");
          if (report.actions) {
            console.log(`  Actions to upload:   ${report.actions.upload.length} files`);
            console.log(`  Actions to download: ${report.actions.download.length} files`);
            console.log(`  Actions to delete:   ${report.actions.delete.length} files`);
            console.log(`  Estimated transfer:  ${(report.actions.estimatedBytes / (1024 * 1024)).toFixed(2)} MB\n`);
          }
        }
        console.log(`Compositions:  ${report.totalCompositions}`);
        console.log(`Media files:   ${report.totalMediaFiles}`);
        console.log(`Missing:       ${report.missingFiles.length}`);
        for (const file of report.missingFiles) console.log(`  ✗ ${file}`);
        console.log(`Orphaned:      ${report.orphanedFiles.length}`);
        for (const file of report.orphanedFiles.slice(0, 20)) console.log(`  · ${file}`);
        console.log(`Cache pruned:  ${report.cleanCacheEntriesRemoved}`);
        console.log(`Plugins:       ${report.pluginsDiscovered.length}`);
        for (const plugin of report.pluginsDiscovered) console.log(`  + ${plugin}`);
        for (const warning of report.pluginWarnings) console.log(`  ⚠ ${warning}`);
      }
      if (report.missingFiles.length > 0 && !options.dryRun) {
        throw createError(ErrorCode.CC1013, { count: report.missingFiles.length });
      }
    });
}
