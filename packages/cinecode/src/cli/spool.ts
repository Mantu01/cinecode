import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const MAX_SPOOL_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_SPOOL_FILES = 10;
export const MAX_SPOOL_TOTAL_BYTES = 10 * 1024 * 1024;

export interface SpoolSweepResult {
  sweptCount: number;
  sweptBytes: number;
  sweptFiles: string[];
}

export function sweepSpools(cacheDir?: string): SpoolSweepResult {
  const result: SpoolSweepResult = { sweptCount: 0, sweptBytes: 0, sweptFiles: [] };
  const dirs = cacheDir
    ? [join(cacheDir, "spool"), cacheDir].filter((d) => existsSync(d))
    : [join(tmpdir(), "cinecode")].filter((d) => existsSync(d));

  const now = Date.now();
  const candidates: Array<{ path: string; size: number; mtimeMs: number }> = [];

  for (const dir of dirs) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name.startsWith("machine-stdout-") || entry.name.startsWith("spool-") || entry.name.endsWith(".spool.log")) {
          const filePath = join(dir, entry.name);
          try {
            const stat = statSync(filePath);
            candidates.push({ path: filePath, size: stat.size, mtimeMs: stat.mtimeMs });
          } catch {
            // Note: Ignore concurrent removal
          }
        }
      }
    } catch {
      // Note: Ignore directory read error
    }
  }

  // Sort newest first
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  let cumulativeBytes = 0;
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i]!;
    cumulativeBytes += item.size;
    const isOld = now - item.mtimeMs > MAX_SPOOL_AGE_MS;
    const isOverCount = i >= MAX_SPOOL_FILES;
    const isOverBytes = cumulativeBytes > MAX_SPOOL_TOTAL_BYTES;

    if (isOld || isOverCount || isOverBytes) {
      try {
        unlinkSync(item.path);
        result.sweptCount++;
        result.sweptBytes += item.size;
        result.sweptFiles.push(item.path);
      } catch {
        // Note: Ignore removal error
      }
    }
  }

  return result;
}
