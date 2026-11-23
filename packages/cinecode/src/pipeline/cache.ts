import { mkdir, readFile, rename, rm, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { recordDegradation } from "../errors/degradations.js";
import { CACHE_FORMAT_VERSION } from "../contracts.js";
import { deriveCacheKey } from "./cache-identity.js";
import type { FrameCacheIndex, RenderCacheStats } from "./cache-types.js";
import { runCacheGarbageCollection, type CacheGcOptions, type CacheGcResult } from "./cache-prune.js";

export * from "./cache-types.js";
export * from "./cache-identity.js";
export * from "./cache-prune.js";

export const CACHE_FORMAT = CACHE_FORMAT_VERSION;

export function objectPath(cacheDir: string, hash: string): string {
  return join(cacheDir, "objects", hash.slice(0, 2), hash.slice(2, 4), `${hash}.raw`);
}

export class RenderCache {
  private readonly cacheDir: string;
  private readonly objectsDir: string;
  private readonly indexDir: string;
  private readonly indexes = new Map<string, FrameCacheIndex>();
  private readonly dirtyIndexes = new Set<string>();

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
    this.objectsDir = join(cacheDir, "objects");
    this.indexDir = join(cacheDir, "index");
  }

  async initialize(): Promise<void> {
    await mkdir(this.objectsDir, { recursive: true });
    await mkdir(this.indexDir, { recursive: true });
  }

  private indexPath(compositionHash: string): string {
    return join(this.indexDir, `${compositionHash}.json`);
  }

  private emptyIndex(compositionHash: string, compositionId: string): FrameCacheIndex {
    return { version: 2, compositionId, compositionHash, frames: {}, chunks: {} };
  }

  private async loadIndex(compositionHash: string, compositionId = "unknown"): Promise<FrameCacheIndex> {
    const cached = this.indexes.get(compositionHash);
    if (cached) return cached;
    try {
      const raw = await readFile(this.indexPath(compositionHash), "utf-8");
      const parsed = JSON.parse(raw) as FrameCacheIndex;
      if (parsed.version === 2 && typeof parsed.frames === "object") {
        this.indexes.set(compositionHash, parsed);
        return parsed;
      }
      recordDegradation({
        code: "CC4007",
        what: "render cache index ignored",
        reason: `unsupported index version ${String((parsed as { version?: unknown }).version)}`,
        input: this.indexPath(compositionHash),
        instead: "frames are recomputed for this composition",
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        recordDegradation({
          code: "CC4007",
          what: "render cache index unreadable",
          reason: error instanceof Error ? error.message : String(error),
          input: this.indexPath(compositionHash),
          instead: "frames are recomputed for this composition",
        });
      }
    }
    const index = this.emptyIndex(compositionHash, compositionId);
    this.indexes.set(compositionHash, index);
    return index;
  }

  private markDirty(compositionHash: string): void {
    this.dirtyIndexes.add(compositionHash);
  }

  async flushIndexes(): Promise<void> {
    const hashes = [...this.dirtyIndexes];
    this.dirtyIndexes.clear();
    await Promise.all(hashes.map(async (hash) => {
      const index = this.indexes.get(hash);
      if (!index) return;
      const target = this.indexPath(hash);
      await mkdir(dirname(target), { recursive: true });
      const temp = `${target}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(index));
      await rename(temp, target);
    }));
  }

  async getFrame(compositionHash: string, frameIndex: number): Promise<Buffer | null> {
    const index = await this.loadIndex(compositionHash);
    const entry = index.frames[String(frameIndex)];
    if (!entry) return null;
    try {
      const payload = await readFile(objectPath(this.cacheDir, entry.hash));
      if (entry.offset !== undefined) {
        return payload.subarray(entry.offset, entry.offset + entry.size);
      }
      return payload;
    } catch (error) {
      delete index.frames[String(frameIndex)];
      this.markDirty(compositionHash);
      recordDegradation({
        code: "CC4007",
        what: "cached frame discarded",
        reason: error instanceof Error ? error.message : String(error),
        input: objectPath(this.cacheDir, entry.hash),
        instead: "the frame is re-rendered",
      });
      return null;
    }
  }

  async hasFrame(compositionHash: string, frameIndex: number): Promise<boolean> {
    const index = await this.loadIndex(compositionHash);
    return index.frames[String(frameIndex)] !== undefined;
  }

  async setFrame(
    compositionHash: string,
    frameIndex: number,
    hash: string,
    buffer: Buffer,
    chunkIndex?: number,
  ): Promise<void> {
    const index = await this.loadIndex(compositionHash);
    const target = objectPath(this.cacheDir, hash);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer);
    index.frames[String(frameIndex)] = {
      hash,
      size: buffer.length,
      access: Date.now(),
      ...(chunkIndex === undefined ? {} : { chunkIndex }),
    };
    this.markDirty(compositionHash);
  }

  frameKey(compositionHash: string, frameIndex: number, seed = 0, descriptorHash?: string): string {
    if (descriptorHash !== undefined) return descriptorHash;
    return deriveCacheKey({ compositionHash, frameIndex, seed });
  }

  async hasChunk(compositionHash: string, chunkIndex: number): Promise<boolean> {
    const index = await this.loadIndex(compositionHash);
    return index.chunks[String(chunkIndex)] !== undefined;
  }

  async getChunk(
    compositionHash: string,
    chunkIndex: number,
  ): Promise<ReadonlyArray<{ index: number; buffer: Buffer }> | null> {
    const index = await this.loadIndex(compositionHash);
    const chunk = index.chunks[String(chunkIndex)];
    if (!chunk) return null;
    if (chunk.payloadHash) {
      try {
        const payload = await readFile(objectPath(this.cacheDir, chunk.payloadHash));
        const count = payload.readUInt32BE(0);
        const dataStart = 4 + count * 8;
        const frames: { index: number; buffer: Buffer }[] = [];
        let cursor = dataStart;
        for (let position = 0; position < count; position += 1) {
          const tableOffset = 4 + position * 8;
          const frameIndex = payload.readInt32BE(tableOffset);
          const length = payload.readUInt32BE(tableOffset + 4);
          frames.push({ index: frameIndex, buffer: payload.subarray(cursor, cursor + length) });
          cursor += length;
        }
        return frames;
      } catch (error) {
        recordDegradation({
          code: "CC4007",
          what: "cached chunk discarded",
          reason: error instanceof Error ? error.message : String(error),
          input: objectPath(this.cacheDir, chunk.payloadHash),
          instead: "the chunk is re-rendered",
        });
        return null;
      }
    }
    const frames: { index: number; buffer: Buffer }[] = [];
    for (const frameIndex of chunk.frames) {
      const buffer = await this.getFrame(compositionHash, frameIndex);
      if (!buffer) return null;
      frames.push({ index: frameIndex, buffer });
    }
    if (frames.length !== chunk.frames.length) return null;
    return frames;
  }

  async setChunk(
    compositionHash: string,
    chunkIndex: number,
    frames: readonly { readonly index: number; readonly buffer: Buffer }[],
  ): Promise<void> {
    const index = await this.loadIndex(compositionHash);
    const storedFrames: number[] = [];
    const tableSize = 4 + frames.length * 8;
    const payloadSize = tableSize + frames.reduce((sum, frame) => sum + frame.buffer.length, 0);
    const payload = Buffer.alloc(payloadSize);
    payload.writeUInt32BE(frames.length, 0);
    let offset = tableSize;
    let tableIndex = 4;
    for (const frame of frames) {
      payload.writeInt32BE(frame.index, tableIndex);
      payload.writeUInt32BE(frame.buffer.length, tableIndex + 4);
      frame.buffer.copy(payload, offset);
      offset += frame.buffer.length;
      tableIndex += 8;
    }
    const payloadHash = deriveCacheKey(payload);
    const target = objectPath(this.cacheDir, payloadHash);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, payload);
    let dataOffset = tableSize;
    for (const frame of frames) {
      index.frames[String(frame.index)] = {
        hash: payloadHash,
        size: frame.buffer.length,
        access: Date.now(),
        chunkIndex,
        offset: dataOffset,
      };
      dataOffset += frame.buffer.length;
      storedFrames.push(frame.index);
    }
    index.chunks[String(chunkIndex)] = {
      frames: storedFrames,
      timestamp: Date.now(),
      payloadHash,
      payloadSize: payload.length,
    };
    this.markDirty(compositionHash);
  }

  /** Records a chunk whose frames were already written with `setFrame`. */
  async markChunk(compositionHash: string, chunkIndex: number, frameIndexes: readonly number[]): Promise<void> {
    const index = await this.loadIndex(compositionHash);
    index.chunks[String(chunkIndex)] = {
      frames: [...frameIndexes].sort((left, right) => left - right),
      timestamp: Date.now(),
    };
    this.markDirty(compositionHash);
  }

  indexFilePath(compositionHash: string): string {
    return this.indexPath(compositionHash);
  }

  async referencedHashes(): Promise<Set<string>> {
    const hashes = new Set<string>();
    for (const file of await this.listIndexFiles()) {
      const hash = file.slice(0, -5);
      const index = await this.loadIndex(hash);
      for (const entry of Object.values(index.frames)) hashes.add(entry.hash);
    }
    return hashes;
  }

  private async listIndexFiles(): Promise<string[]> {
    try {
      return (await readdir(this.indexDir)).filter((file) => file.endsWith(".json"));
    } catch (error) {
      recordDegradation({
        code: "CC4007",
        what: "render cache index directory unreadable",
        reason: error instanceof Error ? error.message : String(error),
        input: this.indexDir,
        instead: "cache statistics and invalidation act on an empty index",
      });
      return [];
    }
  }

  async invalidate(compositionHash: string): Promise<void> {
    const index = await this.loadIndex(compositionHash);
    const hashes = new Set(Object.values(index.frames).map((entry) => entry.hash));
    const remaining = await this.referencedHashes();
    for (const hash of hashes) {
      if (remaining.has(hash)) continue;
      await rm(objectPath(this.cacheDir, hash), { force: true });
    }
    this.indexes.delete(compositionHash);
    this.dirtyIndexes.delete(compositionHash);
    await rm(this.indexPath(compositionHash), { force: true });
  }

  async clear(): Promise<void> {
    this.indexes.clear();
    this.dirtyIndexes.clear();
    await rm(this.objectsDir, { recursive: true, force: true });
    await rm(this.indexDir, { recursive: true, force: true });
    await mkdir(this.objectsDir, { recursive: true });
    await mkdir(this.indexDir, { recursive: true });
  }

  async getStats(): Promise<RenderCacheStats> {
    const files = await this.listIndexFiles();
    let totalFrames = 0;
    let sizeBytes = 0;
    for (const file of files) {
      const index = await this.loadIndex(file.slice(0, -5));
      totalFrames += Object.keys(index.frames).length;
      sizeBytes += Object.values(index.frames).reduce((sum, entry) => sum + entry.size, 0);
    }
    return { entries: files.length, totalFrames, sizeBytes };
  }

  async garbageCollect(options: CacheGcOptions = {}): Promise<CacheGcResult> {
    return runCacheGarbageCollection({
      objectsDir: this.objectsDir,
      indexDir: this.indexDir,
      indexPath: (h) => this.indexPath(h),
      listIndexFiles: () => this.listIndexFiles(),
      loadIndex: (h) => this.loadIndex(h),
      invalidate: (h) => this.invalidate(h),
      options,
    });
  }
}

export function createRenderCache(cacheDir: string): RenderCache {
  return new RenderCache(cacheDir);
}
