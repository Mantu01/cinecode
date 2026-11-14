import { readFile } from "node:fs/promises";
import type { Composition } from "../core/types/index.js";
import { extractFramesInMemory, type ExtractedFrame } from "./frames.js";

export interface PrefetchOptions {
  readonly maxEntries?: number;
  readonly maxBytesPerAsset?: number;
  readonly videoFrameLimit?: number;
  readonly onWarning?: (message: string) => void;
}

export interface PrefetchReport {
  readonly videos: number;
  readonly videoFrames: number;
  readonly images: number;
  readonly fonts: number;
  readonly bytes: number;
  readonly skipped: number;
}

export interface PrefetchStats {
  readonly entries: number;
  readonly bytes: number;
  readonly hits: number;
  readonly misses: number;
}

const FONT_EXTENSIONS = [".ttf", ".otf", ".woff", ".woff2"];
const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_MAX_BYTES_PER_ASSET = 32 * 1024 * 1024;
const DEFAULT_VIDEO_FRAME_LIMIT = 16;

class LruStore {
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly entries = new Map<string, { value: unknown; bytes: number }>();
  private hits = 0;
  private misses = 0;

  constructor(maxEntries: number, maxBytes: number) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits += 1;
    return entry.value as T;
  }

  set(key: string, value: unknown, bytes: number): void {
    if (bytes > this.maxBytes) return;
    this.entries.delete(key);
    this.entries.set(key, { value, bytes });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats(): PrefetchStats {
    let bytes = 0;
    for (const entry of this.entries.values()) bytes += entry.bytes;
    return { entries: this.entries.size, bytes, hits: this.hits, misses: this.misses };
  }
}

interface MediaSourceRef {
  readonly src: string;
  readonly kind: "video" | "image" | "font";
  readonly frames: readonly number[];
}

const VIDEO_TYPES = new Set(["video", "chromakey", "mesh-warp"]);
const IMAGE_TYPES = new Set(["image", "svg", "sticker"]);

function isFontPath(value: string): boolean {
  const lower = value.toLowerCase();
  return FONT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function collectSources(composition: Composition, frames: readonly number[]): MediaSourceRef[] {
  const frameSet = frames.length > 0 ? new Set(frames) : null;
  const sources = new Map<string, MediaSourceRef>();

  for (const track of composition.rootTimeline.tracks) {
    if (track.kind === "audio") continue;
    for (const clip of track.clips) {
      const typed = clip as { type: string; src?: string; fontFamily?: string; start?: number | string; duration?: number | string };
      const src = typed.src;
      if (typeof src === "string" && src.length > 0) {
        const kind = VIDEO_TYPES.has(typed.type)
          ? "video"
          : IMAGE_TYPES.has(typed.type)
            ? "image"
            : isFontPath(src)
              ? "font"
              : null;
        if (kind === null) continue;
        const framesForClip = frameSet ? [...frameSet] : [0];
        const existing = sources.get(src);
        sources.set(src, existing
          ? { ...existing, frames: [...new Set([...existing.frames, ...framesForClip])].sort((a, b) => a - b) }
          : { src, kind, frames: framesForClip });
      }
      if (typeof typed.fontFamily === "string" && isFontPath(typed.fontFamily)) {
        sources.set(typed.fontFamily, { src: typed.fontFamily, kind: "font", frames: [] });
      }
    }
  }

  return [...sources.values()];
}

function contiguousRuns(frames: readonly number[], limit: number): number[][] {
  if (frames.length === 0) return [];
  const sorted = [...new Set(frames)].sort((a, b) => a - b);
  const runs: number[][] = [];
  let run: number[] = [];
  for (const frame of sorted) {
    const previous = run[run.length - 1];
    if (previous !== undefined && frame !== previous + 1) {
      runs.push(run);
      run = [];
    }
    run.push(frame);
    if (run.length >= limit) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

export class MediaPrefetcher {
  private readonly store: LruStore;
  private readonly options: PrefetchOptions;
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(options: PrefetchOptions = {}) {
    this.options = options;
    this.store = new LruStore(
      options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      options.maxBytesPerAsset ?? DEFAULT_MAX_BYTES_PER_ASSET,
    );
  }

  getVideoFrame(src: string, frame: number): ExtractedFrame | undefined {
    return this.store.get<ExtractedFrame>(`video:${src}:${frame}`);
  }

  getImageBuffer(src: string): Buffer | undefined {
    return this.store.get<Buffer>(`image:${src}`);
  }

  getFontBuffer(src: string): Buffer | undefined {
    return this.store.get<Buffer>(`font:${src}`);
  }

  stats(): PrefetchStats {
    return this.store.stats();
  }

  clear(): void {
    this.store.clear();
    this.inFlight.clear();
  }

  async prefetchForFrames(composition: Composition, frames: readonly number[]): Promise<PrefetchReport> {
    const sources = collectSources(composition, frames);
    let videos = 0;
    let videoFrames = 0;
    let images = 0;
    let fonts = 0;
    let bytes = 0;
    let skipped = 0;

    for (const source of sources) {
      const key = `${source.kind}:${source.src}`;
      if (this.inFlight.has(key)) {
        skipped += 1;
        continue;
      }
      const task = (async (): Promise<void> => {
        if (source.kind === "video") {
          videos += 1;
          for (const run of contiguousRuns(source.frames, this.options.videoFrameLimit ?? DEFAULT_VIDEO_FRAME_LIMIT)) {
            const first = run[0] ?? 0;
            try {
              const decoded = await extractFramesInMemory(source.src, first, run.length);
              for (let index = 0; index < decoded.length; index += 1) {
                const frame = decoded[index];
                if (!frame) continue;
                this.store.set(`video:${source.src}:${first + index}`, frame, frame.buffer.length);
                videoFrames += 1;
                bytes += frame.buffer.length;
              }
            } catch (error) {
              this.options.onWarning?.(`prefetch failed for ${source.src}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          return;
        }
        try {
          const buffer = await readFile(source.src);
          if (source.kind === "image") {
            images += 1;
            this.store.set(`image:${source.src}`, buffer, buffer.length);
          } else {
            fonts += 1;
            this.store.set(`font:${source.src}`, buffer, buffer.length);
          }
          bytes += buffer.length;
        } catch (error) {
          this.options.onWarning?.(`prefetch failed for ${source.src}: ${error instanceof Error ? error.message : String(error)}`);
        }
      })();
      this.inFlight.set(key, task);
      await task.finally(() => {
        this.inFlight.delete(key);
      });
    }

    return { videos, videoFrames, images, fonts, bytes, skipped };
  }

  prefetchAhead(composition: Composition, frames: readonly number[]): void {
    if (frames.length === 0) return;
    void this.prefetchForFrames(composition, frames).catch((error: unknown) => {
      this.options.onWarning?.(`prefetch failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

export function createMediaPrefetcher(options: PrefetchOptions = {}): MediaPrefetcher {
  return new MediaPrefetcher(options);
}
