import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import ffmpegStatic from "@ffmpeg-installer/ffmpeg";
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
  getStats(): DecodeServiceStats;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

interface InFlightRange {
  readonly startFrame: number;
  readonly count: number;
  readonly promise: Promise<void>;
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
  private readonly inFlightRanges = new Map<string, InFlightRange[]>();
  private readonly metadataCache = new Map<string, MediaMetadata>();
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

    const pendingPromises: Promise<void>[] = [];
    let totalFrames = 0;

    await this.runWithSourceLock(src, async () => {
      const stillMissing: number[] = [];
      for (const frameIdx of missing) {
        const key = `${src}@${frameIdx}`;
        if (!this.memoryLru.has(key) && !this.diskLru.has(key)) {
          stillMissing.push(frameIdx);
        }
      }
      if (stillMissing.length === 0) return;

      const metadata = await this.getMetadata(src);
      totalFrames = Math.max(1, Math.round(metadata.duration * metadata.fps));

      const neededToDecode: number[] = [];
      const activeRanges = this.inFlightRanges.get(src) ?? [];
      for (const frameIdx of stillMissing) {
        const inFlight = activeRanges.find((r) => r.startFrame <= frameIdx && frameIdx < r.startFrame + r.count);
        if (inFlight) {
          if (!pendingPromises.includes(inFlight.promise)) {
            pendingPromises.push(inFlight.promise);
          }
        } else {
          neededToDecode.push(frameIdx);
        }
      }

      if (neededToDecode.length > 0) {
        const runs = groupContiguousRuns(neededToDecode, this.prefetchAhead, totalFrames);
        for (const run of runs) {
          const decodePromise = this.executeDecodeRange(src, run.start, run.count, metadata);
          const inFlightEntry: InFlightRange = {
            startFrame: run.start,
            count: run.count,
            promise: decodePromise,
          };
          const list = this.inFlightRanges.get(src) ?? [];
          list.push(inFlightEntry);
          this.inFlightRanges.set(src, list);

          const trackedPromise = decodePromise.finally(() => {
            const current = this.inFlightRanges.get(src) ?? [];
            const idx = current.indexOf(inFlightEntry);
            if (idx >= 0) current.splice(idx, 1);
          });
          pendingPromises.push(trackedPromise);
        }
      }
    });

    if (pendingPromises.length > 0) {
      await Promise.all(pendingPromises);
    }

    for (const frameIdx of missing) {
      const key = `${src}@${frameIdx}`;
      const mem = this.memoryLru.get(key);
      if (mem) {
        results.set(frameIdx, mem.frame);
        continue;
      }
      const disk = this.diskLru.get(key);
      if (disk) {
        const buffer = await readFile(disk.filePath);
        results.set(frameIdx, {
          width: disk.width,
          height: disk.height,
          format: disk.format,
          buffer,
        });
        continue;
      }
      // If frame index was within video bounds, this is an explicit decode failure
      if (frameIdx < totalFrames) {
        const affected = findAffectedClips(this.composition, src);
        throw createError(
          ErrorCode.CC4001,
          {
            frame: frameIdx,
            source: src,
            reason: `frame ${frameIdx} was not produced by decode range`,
            ...(affected.length > 0 ? { affectedClips: affected.join(", ") } : {}),
          },
          { location: { file: src } },
        );
      }
    }

    return results;
  }

  private async executeDecodeRange(
    src: string,
    startFrame: number,
    count: number,
    metadata: MediaMetadata,
  ): Promise<void> {
    if (this.aborted) {
      throw createError(ErrorCode.CC4003, { details: "decode cancelled" });
    }

    const seekTime = startFrame / metadata.fps;
    const args = [
      "-v", "error",
      "-ss", String(seekTime),
      "-i", src,
      "-an",
      "-frames:v", String(count),
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-vf", SCALE_FILTER,
      "-",
    ];

    return new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegStatic.path, args, { windowsHide: true });
      this.activeProcesses.add(child);

      const chunks: Buffer[] = [];
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", (err) => {
        this.activeProcesses.delete(child);
        const affected = findAffectedClips(this.composition, src);
        reject(
          createError(
            ErrorCode.CC4001,
            {
              frame: startFrame,
              source: src,
              reason: `failed to spawn ffmpeg: ${err.message}`,
              ...(affected.length > 0 ? { affectedClips: affected.join(", ") } : {}),
            },
            { location: { file: src }, cause: err },
          ),
        );
      });

      child.on("close", (code) => {
        this.activeProcesses.delete(child);
        if (this.aborted) {
          reject(createError(ErrorCode.CC4003, { details: "decode cancelled" }));
          return;
        }

        if (code !== 0) {
          const affected = findAffectedClips(this.composition, src);
          const reasonWithClips = affected.length > 0
            ? `ffmpeg decode failed (affected clips: ${affected.join(", ")}): exit code ${code}: ${stderr.trim()}`
            : `ffmpeg decode failed with exit code ${code}: ${stderr.trim()}`;
          reject(
            createError(
              ErrorCode.CC4001,
              {
                frame: startFrame,
                source: src,
                reason: reasonWithClips,
                ...(affected.length > 0 ? { affectedClips: affected.join(", ") } : {}),
              },
              { location: { file: src } },
            ),
          );
          return;
        }

        const buffer = Buffer.concat(chunks);
        const frameSize = metadata.width * metadata.height * 4;
        const available = Math.floor(buffer.length / frameSize);

        this.decodeCount++;
        this.framesDecoded += available;

        for (let i = 0; i < available; i++) {
          const frameBuffer = Buffer.from(buffer.subarray(i * frameSize, (i + 1) * frameSize));
          this.storeFrame(src, startFrame + i, {
            width: metadata.width,
            height: metadata.height,
            format: "rgba",
            buffer: frameBuffer,
          });
        }

        this.onDecode?.({ src, startFrame, count: available });
        resolve();
      });
    });
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
      try { unlinkSync(diskEntry.filePath); } catch {}
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
      try { unlinkSync(oldestDisk.filePath); } catch {}
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
      // Ignore transient disk write errors
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

  private async getMetadata(src: string): Promise<MediaMetadata> {
    const cached = this.metadataCache.get(src);
    if (cached) return cached;

    const fromMediaCache = await this.mediaCache.getMetadata(src).catch(() => null);
    if (fromMediaCache) {
      this.metadataCache.set(src, fromMediaCache);
      return fromMediaCache;
    }

    try {
      const inspected = await inspectMedia(src, { cache: this.mediaCache, sourceDir: process.cwd() });
      this.metadataCache.set(src, inspected);
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
    for (const child of this.activeProcesses) {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
    this.activeProcesses.clear();
    this.inFlightRanges.clear();
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
      } catch {}
    }
  }
}

function groupContiguousRuns(
  indices: readonly number[],
  prefetchAhead: number,
  totalFrames: number,
): Array<{ start: number; count: number }> {
  if (indices.length === 0) return [];
  const runs: Array<{ start: number; count: number }> = [];

  let start = indices[0]!;
  let end = start;

  for (let i = 1; i < indices.length; i++) {
    const next = indices[i]!;
    // If adjacent or within prefetch window, group together
    if (next <= end + prefetchAhead + 1) {
      end = next;
    } else {
      const count = Math.min(totalFrames - start, end - start + 1 + prefetchAhead);
      runs.push({ start, count: Math.max(1, count) });
      start = next;
      end = next;
    }
  }

  const count = Math.min(totalFrames - start, end - start + 1 + prefetchAhead);
  runs.push({ start, count: Math.max(1, count) });

  return runs;
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
