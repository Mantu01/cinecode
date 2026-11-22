import { Command } from "commander";
import { createWriteStream } from "node:fs";
import { mkdir, stat, unlink, rename } from "node:fs/promises";
import { resolve, relative, join, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ensureGitignoreEntries } from "../config/gitignore.js";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";
import { createProjectResolver, reportResolution } from "./project-resolver.js";

export interface DownloadOptions {
  force?: boolean;
  confirm?: boolean;
  only?: string;
  config?: string;
  root?: string;
  verbose?: boolean;
  timeoutMs?: number;
}

export type MediaDownloadOptions = DownloadOptions;

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB guard
const MAX_RETRIES = 3;

export async function downloadFileAtomic(
  url: string,
  destPath: string,
  expectedHash?: string,
  options: { timeoutMs?: number; mediaDir?: string; sourceDir?: string } = {},
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  const mediaDir = options.mediaDir ? resolve(options.mediaDir) : dirname(resolve(destPath));
  const sourceDir = options.sourceDir ? resolve(options.sourceDir) : undefined;
  const resolvedDest = resolve(destPath);

  // Downloader guardrail: never target authored source directory
  if (sourceDir && (resolvedDest === sourceDir || resolvedDest.startsWith(sourceDir + "/") || resolvedDest.startsWith(sourceDir + "\\"))) {
    throw createError(ErrorCode.CC1010, {
      path: resolvedDest,
      reason: `Downloader refusing to target authored source directory "${sourceDir}". Media must be saved to media root.`,
    });
  }

  await mkdir(dirname(resolvedDest), { recursive: true });

  const tempName = `.${randomUUID().slice(0, 8)}.${Date.now()}.tmp`;
  const tempPath = join(dirname(resolvedDest), tempName);

  let attempt = 0;
  let lastError: unknown;

  while (attempt < MAX_RETRIES) {
    attempt++;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Download timed out after ${timeoutMs}ms`)), timeoutMs);

    let downloaded = 0;
    const hash = expectedHash ? createHash("sha256") : null;
    let fileStream: ReturnType<typeof createWriteStream> | undefined;

    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw createError(ErrorCode.CC6002, { url, reason: `HTTP ${response.status}: ${response.statusText}` });
      }

      const contentLengthHeader = response.headers.get("content-length");
      const total = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
      if (total > MAX_DOWNLOAD_SIZE_BYTES) {
        throw createError(ErrorCode.CC6002, {
          url,
          reason: `File size ${total} bytes exceeds maximum allowed download size of ${MAX_DOWNLOAD_SIZE_BYTES} bytes`,
        });
      }

      if (!response.body) {
        throw createError(ErrorCode.CC6002, { url, reason: "No response body received" });
      }

      fileStream = createWriteStream(tempPath, { flags: "w" });
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        downloaded += value.length;
        if (downloaded > MAX_DOWNLOAD_SIZE_BYTES) {
          throw createError(ErrorCode.CC6002, {
            url,
            reason: `Download exceeded maximum limit of ${MAX_DOWNLOAD_SIZE_BYTES} bytes`,
          });
        }

        await new Promise<void>((res, rej) => {
          fileStream!.write(value, err => (err ? rej(err) : res()));
        });

        if (hash) hash.update(value);
        if (onProgress) onProgress(downloaded, total);
      }

      await new Promise<void>((res, rej) => {
        fileStream!.on("finish", res);
        fileStream!.on("error", rej);
        fileStream!.end();
      });
      fileStream = undefined;

      // Verify hash if specified
      if (expectedHash) {
        const actualHash = hash!.digest("hex");
        if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
          throw createError(ErrorCode.CC6003, { url, expected: expectedHash, actual: actualHash });
        }
      }

      // Atomic rename into place
      await rename(tempPath, resolvedDest);
      clearTimeout(timer);
      return;
    } catch (err) {
      clearTimeout(timer);
      if (fileStream) {
        fileStream.destroy();
      }
      await unlink(tempPath).catch(() => {});
      lastError = err;

      // Do not retry on explicit hash mismatch or size limit
      if (typeof (err as { code?: unknown })?.code === "string" && (err as { code?: unknown }).code === ErrorCode.CC6003) {
        throw err;
      }

      if (attempt < MAX_RETRIES) {
        const backoff = 100 * (2 ** (attempt - 1));
        await new Promise(r => setTimeout(r, backoff));
      }
    }
  }

  await unlink(tempPath).catch(() => {});
  if (lastError instanceof Error) throw lastError;
  throw createError(ErrorCode.CC6002, { url, reason: String(lastError) });
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
  if (!options.confirm) {
    throw createError(ErrorCode.CC7004, { reason: "Network opt-in missing: rerun `cinecode media:download --confirm`." });
  }
  const resolver = createProjectResolver({ root: options.root, config: options.config });
  const resolution = await resolver.resolve();
  reportResolution(resolution, options.verbose === true);
  const config = resolution.config;

  const mediaDir = resolve(resolution.root, config.mediaDir);
  const sourceDir = resolve(resolution.root, config.sourceDir);

  if (!config.gitignore) {
    console.warn("gitignore is disabled; downloaded media will not be ignored");
  } else {
    await ensureGitignoreEntries({
      mediaDir: config.mediaDir,
      outputDir: config.outputDir ?? "output",
      cacheDir: config.cacheDir ?? ".cinecode/cache",
      projectRoot: resolution.root,
      enabled: true,
      ignoreMedia: false,
    });
  }

  const cloudMedia = (config.cloudMedia ?? []).filter(
    m => !options.only || m.name === options.only || getFileNameFromUrl(m.url) === options.only,
  );

  if (cloudMedia.length === 0) {
    console.log("No cloud media entries to download");
    return;
  }

  console.log(`Downloading ${cloudMedia.length} file(s) to ${mediaDir}...`);
  console.log("");

  const results: Array<{ name: string; status: "ok" | "skipped" | "failed"; error?: string }> = [];

  for (const entry of cloudMedia) {
    const fileName = entry.name ?? getFileNameFromUrl(entry.url);
    const destPath = resolve(mediaDir, fileName);

    try {
      await stat(destPath);
      if (!options.force) {
        console.log(`\u23e9  ${fileName} - already exists (use --force to re-download)`);
        results.push({ name: fileName, status: "skipped" });
        continue;
      }
    } catch {
      // Note: file does not exist, proceed with download
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
      await downloadFileAtomic(
        entry.url,
        destPath,
        entry.sha256,
        { mediaDir, sourceDir, timeoutMs: options.timeoutMs },
        (downloaded, total) => {
          const line = formatProgress(downloaded, total);
          if (line !== lastProgressLine) {
            process.stderr.write(`\r  ${fileName}: ${line}`);
            lastProgressLine = line;
          }
        },
      );
      process.stderr.write("\r\x1b[K");
      process.stderr.write(`\u2713  ${fileName} - done\n`);
      results.push({ name: fileName, status: "ok" });
      runReport.artifact({ kind: "media", path: destPath, units: 1, unit: "file" });
    } catch (e) {
      process.stderr.write("\r\x1b[K");
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
    throw createError(ErrorCode.CC6002, {
      url: `${failed} cloud media file(s)`,
      reason: results.filter(r => r.status === "failed").map(r => `${r.name}: ${r.error}`).join("; "),
    });
  }
}

import { findCommand, buildCommanderCommand } from "./command-registry.js";

export function createMediaDownloadCommand(): Command {
  const spec = findCommand("media:download");
  if (!spec) throw new Error("Command 'media:download' not found in registry");
  return buildCommanderCommand(spec);
}
