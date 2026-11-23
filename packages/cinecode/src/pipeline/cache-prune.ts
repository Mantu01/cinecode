import { stat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { FrameCacheIndex } from "./cache-types.js";

export interface CacheGcOptions {
  readonly maxSizeBytes?: number;
  readonly maxAgeMs?: number;
}

export interface CacheGcResult {
  readonly bytesReclaimed: number;
  readonly filesDeleted: number;
}

interface IndexInfo {
  readonly file: string;
  readonly hash: string;
  readonly path: string;
  mtime: number;
  index: FrameCacheIndex;
}

interface ObjectFileInfo {
  readonly path: string;
  readonly size: number;
  readonly mtime: number;
}

export async function runCacheGarbageCollection(context: {
  readonly objectsDir: string;
  readonly indexDir: string;
  readonly indexPath: (hash: string) => string;
  readonly listIndexFiles: () => Promise<string[]>;
  readonly loadIndex: (hash: string) => Promise<FrameCacheIndex>;
  readonly invalidate: (hash: string) => Promise<void>;
  readonly options?: CacheGcOptions;
}): Promise<CacheGcResult> {
  const { objectsDir, indexPath, listIndexFiles, loadIndex, invalidate, options = {} } = context;
  const now = Date.now();
  let bytesReclaimed = 0;
  let filesDeleted = 0;

  const files = await listIndexFiles();
  const indexInfos: IndexInfo[] = [];
  for (const file of files) {
    const hash = file.slice(0, -5);
    const filePath = indexPath(hash);
    const st = await stat(filePath).catch(() => null);
    if (!st) continue;
    const index = await loadIndex(hash);
    indexInfos.push({
      file,
      hash,
      path: filePath,
      mtime: st.mtimeMs,
      index,
    });
  }

  if (options.maxAgeMs !== undefined && options.maxAgeMs > 0) {
    for (let i = indexInfos.length - 1; i >= 0; i--) {
      const item = indexInfos[i]!;
      if (now - item.mtime > options.maxAgeMs) {
        await invalidate(item.hash);
        indexInfos.splice(i, 1);
        filesDeleted += 1;
      }
    }
  }

  const objectFiles: ObjectFileInfo[] = [];
  let totalObjectBytes = 0;

  const scanDir = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile()) {
        const st = await stat(fullPath).catch(() => null);
        if (st) {
          objectFiles.push({ path: fullPath, size: st.size, mtime: st.mtimeMs });
          totalObjectBytes += st.size;
        }
      }
    }
  };

  await scanDir(objectsDir);

  if (options.maxSizeBytes !== undefined && options.maxSizeBytes > 0 && totalObjectBytes > options.maxSizeBytes) {
    objectFiles.sort((a, b) => a.mtime - b.mtime);
    for (const obj of objectFiles) {
      if (totalObjectBytes <= options.maxSizeBytes) break;
      await rm(obj.path, { force: true }).catch(() => undefined);
      totalObjectBytes -= obj.size;
      bytesReclaimed += obj.size;
      filesDeleted += 1;
    }
  }

  return { bytesReclaimed, filesDeleted };
}
