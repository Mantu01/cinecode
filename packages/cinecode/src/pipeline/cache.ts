import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface MediaFingerprint {
  readonly src: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly modifiedMs: number;
}

export interface FrameCacheDescriptor {
  readonly compositionId: string;
  readonly compositionHash: string;
  readonly frameIndex: number;
  readonly media: readonly MediaFingerprint[];
  readonly clips: unknown;
  readonly effects: unknown;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly workingColorSpace: string;
}

export interface FrameCacheIndexEntry {
  readonly hash: string;
  readonly size: number;
  readonly access: number;
  readonly chunkIndex?: number;
}

export interface FrameCacheIndex {
  readonly version: 2;
  readonly compositionId: string;
  readonly compositionHash: string;
  frames: Record<string, FrameCacheIndexEntry>;
  chunks: Record<string, { readonly frames: readonly number[]; readonly timestamp: number }>;
}

export interface RenderCacheEntry {
  readonly key: string;
  readonly frames: readonly { readonly index: number; readonly length?: number; readonly buffer?: Buffer }[];
  readonly timestamp: number;
  readonly compositionHash: string;
  readonly chunkIndex: number;
}

export interface RenderCacheStats {
  readonly entries: number;
  readonly totalFrames: number;
  readonly sizeBytes: number;
}

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "bigint") return value.toString();
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return createHash("sha256")
      .update(Buffer.from(view.buffer, view.byteOffset, view.byteLength))
      .digest("hex");
  }
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()]
        .map(([key, entry]) => [String(key), canonicalize(entry)] as const)
        .sort((left, right) => left[0].localeCompare(right[0])),
    );
  }
  if (value instanceof Set) {
    return [...value].map(canonicalize).map((entry) => canonicalJsonString(entry)).sort();
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] === undefined) continue;
    sorted[key] = canonicalize(record[key]);
  }
  return sorted;
}

export function computeDescriptorHash(descriptor: FrameCacheDescriptor): string {
  return createHash("sha256").update(canonicalJsonString(descriptor)).digest("hex");
}

export function createFrameCacheDescriptor(input: {
  readonly compositionId: string;
  readonly compositionHash: string;
  readonly frameIndex: number;
  readonly media?: readonly MediaFingerprint[];
  readonly clips?: unknown;
  readonly effects?: unknown;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio?: number;
  readonly workingColorSpace?: string;
}): FrameCacheDescriptor {
  return {
    compositionId: input.compositionId,
    compositionHash: input.compositionHash,
    frameIndex: input.frameIndex,
    media: [...(input.media ?? [])].sort((left, right) => left.src.localeCompare(right.src)),
    clips: input.clips ?? null,
    effects: input.effects ?? null,
    seed: input.seed,
    width: input.width,
    height: input.height,
    pixelRatio: input.pixelRatio ?? 1,
    workingColorSpace: input.workingColorSpace ?? "srgb",
  };
}

export async function fingerprintMediaFile(path: string): Promise<MediaFingerprint> {
  const info = await stat(path);
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return { src: path, sha256: hash.digest("hex"), sizeBytes: info.size, modifiedMs: info.mtimeMs };
}

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
    } catch {
      void 0;
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
      const buffer = await readFile(objectPath(this.cacheDir, entry.hash));
      index.frames[String(frameIndex)] = { ...entry, access: Date.now() };
      this.markDirty(compositionHash);
      return buffer;
    } catch {
      delete index.frames[String(frameIndex)];
      this.markDirty(compositionHash);
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
    return createHash("sha256").update(`${compositionHash}:${frameIndex}:${seed}`).digest("hex");
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
    const frames: { index: number; buffer: Buffer }[] = [];
    for (const frameIndex of chunk.frames) {
      const buffer = await this.getFrame(compositionHash, frameIndex);
      if (!buffer) return null;
      frames.push({ index: frameIndex, buffer });
    }
    if (frames.length !== chunk.frames.length) return null;
    await this.flushIndexes();
    return frames;
  }

  async setChunk(
    compositionHash: string,
    chunkIndex: number,
    frames: readonly { readonly index: number; readonly buffer: Buffer }[],
  ): Promise<void> {
    const index = await this.loadIndex(compositionHash);
    const storedFrames: number[] = [];
    for (const frame of frames) {
      const hash = this.frameKey(compositionHash, frame.index);
      await this.setFrame(compositionHash, frame.index, hash, frame.buffer, chunkIndex);
      storedFrames.push(frame.index);
    }
    index.chunks[String(chunkIndex)] = { frames: storedFrames, timestamp: Date.now() };
    this.markDirty(compositionHash);
    await this.flushIndexes();
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
    return (await readdir(this.indexDir).catch(() => [])).filter((file) => file.endsWith(".json"));
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
}

export function createRenderCache(cacheDir: string): RenderCache {
  return new RenderCache(cacheDir);
}

export function computeCompositionHash(composition: object, extra: string = ""): string {
  const hash = createHash("sha256");
  hash.update(canonicalJsonString(summarizeForHash(composition)));
  hash.update(extra);
  return hash.digest("hex").slice(0, 32);
}

function summarizeForHash(composition: unknown): unknown {
  const comp = composition as { rootTimeline?: { tracks?: unknown[] } };
  const tracks = comp?.rootTimeline?.tracks;
  if (!Array.isArray(tracks)) return composition;

  const summarizedTracks = tracks.map((track) => {
    const t = track as { kind?: string; clips?: unknown[] };
    if (t.kind !== "audio" || !Array.isArray(t.clips)) return track;
    return {
      ...t,
      clips: t.clips.map((clip) => {
        const c = clip as { buffer?: { data?: unknown; sampleRate?: number; channels?: number; length?: number } };
        if (!c.buffer) return clip;
        return { ...c, buffer: digestAudioBuffer(c.buffer) };
      }),
    };
  });

  return { ...comp, rootTimeline: { ...(comp.rootTimeline as object), tracks: summarizedTracks } };
}

function digestAudioBuffer(buffer: { data?: unknown; sampleRate?: number; channels?: number; length?: number }): string {
  const { data, sampleRate, channels, length } = buffer;
  const bytes = ArrayBuffer.isView(data as ArrayBufferView)
    ? Buffer.from((data as ArrayBufferView).buffer, (data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteLength)
    : Buffer.alloc(0);
  return `sr=${sampleRate},ch=${channels},len=${length},sha=${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
}

