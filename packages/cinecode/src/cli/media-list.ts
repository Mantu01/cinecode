import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stat as fsStat } from "node:fs/promises";
import type { CinecodeConfig } from "../core/types/index.js";
import { loadConfig } from "../config/schema.js";
import { createMediaCache } from "../media/cache.js";
import { createMediaResolver } from "../media/resolver.js";
import { runReport } from "./run-report.js";
import { mediaIgnore } from "./shared.js";

export interface MediaListOptions {
  json?: boolean;
  config?: string;
  out?: string;
}

export interface MediaListOutput {
  readonly name: string;
  readonly type: "video" | "image" | "audio";
  readonly duration: number;
  readonly resolution: string;
  readonly size: number;
  readonly origin: "local" | "cloud";
  readonly status: "ok" | "unreadable" | "referenced-but-missing";
}

async function loadConfigFile(configPath?: string): Promise<CinecodeConfig> {
  const configFile = configPath ?? "cinecode.config.js";
  return loadConfig(resolve(configFile));
}

export async function mediaListCommand(options: MediaListOptions): Promise<void> {
  const config = await loadConfigFile(options.config);
  const cache = createMediaCache(config.cacheDir ?? ".cinecode/cache");
  await cache.initialize();

  const resolver = createMediaResolver({
    sourceDir: config.sourceDir,
    cache,
    cloudMedia: config.cloudMedia,
    ignore: mediaIgnore(config),
  });
  await resolver.initialize();

  const media = await resolver.listMedia();
  const cloudMedia = resolver.getCloudMedia();

  const output: MediaListOutput[] = [];

  for (const m of media) {
    const fileStat = await fsStat(m.path).catch(() => null);
    output.push({
      name: m.name,
      type: m.type,
      duration: m.metadata.duration,
      resolution: `${m.metadata.width}x${m.metadata.height}`,
      size: fileStat?.size ?? 0,
      origin: "local",
      status: "ok",
    });
  }

  for (const c of cloudMedia) {
    output.push({
      name: c.name ?? c.url.split("/").pop() ?? "unknown",
      type: "video",
      duration: 0,
      resolution: "unknown",
      size: 0,
      origin: "cloud",
      status: "referenced-but-missing",
    });
  }

  runReport.result({ media: output });
  if (options.json) {
    if (options.out) {
      writeFileSync(options.out, JSON.stringify(output, null, 2));
      runReport.artifact({ kind: "media-list", path: options.out, units: output.length, unit: "entries" });
    }
    return;
  }

  const table = formatTable(output);
  if (options.out) {
    writeFileSync(options.out, table);
    console.log(`Written to ${options.out}`);
  } else {
    console.log(table);
  }
}

function formatTable(items: MediaListOutput[]): string {
  if (items.length === 0) {
    return "No media files found.";
  }

  const headers = ["name", "type", "duration", "resolution", "size", "origin", "status"];
  const rows = items.map(item => [
    item.name,
    item.type,
    formatDuration(item.duration),
    item.resolution,
    formatSize(item.size),
    item.origin,
    item.status,
  ]);

  const colWidths = headers.map((h, i) => Math.max(
    h.length,
    ...rows.map(r => r[i]?.length ?? 0)
  ));

  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i] ?? 0)).join("  ");
  const separator = colWidths.map(w => "-".repeat(w)).join("  ");
  const rowLines = rows.map(r => r.map((c, i) => (c ?? "").padEnd(colWidths[i] ?? 0)).join("  "));

  return [headerLine, separator, ...rowLines].join("\n");
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return "unknown";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "unknown";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)}${units[unitIndex]}`;
}

export function createMediaListCommand(): Command {
  const cmd = new Command("media:list")
    .description("List all media files in the project")
    .option("-o, --out <path>", "Output file path")
    .action(async (options: MediaListOptions, command: Command) => {
      await mediaListCommand({ ...command.optsWithGlobals(), ...options });
    });
  return cmd;
}