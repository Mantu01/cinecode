import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FrameCacheIndex } from "./cache.js";
import { objectPath } from "./cache.js";

export interface CacheGcOptions {
  readonly cacheDir: string;
  readonly maxSizeBytes?: number;
  readonly maxAgeDays?: number;
  readonly dryRun?: boolean;
  readonly now?: number;
}

export interface CacheGcResult {
  readonly removedObjects: number;
  readonly removedBytes: number;
  readonly removedIndexes: number;
  readonly retainedBytes: number;
  readonly scannedObjects: number;
  readonly dryRun: boolean;
}

export const DEFAULT_CACHE_MAX_BYTES = 10 * 1024 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

interface IndexFileState {
  readonly path: string;
  readonly hash: string;
  index: FrameCacheIndex;
  modified: number;
}

async function listIndexFiles(indexDir: string): Promise<string[]> {
  return (await readdir(indexDir).catch(() => [])).filter((file) => file.endsWith(".json"));
}

async function loadIndexFiles(cacheDir: string): Promise<IndexFileState[]> {
  const indexDir = join(cacheDir, "index");
  const files = await listIndexFiles(indexDir);
  const states: IndexFileState[] = [];
  for (const file of files) {
    const path = join(indexDir, file);
    try {
      const [raw, info] = await Promise.all([readFile(path, "utf-8"), stat(path)]);
      const index = JSON.parse(raw) as FrameCacheIndex;
      if (index.version !== 2 || typeof index.frames !== "object") continue;
      states.push({ path, hash: file.slice(0, -5), index, modified: info.mtimeMs });
    } catch {
      // Note: skip unreadable or corrupt cache index entry
      void 0;
    }
  }
  return states;
}

