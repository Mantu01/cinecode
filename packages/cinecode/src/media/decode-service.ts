import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, existsSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { resolveBinary } from "../binary/resolver.js";
import { recordProcessSpawn, recordFramesDecoded, recordFramesFromCache } from "./instrumentation.js";
import type { MediaCache, MediaMetadata } from "./cache.js";
import { inspectMedia } from "./inspector.js";
import type { Composition } from "../core/types/index.js";
import { createError, ErrorCode } from "../errors/codes.js";

export interface DecodedFrame {
  readonly width: number;
  readonly height: number;
  readonly format: "rgba";
  readonly buffer: Buffer;
}

export interface DecodeServiceStats {
  readonly decodeCount: number;
  readonly framesDecoded: number;
  readonly memoryHits: number;
  readonly diskHits: number;
  readonly memoryBytes: number;
  readonly diskBytes: number;
  readonly spillCount: number;
  readonly evictionCount: number;
}

export interface SharedDecodeServiceOptions {
  readonly mediaCache: MediaCache;
  readonly composition?: Composition;
  readonly memoryBudgetBytes?: number;
  readonly diskBudgetBytes?: number;
  readonly tempDir?: string;
  readonly prefetchAhead?: number;
  readonly onDecode?: (info: { src: string; startFrame: number; count: number }) => void;
  readonly logger?: (msg: string) => void;
}

export interface SharedDecodeService {
  requestFrame(src: string, frameIndex: number): Promise<DecodedFrame>;
  requestFrames(src: string, frameIndices: readonly number[]): Promise<Map<number, DecodedFrame>>;
  requestRange(src: string, startFrame: number, count: number): Promise<DecodedFrame[]>;
  getKeyframeIndex?(src: string): Promise<readonly number[]>;
  setKeyframeIndex?(src: string, keyframes: readonly number[]): void;
  getOpenPipeCount?(): number;
  getMetadata?(src: string): Promise<MediaMetadata>;
  getStats(): DecodeServiceStats;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

interface MemoryEntry {
  readonly frame: DecodedFrame;
  readonly bytes: number;
}

interface DiskEntry {
  readonly filePath: string;
  readonly width: number;
  readonly height: number;
  readonly format: "rgba";
  readonly bytes: number;
}

interface ActiveDecoderPipe {
  readonly process: ChildProcess;
  currentFrame: number;
  readonly metadata: MediaMetadata;
  readonly frameBytes: number;
  chunks: Buffer[];
  totalBytes: number;
  ended: boolean;
  error: Error | null;
  waiting: ((err?: Error) => void) | null;
}

const SCALE_FILTER = "scale=w=iw:h=ih:flags=lanczos";
const DEFAULT_MEMORY_BUDGET = 128 * 1024 * 1024;
const DEFAULT_DISK_BUDGET = 512 * 1024 * 1024;
const DEFAULT_PREFETCH_AHEAD = 8;

export class DefaultSharedDecodeService implements SharedDecodeService {
  private readonly mediaCache: MediaCache;
  private readonly composition?: Composition;
  private readonly memoryBudgetBytes: number;
  private readonly diskBudgetBytes: number;
  private readonly tempDir: string;
  private readonly prefetchAhead: number;
  private readonly onDecode?: (info: { src: string; startFrame: number; count: number }) => void;

  private readonly memoryLru = new Map<string, MemoryEntry>();
  private readonly diskLru = new Map<string, DiskEntry>();
  private readonly metadataCache = new Map<string, MediaMetadata>();
  private readonly keyframeCache = new Map<string, number[]>();
  private readonly activePipes = new Map<string, ActiveDecoderPipe>();
  private readonly activeProcesses = new Set<ChildProcess>();
  private readonly sourceLocks = new Map<string, Promise<void>>();

