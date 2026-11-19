import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm, stat, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface MediaMetadata {
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly hasAudio: boolean;
  readonly sampleRate?: number;
  readonly channels?: number;
  readonly videoCodec?: string;
  readonly audioCodec?: string;
}

export interface CacheEntry<T> {
  readonly key: string;
  readonly value: T;
  readonly timestamp: number;
  readonly fileMtime: number;
  readonly fileSize: number;
  readonly sourcePath?: string;
}

export interface FrameCacheEntry {
  readonly key: string;
  readonly frameIndex: number;
  readonly buffer: Buffer;
  readonly timestamp: number;
}

const DEFAULT_MAX_FRAMES = 2048;

async function safeMkdir(dir: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      await mkdir(dir, { recursive: true });
      return;
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "EPERM" && i < 4) {
        await new Promise((r) => setTimeout(r, 25 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
}

export class MediaCache {
  private readonly cacheDir: string;
  private readonly metadataDir: string;
  private readonly frameDir: string;
  private readonly remoteDir: string;
  private readonly maxFrames: number;
  private frameAccessOrder: string[] = [];
  private hits = 0;
  private misses = 0;
  private frameBytes = 0;

  constructor(cacheDir: string, maxFrames = DEFAULT_MAX_FRAMES) {
    this.cacheDir = cacheDir;
    this.metadataDir = join(cacheDir, "metadata");
    this.frameDir = join(cacheDir, "frames");
    this.remoteDir = join(cacheDir, "remote");
    this.maxFrames = maxFrames;
  }

  async initialize(): Promise<void> {
    await safeMkdir(this.metadataDir);
    await safeMkdir(this.frameDir);
    await safeMkdir(this.remoteDir);
    await this.loadFrameAccessOrder();
  }

  private async loadFrameAccessOrder(): Promise<void> {
    try {
      const files = await readdir(this.frameDir);
      this.frameAccessOrder = files
        .filter(f => f.endsWith(".bin"))
        .map(f => f.slice(0, -4))
        .sort();
    } catch {
      this.frameAccessOrder = [];
    }
  }

  private getCacheKey(filePath: string, extra: string = ""): string {
    const hash = createHash("sha256");
    hash.update(filePath);
    hash.update(extra);
    return hash.digest("hex");
  }

  async getMetadata(filePath: string): Promise<MediaMetadata | null> {
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat) return null;

    const key = this.getCacheKey(filePath);
    const cachePath = join(this.metadataDir, `${key}.json`);

    try {
      const content = await readFile(cachePath, "utf-8");
      const entry: CacheEntry<MediaMetadata> = JSON.parse(content);

      if (entry.fileMtime === fileStat.mtimeMs && entry.fileSize === fileStat.size) {
        this.hits += 1;
        return entry.value;
      }
    } catch {
      this.misses += 1;
      return null;
    }

    this.misses += 1;
    return null;
  }

  async setMetadata(filePath: string, metadata: MediaMetadata): Promise<void> {
    const fileStat = await stat(filePath);
    const key = this.getCacheKey(filePath);
    const cachePath = join(this.metadataDir, `${key}.json`);

    const entry: CacheEntry<MediaMetadata> = {
      key,
      value: metadata,
      timestamp: Date.now(),
      fileMtime: fileStat.mtimeMs,
      fileSize: fileStat.size,
      sourcePath: filePath,
    };

    await writeFile(cachePath, JSON.stringify(entry));
  }

  async getFrame(filePath: string, frameIndex: number): Promise<Buffer | null> {
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat) return null;

    const key = this.getCacheKey(filePath, `frame-${frameIndex}`);
    const cachePath = join(this.frameDir, `${key}.bin`);

    try {
      const buffer = await readFile(cachePath);
      this.updateFrameAccess(key);
      this.hits += 1;
      return buffer;
    } catch {
      this.misses += 1;
      return null;
    }
  }

  /**
   * Get multiple consecutive frames from cache in batch.
   * Returns null if any frame is missing (caller should extract them).
   */
  async getBatchFrames(filePath: string, startFrame: number, count: number): Promise<Buffer[] | null> {
    const buffers: Buffer[] = [];
    for (let i = 0; i < count; i++) {
      const frameIndex = startFrame + i;
      const key = this.getCacheKey(filePath, `frame-${frameIndex}`);
      const cachePath = join(this.frameDir, `${key}.bin`);

      try {
        const buffer = await readFile(cachePath);
        this.updateFrameAccess(key);
        buffers.push(buffer);
      } catch {
        // Missing frame - return null to trigger extraction
        return null;
      }
    }
    return buffers;
  }

  async setFrame(filePath: string, frameIndex: number, buffer: Buffer): Promise<void> {
    await stat(filePath);
    const key = this.getCacheKey(filePath, `frame-${frameIndex}`);
    const cachePath = join(this.frameDir, `${key}.bin`);

    await writeFile(cachePath, buffer);
    this.frameBytes += buffer.length;
    this.updateFrameAccess(key);
    await this.evictIfNeeded();
  }

  private updateFrameAccess(key: string): void {
    const index = this.frameAccessOrder.indexOf(key);
    if (index !== -1) {
      this.frameAccessOrder.splice(index, 1);
    }
    this.frameAccessOrder.push(key);
  }

  private async evictIfNeeded(): Promise<void> {
    while (this.frameAccessOrder.length > this.maxFrames) {
      const oldestKey = this.frameAccessOrder.shift();
      if (!oldestKey) break;
      const cachePath = join(this.frameDir, `${oldestKey}.bin`);
      const statResult = await stat(cachePath).catch(() => null);
      if (statResult) this.frameBytes -= statResult.size;
      await rm(cachePath, { force: true });
    }
  }

  async clear(): Promise<void> {
    await rm(this.metadataDir, { recursive: true, force: true });
    await rm(this.frameDir, { recursive: true, force: true });
    await rm(this.remoteDir, { recursive: true, force: true });
    await mkdir(this.metadataDir, { recursive: true });
    await mkdir(this.frameDir, { recursive: true });
    await mkdir(this.remoteDir, { recursive: true });
    this.frameAccessOrder = [];
    this.hits = 0;
    this.misses = 0;
    this.frameBytes = 0;
  }

  /** Removes metadata entries whose source file no longer exists. */
  async pruneMissingSources(): Promise<number> {
    let removed = 0;
    const files = await readdir(this.metadataDir).catch(() => [] as string[]);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const cachePath = join(this.metadataDir, file);
      const raw = await readFile(cachePath, "utf-8").catch(() => null);
      if (raw === null) continue;
      let entry: CacheEntry<MediaMetadata>;
      try {
        entry = JSON.parse(raw) as CacheEntry<MediaMetadata>;
      } catch {
        await rm(cachePath, { force: true });
        removed += 1;
        continue;
      }
      if (!entry.sourcePath) continue;
      const source = await stat(entry.sourcePath).catch(() => null);
      if (source) continue;
      await rm(cachePath, { force: true });
      removed += 1;
    }
    return removed;
  }

  remoteFilePath(uri: string): string {
    const key = this.getCacheKey(uri);
    const match = /\.([A-Za-z0-9]{1,8})(?:[?#].*)?$/.exec(uri);
    const extension = match ? match[1]!.toLowerCase() : "bin";
    return join(this.remoteDir, `${key}.${extension}`);
  }

  async getRemote(uri: string): Promise<Buffer | null> {
    const path = this.remoteFilePath(uri);
    try {
      const buffer = await readFile(path);
      this.hits += 1;
      return buffer;
    } catch {
      this.misses += 1;
      return null;
    }
  }

  async setRemote(uri: string, buffer: Buffer): Promise<string> {
    const path = this.remoteFilePath(uri);
    await writeFile(path, buffer);
    return path;
  }

  async clearRemote(): Promise<void> {
    await rm(this.remoteDir, { recursive: true, force: true });
    await mkdir(this.remoteDir, { recursive: true });
  }

  async getStats(): Promise<MediaCacheStats> {
    const [metadataFiles, frameFiles] = await Promise.all([
      readdir(this.metadataDir).catch(() => []),
      readdir(this.frameDir).catch(() => []),
    ]);
    const lookups = this.hits + this.misses;
    return {
      metadataEntries: metadataFiles.length,
      frameEntries: frameFiles.length,
      hits: this.hits,
      misses: this.misses,
      hitRate: lookups > 0 ? this.hits / lookups : 0,
      frameBytes: this.frameBytes,
    };
  }
}

export interface MediaCacheStats {
  readonly metadataEntries: number;
  readonly frameEntries: number;
  readonly hits: number;
  readonly misses: number;
  readonly hitRate: number;
  readonly frameBytes: number;
}

export function createMediaCache(cacheDir: string, maxFrames = DEFAULT_MAX_FRAMES): MediaCache {
  return new MediaCache(cacheDir, maxFrames);
}