async function writeIndexAtomically(path: string, index: FrameCacheIndex): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.gc.tmp`;
  await writeFile(temp, JSON.stringify(index));
  await rename(temp, path);
}

async function listObjectFiles(cacheDir: string): Promise<Map<string, { path: string; size: number }>> {
  const objects = new Map<string, { path: string; size: number }>();
  const root = join(cacheDir, "objects");
  const prefixes = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const prefix of prefixes) {
    if (!prefix.isDirectory()) continue;
    const secondLevel = await readdir(join(root, prefix.name), { withFileTypes: true }).catch(() => []);
    for (const bucket of secondLevel) {
      if (!bucket.isDirectory()) continue;
      const files = await readdir(join(root, prefix.name, bucket.name), { withFileTypes: true }).catch(() => []);
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith(".raw")) continue;
        const fullPath = join(root, prefix.name, bucket.name, file.name);
        const info = await stat(fullPath).catch(() => null);
        objects.set(file.name.slice(0, -4), { path: fullPath, size: info?.size ?? 0 });
      }
    }
  }
  return objects;
}

function pruneIndexReferences(index: FrameCacheIndex, drop: (hash: string, frameKey: string) => boolean): boolean {
  let changed = false;
  for (const [frameKey, entry] of Object.entries(index.frames)) {
    if (!drop(entry.hash, frameKey)) continue;
    delete index.frames[frameKey];
    changed = true;
  }
  if (changed) {
    for (const [chunkKey, chunk] of Object.entries(index.chunks)) {
      const remaining = chunk.frames.filter((frameIndex) => index.frames[String(frameIndex)] !== undefined);
      if (remaining.length === chunk.frames.length) continue;
      if (remaining.length === 0) delete index.chunks[chunkKey];
      else index.chunks[chunkKey] = { frames: remaining, timestamp: chunk.timestamp };
    }
  }
  return changed;
}

export async function collectFrameCacheGarbage(options: CacheGcOptions): Promise<CacheGcResult> {
  const now = options.now ?? Date.now();
  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_CACHE_MAX_BYTES;
  const maxAgeDays = options.maxAgeDays;
  const dryRun = options.dryRun === true;
  const states = await loadIndexFiles(options.cacheDir);

  const accessByHash = new Map<string, number>();
  const sizeByHash = new Map<string, number>();
  for (const state of states) {
    for (const entry of Object.values(state.index.frames)) {
      accessByHash.set(entry.hash, Math.max(accessByHash.get(entry.hash) ?? 0, entry.access));
      sizeByHash.set(entry.hash, entry.size);
    }
    for (const chunk of Object.values(state.index.chunks)) {
      if (!chunk.payloadHash) continue;
      accessByHash.set(chunk.payloadHash, Math.max(accessByHash.get(chunk.payloadHash) ?? 0, chunk.timestamp));
      sizeByHash.set(chunk.payloadHash, chunk.payloadSize ?? 0);
    }
  }

  const evicted = new Set<string>();
  let removedIndexes = 0;

  if (maxAgeDays !== undefined) {
    const cutoff = now - maxAgeDays * DAY_MS;
    for (const state of states) {
      const referenced = Object.values(state.index.frames);
      const stale = referenced.length === 0 || referenced.every((entry) => entry.access < cutoff);
      if (!stale) continue;
      for (const entry of referenced) {
        const lastAccess = accessByHash.get(entry.hash) ?? 0;
        if (lastAccess < cutoff) evicted.add(entry.hash);
      }
      removedIndexes += 1;
      if (!dryRun) await rm(state.path, { force: true });
      state.index.frames = {};
      state.index.chunks = {};
    }
  }

  const referencedBytes = [...sizeByHash.entries()]
    .filter(([hash]) => !evicted.has(hash))
    .reduce((sum, [, size]) => sum + size, 0);

  if (referencedBytes > maxSizeBytes) {
    const candidates = [...accessByHash.entries()]
      .filter(([hash]) => !evicted.has(hash))
      .sort((left, right) => left[1] - right[1]);
    let remaining = referencedBytes;
    for (const [hash] of candidates) {
      if (remaining <= maxSizeBytes) break;
      evicted.add(hash);
      remaining -= sizeByHash.get(hash) ?? 0;
    }
  }

  let removedObjects = 0;
  let removedBytes = 0;
  const objects = await listObjectFiles(options.cacheDir);
  for (const hash of evicted) {
    const entry = objects.get(hash);
    if (!entry) continue;
    removedObjects += 1;
    removedBytes += entry.size;
    if (!dryRun) await rm(entry.path, { force: true });
  }

  if (evicted.size > 0) {
    const reloaded = await loadIndexFiles(options.cacheDir);
    for (const state of reloaded) {
      const changed = pruneIndexReferences(state.index, (hash) => evicted.has(hash));
      if (changed && !dryRun) await writeIndexAtomically(state.path, state.index);
    }
  }

  let retainedBytes = 0;
  let scannedObjects = 0;
  for (const [hash, entry] of objects) {
    scannedObjects += 1;
    if (evicted.has(hash)) continue;
    retainedBytes += entry.size;
    void hash;
  }

  return { removedObjects, removedBytes, removedIndexes, retainedBytes, scannedObjects, dryRun };
}

export async function pruneStaleEntries(
  cacheDir: string,
  maxAgeDays: number,
  options: Omit<CacheGcOptions, "cacheDir" | "maxAgeDays"> = {},
): Promise<CacheGcResult> {
  return collectFrameCacheGarbage({ ...options, cacheDir, maxAgeDays });
}

export async function enforceCacheQuota(
  cacheDir: string,
  maxSizeBytes: number,
  options: Omit<CacheGcOptions, "cacheDir" | "maxSizeBytes"> = {},
): Promise<CacheGcResult> {
  return collectFrameCacheGarbage({ ...options, cacheDir, maxSizeBytes });
}

export function formatCacheGcResult(result: CacheGcResult): string {
  const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  const prefix = result.dryRun ? "would remove" : "removed";
  return `${prefix} ${result.removedObjects} object(s) (${megabytes(result.removedBytes)}), ${result.removedIndexes} stale index file(s); retained ${megabytes(result.retainedBytes)} across ${result.scannedObjects} object(s)`;
}

export function objectFilePath(cacheDir: string, hash: string): string {
  return objectPath(cacheDir, hash);
}
