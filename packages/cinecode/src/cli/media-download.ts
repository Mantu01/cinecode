import { Command } from "commander";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { loadConfig } from "../config/schema.js";
import { resolveProjectLocation } from "../config/project.js";
import { ensureGitignoreEntries } from "../config/gitignore.js";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";

interface DownloadOptions {
  force?: boolean;
  only?: string;
  config?: string;
  root?: string;
}

async function downloadFile(
  url: string,
  destPath: string,
  expectedHash?: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  const response = await fetch(url, {
    redirect: "follow",
  });

  if (!response.ok) {
    throw createError(ErrorCode.CC6002, { url, reason: `HTTP ${response.status}: ${response.statusText}` });
  }

  const total = parseInt(response.headers.get("content-length") ?? "0", 10);
  let downloaded = 0;

  await mkdir(resolve(destPath, ".."), { recursive: true });

  const fileStream = createWriteStream(destPath, { flags: "w" });
  const hash = expectedHash ? createHash("sha256") : null;

  if (response.body) {
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await new Promise<void>((resolvePromise, reject) => {
          fileStream.write(value, err => {
            if (err) reject(err);
            else resolvePromise();
          });
        });
        downloaded += value.length;
        if (hash) hash.update(value);
        if (onProgress) onProgress(downloaded, total);
      }
    } finally {
      fileStream.end();
    }
  } else {
    throw createError(ErrorCode.CC6002, { url, reason: "No response body" });
  }

  await new Promise<void>((resolvePromise, reject) => {
    fileStream.on("finish", resolvePromise);
    fileStream.on("error", reject);
  });

  if (expectedHash) {
    const actualHash = hash!.digest("hex");
    if (actualHash !== expectedHash.toLowerCase()) {
      throw createError(ErrorCode.CC6003, { url, expected: expectedHash, actual: actualHash });
    }
  }
}

function formatProgress(downloaded: number, total: number): string {
  const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
  const downloadedStr = formatBytes(downloaded);
  const totalStr = total > 0 ? formatBytes(total) : "unknown";
  const barWidth = 30;
  const filled = Math.round((pct / 100) * barWidth);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(barWidth - filled);
  return `[${bar}] ${pct}% (${downloadedStr}/${totalStr})`;
}

function formatBytes(bytes: number): string {
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

function getFileNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split("/").pop() ?? "download";
  } catch {
    return "download";
  }
}

export async function mediaDownloadCommand(options: DownloadOptions): Promise<void> {
  const location = resolveProjectLocation({ root: options.root, config: options.config });
  const config = await loadConfig(location.configPath);

  if (!config.gitignore) {
    console.warn("gitignore is disabled; downloaded media will not be ignored");
  } else {
    await ensureGitignoreEntries({
      sourceDir: config.sourceDir,
      outputDir: config.outputDir ?? "output",
      cacheDir: config.cacheDir ?? ".cinecode/cache",
      projectRoot: location.root,
      enabled: true,
    });
  }

  const cloudMedia = (config.cloudMedia ?? []).filter(m => !options.only || m.name === options.only || getFileNameFromUrl(m.url) === options.only);

  if (cloudMedia.length === 0) {
    console.log("No cloud media entries to download");
    return;
  }

  console.log(`Downloading ${cloudMedia.length} file(s) to ${resolve(location.root, config.sourceDir)}...`);
  console.log("");

  const results: Array<{ name: string; status: "ok" | "skipped" | "failed"; error?: string }> = [];
  runReport.setProject({ root: location.root, config: location.configPath });

  for (const entry of cloudMedia) {
    const fileName = entry.name ?? getFileNameFromUrl(entry.url);
    const destPath = resolve(location.root, config.sourceDir, fileName);

    try {
      await stat(destPath);
      if (!options.force) {
        console.log(`\u23e9  ${fileName} - already exists (use --force to re-download)`);
        results.push({ name: fileName, status: "skipped" });
        continue;
      }
    } catch {
      void 0;
    }

    if (!entry.url.startsWith("http://") && !entry.url.startsWith("https://")) {
      const err = createError(ErrorCode.CC6001, { url: entry.url });
      console.error(`\u2717  ${fileName} - ${err.message}`);
      results.push({ name: fileName, status: "failed", error: err.message });
      continue;
    }

    let lastProgressLine = "";
    try {
      await downloadFile(entry.url, destPath, entry.sha256, (downloaded, total) => {
        const line = formatProgress(downloaded, total);
        if (line !== lastProgressLine) {
          process.stdout.write(`\r  ${fileName}: ${line}`);
          lastProgressLine = line;
        }
      });
      process.stdout.write("\r\x1b[K");
      console.log(`\u2713  ${fileName} - done`);
      results.push({ name: fileName, status: "ok" });
      runReport.artifact({ kind: "media", path: destPath, units: 1, unit: "file" });
    } catch (e) {
      process.stdout.write("\r\x1b[K");
      const error = e instanceof Error ? e.message : "Unknown error";
      console.error(`\u2717  ${fileName} - ${error}`);
      results.push({ name: fileName, status: "failed", error });
    }
  }

  console.log("");
  const failed = results.filter(r => r.status === "failed").length;
  const ok = results.filter(r => r.status === "ok").length;
  const skipped = results.filter(r => r.status === "skipped").length;

  runReport.result({ downloaded: ok, skipped, failed, files: results });
  console.log(`Summary: ${ok} downloaded, ${skipped} skipped, ${failed} failed`);

  if (failed > 0) {
    throw createError(ErrorCode.CC6002, { url: `${failed} cloud media file(s)`, reason: results.filter(r => r.status === "failed").map(r => `${r.name}: ${r.error}`).join("; ") });
  }
}

export function createMediaDownloadCommand(): Command {
  const cmd = new Command("media:download")
    .description("Download cloud media files into source directory")
    .option("--force", "Re-download existing files", false)
    .option("--only <name>", "Download only the specified entry")
    .action(async (options: DownloadOptions, command: Command) => {
      await mediaDownloadCommand({ ...command.optsWithGlobals(), ...options });
    });
  return cmd;
}