  private currentMemoryBytes = 0;
  private currentDiskBytes = 0;
  private decodeCount = 0;
  private framesDecoded = 0;
  private memoryHits = 0;
  private diskHits = 0;
  private spillCount = 0;
  private evictionCount = 0;
  private aborted = false;

  constructor(options: SharedDecodeServiceOptions) {
    this.mediaCache = options.mediaCache;
    this.composition = options.composition;
    this.memoryBudgetBytes = options.memoryBudgetBytes ?? DEFAULT_MEMORY_BUDGET;
    this.diskBudgetBytes = options.diskBudgetBytes ?? DEFAULT_DISK_BUDGET;
    this.prefetchAhead = options.prefetchAhead ?? DEFAULT_PREFETCH_AHEAD;
    this.onDecode = options.onDecode;

    this.tempDir = options.tempDir ?? join(tmpdir(), `cinecode-decode-${randomUUID().slice(0, 8)}`);
    mkdirSync(this.tempDir, { recursive: true });
  }

  getOpenPipeCount(): number {
    return this.activePipes.size;
  }

  async getKeyframeIndex(src: string): Promise<readonly number[]> {
    const cached = this.keyframeCache.get(src);
    if (cached) return cached;
    const metadata = await this.getMetadata(src);
    const gop = Math.max(1, Math.round(metadata.fps));
    const totalFrames = Math.max(1, Math.round(metadata.duration * metadata.fps));
    const list: number[] = [];
    for (let f = 0; f < totalFrames; f += gop) list.push(f);
    this.keyframeCache.set(src, list);
    return list;
  }

  setKeyframeIndex(src: string, keyframes: readonly number[]): void {
    this.keyframeCache.set(src, [...keyframes]);
  }

  getStats(): DecodeServiceStats {
    return {
      decodeCount: this.decodeCount,
      framesDecoded: this.framesDecoded,
      memoryHits: this.memoryHits,
      diskHits: this.diskHits,
      memoryBytes: this.currentMemoryBytes,
      diskBytes: this.currentDiskBytes,
      spillCount: this.spillCount,
      evictionCount: this.evictionCount,
    };
  }

  async requestFrame(src: string, frameIndex: number): Promise<DecodedFrame> {
    const results = await this.requestFrames(src, [frameIndex]);
    const frame = results.get(frameIndex);
    if (!frame) {
      throw createError(
        ErrorCode.CC4001,
        { frame: frameIndex, source: src, reason: "decode returned no frame" },
        { location: { file: src } },
      );
    }
    return frame;
  }

  async requestRange(src: string, startFrame: number, count: number): Promise<DecodedFrame[]> {
    if (count <= 0) return [];
    const indices: number[] = [];
    for (let i = 0; i < count; i++) indices.push(startFrame + i);
    const map = await this.requestFrames(src, indices);
    const list: DecodedFrame[] = [];
    for (const idx of indices) {
      const f = map.get(idx);
      if (f) list.push(f);
    }
    return list;
  }

