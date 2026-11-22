import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runReport } from "./run-report.js";
import { createProjectResolver, reportResolution } from "./project-resolver.js";
import { inspectMedia, type MediaFileType } from "../media/index.js";

export interface MediaListOptions {
  json?: boolean;
  config?: string;
  root?: string;
  out?: string;
}

export interface MediaListOutput {
  readonly name: string;
  readonly type: MediaFileType;
  readonly duration: number;
  readonly resolution: string;
  readonly size: number;
  readonly origin: "local" | "cloud";
  readonly status: "ok" | "unreadable" | "referenced-but-missing" | "unreferenced";
  readonly referencedBy?: readonly string[];
}

export async function mediaListCommand(options: MediaListOptions): Promise<void> {
  const resolver = createProjectResolver({ root: options.root, config: options.config });
  const resolution = await resolver.resolve();
  reportResolution(resolution, (options as { verbose?: boolean }).verbose === true);
  const access = await resolution.media();

  const entries = access.index.list();
  const output: MediaListOutput[] = [];

  for (const entry of entries) {
    if (!entry.exists) {
      output.push({
        name: entry.name,
        type: entry.type,
        duration: 0,
        resolution: "unknown",
        size: 0,
        origin: entry.origin,
        status: "referenced-but-missing",
        referencedBy: entry.referencedBy.length > 0 ? entry.referencedBy : undefined,
      });
      continue;
    }

    let duration = 0;
    let resolutionStr = "unknown";
    let status: "ok" | "unreadable" | "unreferenced" = entry.state === "unreferenced" ? "unreferenced" : "ok";

    if (entry.type === "video" || entry.type === "image" || entry.type === "audio") {
      try {
        const metadata = await inspectMedia(entry.absolutePath, { cache: access.cache, sourceDir: resolution.context.roots.source });
        duration = metadata.duration ?? 0;
        resolutionStr = metadata.width && metadata.height ? `${metadata.width}x${metadata.height}` : "unknown";
      } catch {
        status = "unreadable";
      }
    }

    output.push({
      name: entry.name,
      type: entry.type,
      duration,
      resolution: resolutionStr,
      size: entry.size,
      origin: entry.origin,
      status,
      referencedBy: entry.referencedBy.length > 0 ? entry.referencedBy : undefined,
    });
  }

  runReport.result({ media: output });
  const outPath = options.out ? resolve(resolution.context.root, options.out) : undefined;
  if (options.json) {
    if (outPath) {
      writeFileSync(outPath, JSON.stringify(output, null, 2));
      runReport.artifact({ kind: "media-list", path: outPath, units: output.length, unit: "entries" });
    }
    return;
  }

  const table = formatTable(output);
  if (outPath) {
    writeFileSync(outPath, table);
    console.log(`Written to ${outPath}`);
  } else {
    console.log(table);
  }
}

function formatTable(items: MediaListOutput[]): string {
  if (items.length === 0) {
    return "No media files found.";
  }

  const headers = ["name", "type", "duration", "resolution", "size", "origin", "status", "referenced-by"];
  const rows = items.map(item => [
    item.name,
    item.type,
    formatDuration(item.duration),
    item.resolution,
    formatSize(item.size),
    item.origin,
    item.status,
    (item.referencedBy ?? []).join(", ") || "-",
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

import { findCommand, buildCommanderCommand } from "./command-registry.js";

export function createMediaListCommand(): Command {
  const spec = findCommand("media:list");
  if (!spec) throw new Error("Command 'media:list' not found in registry");
  return buildCommanderCommand(spec);
}