  async requestFrames(src: string, frameIndices: readonly number[]): Promise<Map<number, DecodedFrame>> {
    if (this.aborted) {
      throw createError(ErrorCode.CC4003, { details: "decode service is cancelled" });
    }
    if (frameIndices.length === 0) return new Map();

    const uniqueSorted = Array.from(new Set(frameIndices)).sort((a, b) => a - b);
    const results = new Map<number, DecodedFrame>();
    const missing: number[] = [];

    for (const frameIdx of uniqueSorted) {
      const key = `${src}@${frameIdx}`;
      const mem = this.memoryLru.get(key);
      if (mem) {
        this.memoryHits++;
        recordFramesFromCache(1, mem.bytes);
        this.memoryLru.delete(key);
        this.memoryLru.set(key, mem);
        results.set(frameIdx, mem.frame);
        continue;
      }
      const disk = this.diskLru.get(key);
      if (disk) {
        this.diskHits++;
        this.diskLru.delete(key);
        this.diskLru.set(key, disk);
        const buffer = await readFile(disk.filePath);
        recordFramesFromCache(1, disk.bytes);
        results.set(frameIdx, {
          width: disk.width,
          height: disk.height,
          format: disk.format,
          buffer,
        });
        continue;
      }
      missing.push(frameIdx);
    }

    if (missing.length === 0) return results;

    await this.runWithSourceLock(src, async () => {
      const metadata = await this.getMetadata(src);

      for (const targetFrame of missing) {
        const key = `${src}@${targetFrame}`;
        if (this.memoryLru.has(key)) {
          results.set(targetFrame, this.memoryLru.get(key)!.frame);
          continue;
        }

        let pipe = this.activePipes.get(src);

        // Check if pipe is open and can be read sequentially
        if (pipe && pipe.currentFrame <= targetFrame && targetFrame - pipe.currentFrame <= 30) {
          while (pipe.currentFrame < targetFrame) {
            const fBuf = await this.pullNextFrame(pipe);
            this.storeFrame(src, pipe.currentFrame - 1, {
              width: metadata.width,
              height: metadata.height,
              format: "rgba",
              buffer: fBuf,
            });
          }
          const targetBuf = await this.pullNextFrame(pipe);
          const decoded: DecodedFrame = {
            width: metadata.width,
            height: metadata.height,
            format: "rgba",
            buffer: targetBuf,
          };
          this.storeFrame(src, targetFrame, decoded);
          results.set(targetFrame, decoded);
          this.onDecode?.({ src, startFrame: targetFrame, count: 1 });
          continue;
        }

        // Non-sequential or backward seek: close pipe and seek to nearest keyframe
        await this.closePipe(src);
        const keyframes = await this.getKeyframeIndex(src);
        let kf = 0;
        for (const k of keyframes) {
          if (k <= targetFrame && k > kf) kf = k;
        }

        pipe = await this.openPipe(src, kf, metadata);
        while (pipe.currentFrame < targetFrame) {
          const fBuf = await this.pullNextFrame(pipe);
          this.storeFrame(src, pipe.currentFrame - 1, {
            width: metadata.width,
            height: metadata.height,
            format: "rgba",
            buffer: fBuf,
          });
        }

        const targetBuf = await this.pullNextFrame(pipe);
        const decoded: DecodedFrame = {
          width: metadata.width,
          height: metadata.height,
          format: "rgba",
          buffer: targetBuf,
        };
        this.storeFrame(src, targetFrame, decoded);
        results.set(targetFrame, decoded);
        this.onDecode?.({ src, startFrame: kf, count: targetFrame - kf + 1 });
      }
    });

    return results;
  }

  private async openPipe(src: string, startFrame: number, metadata: MediaMetadata): Promise<ActiveDecoderPipe> {
    await this.closePipe(src);

    const seekTime = startFrame / metadata.fps;
    const args = [
      "-v", "error",
      ...(startFrame > 0 ? ["-ss", String(seekTime)] : []),
      "-i", src,
      "-an",
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-vf", SCALE_FILTER,
      "-",
    ];

    recordProcessSpawn();
    const child = spawn(resolveBinary("ffmpeg").path, args, { windowsHide: true });
    this.activeProcesses.add(child);

    const frameBytes = metadata.width * metadata.height * 4;
    const pipe: ActiveDecoderPipe = {
      process: child,
      currentFrame: startFrame,
      metadata,
      frameBytes,
      chunks: [],
      totalBytes: 0,
      ended: false,
      error: null,
      waiting: null,
    };

    child.stdout.on("data", (chunk: Buffer) => {
      pipe.chunks.push(chunk);
      pipe.totalBytes += chunk.length;
      if (pipe.waiting && pipe.totalBytes >= pipe.frameBytes) {
        const cb = pipe.waiting;
        pipe.waiting = null;
        cb();
      }
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      this.activeProcesses.delete(child);
      pipe.error = err;
      if (pipe.waiting) {
        const cb = pipe.waiting;
        pipe.waiting = null;
        cb(err);
      }
    });

    child.on("close", (code) => {
      this.activeProcesses.delete(child);
      pipe.ended = true;
      if (code !== 0 && code !== null && !this.aborted && pipe.totalBytes < pipe.frameBytes) {
        pipe.error = new Error(`ffmpeg pipe exited with code ${code}: ${stderr.trim()}`);
      }
      if (pipe.waiting) {
        const cb = pipe.waiting;
        pipe.waiting = null;
        cb(pipe.error ?? undefined);
      }
    });

    this.activePipes.set(src, pipe);
    this.decodeCount++;
    return pipe;
  }

  private async pullNextFrame(pipe: ActiveDecoderPipe): Promise<Buffer> {
    while (pipe.totalBytes < pipe.frameBytes) {
      if (pipe.ended) {
        if (pipe.error) throw pipe.error;
        throw new Error("Unexpected end of video decoder stream");
      }
      if (pipe.error) throw pipe.error;
      await new Promise<void>((resolveWait, rejectWait) => {
        pipe.waiting = (err) => (err ? rejectWait(err) : resolveWait());
      });
    }

    let buffer: Buffer;
    if (pipe.chunks[0]?.length === pipe.frameBytes) {
      buffer = pipe.chunks.shift()!;
    } else {
      const combined = Buffer.concat(pipe.chunks);
      buffer = combined.subarray(0, pipe.frameBytes);
      const remainder = combined.subarray(pipe.frameBytes);
      pipe.chunks = remainder.length > 0 ? [remainder] : [];
    }
    pipe.totalBytes -= pipe.frameBytes;
    pipe.currentFrame++;
    this.framesDecoded++;
    recordFramesDecoded(1, pipe.frameBytes);
    return buffer;
  }

  private async closePipe(src: string): Promise<void> {
    const pipe = this.activePipes.get(src);
    if (!pipe) return;
    this.activePipes.delete(src);
    this.activeProcesses.delete(pipe.process);
    try {
      pipe.process.kill("SIGKILL");
    } catch {
      // Note: process might already be exited
    }
  }

  private storeFrame(src: string, frameIndex: number, frame: DecodedFrame): void {
    const key = `${src}@${frameIndex}`;
    const bytes = frame.buffer.byteLength;

    if (this.memoryLru.has(key)) {
      this.currentMemoryBytes -= this.memoryLru.get(key)!.bytes;
      this.memoryLru.delete(key);
    }
    if (this.diskLru.has(key)) {
      const diskEntry = this.diskLru.get(key)!;
      this.currentDiskBytes -= diskEntry.bytes;
      this.diskLru.delete(key);
      try { unlinkSync(diskEntry.filePath); } catch { /* Note: file might already be removed */ }
    }

    while (this.currentMemoryBytes + bytes > this.memoryBudgetBytes && this.memoryLru.size > 0) {
      const oldestKey = this.memoryLru.keys().next().value!;
      const oldest = this.memoryLru.get(oldestKey)!;
      this.memoryLru.delete(oldestKey);
      this.currentMemoryBytes -= oldest.bytes;
      this.spillToDisk(oldestKey, oldest.frame);
    }

    this.memoryLru.set(key, { frame, bytes });
    this.currentMemoryBytes += bytes;
  }

  private spillToDisk(key: string, frame: DecodedFrame): void {
    const bytes = frame.buffer.byteLength;
    while (this.currentDiskBytes + bytes > this.diskBudgetBytes && this.diskLru.size > 0) {
      const oldestDiskKey = this.diskLru.keys().next().value!;
      const oldestDisk = this.diskLru.get(oldestDiskKey)!;
      this.diskLru.delete(oldestDiskKey);
      this.currentDiskBytes -= oldestDisk.bytes;
      try { unlinkSync(oldestDisk.filePath); } catch { /* Note: file might already be removed */ }
      this.evictionCount++;
    }

    const safeName = key.replace(/[^a-zA-Z0-9_-]/g, "_") + ".raw";
    const filePath = join(this.tempDir, safeName);
    try {
      writeFileSync(filePath, frame.buffer);
      this.diskLru.set(key, {
        filePath,
        width: frame.width,
        height: frame.height,
        format: frame.format,
        bytes,
      });
      this.currentDiskBytes += bytes;
      this.spillCount++;
    } catch {
      // Note: Ignore transient disk write errors
    }
  }

  private async runWithSourceLock<T>(src: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.sourceLocks.get(src) ?? Promise.resolve();
    let release: () => void = () => {};
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.sourceLocks.set(src, next);
    try {
      await prev;
      return await fn();
    } finally {
      release();
      if (this.sourceLocks.get(src) === next) {
        this.sourceLocks.delete(src);
      }
    }
  }

  async getMetadata(src: string): Promise<MediaMetadata> {
    const resolvedPath = resolve(src);
    let identity = resolvedPath;
    try {
      if (existsSync(resolvedPath)) {
        const stat = statSync(resolvedPath);
        identity = `${resolvedPath}:${stat.mtimeMs}:${stat.size}`;
      }
    } catch {
      // Note: stat error falls back to unsuffixed identity
    }

    const cached = this.metadataCache.get(identity);
    if (cached) return cached;

    const fromMediaCache = await this.mediaCache.getMetadata(src).catch(() => null);
    if (fromMediaCache) {
      this.metadataCache.set(identity, fromMediaCache);
      return fromMediaCache;
    }

    try {
      const inspected = await inspectMedia(src, { cache: this.mediaCache, sourceDir: process.cwd() });
      this.metadataCache.set(identity, inspected);
      return inspected;
    } catch (err: unknown) {
      const affected = findAffectedClips(this.composition, src);
      const reason = affected.length > 0
        ? `failed to inspect media (affected clips: ${affected.join(", ")}): ${err instanceof Error ? err.message : String(err)}`
        : `failed to inspect media: ${err instanceof Error ? err.message : String(err)}`;
      throw createError(
        ErrorCode.CC4001,
        {
          frame: 0,
          source: src,
          reason,
          ...(affected.length > 0 ? { affectedClips: affected.join(", ") } : {}),
        },
        { location: { file: src }, cause: err },
      );
    }
  }

  async cancel(): Promise<void> {
    this.aborted = true;
    for (const [, pipe] of this.activePipes.entries()) {
      try {
        pipe.process.kill("SIGKILL");
      } catch {
        // Note: process might already be killed
      }
    }
    this.activePipes.clear();
    for (const child of this.activeProcesses) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Note: child might already be killed
      }
    }
    this.activeProcesses.clear();
  }

  async dispose(): Promise<void> {
    await this.cancel();
    this.memoryLru.clear();
    this.currentMemoryBytes = 0;
    this.diskLru.clear();
    this.currentDiskBytes = 0;

    if (existsSync(this.tempDir)) {
      try {
        rmSync(this.tempDir, { recursive: true, force: true });
      } catch {
        // Note: temp dir might already be removed
      }
    }
  }
}

function findAffectedClips(composition: Composition | undefined, src: string): string[] {
  if (!composition) return [];
  const affected: string[] = [];
  for (const track of composition.rootTimeline.tracks) {
    const trackName = (track as { id?: string; name?: string }).id ?? (track as { name?: string }).name ?? track.kind;
    for (const clip of track.clips) {
      if ((clip as { src?: string }).src === src) {
        const clipId = (clip as { id?: string; name?: string }).id ?? (clip as { name?: string }).name ?? clip.type;
        affected.push(`${trackName}:${clipId}`);
      }
    }
  }
  return affected;
}

export function createSharedDecodeService(options: SharedDecodeServiceOptions): SharedDecodeService {
  return new DefaultSharedDecodeService(options);
}
