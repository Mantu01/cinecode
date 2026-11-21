import { createCanvas, createContext } from "./composite/engine.js";
import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";

/**
 * Canvas and RGBA buffer pooling keyed by resolution. Pooled canvases are
 * cleared before reuse so no state leaks between frames. The pool is a plain
 * factory — no mutable singleton — so deterministic renderers can each own
 * their own pool instance.
 */

export interface CanvasPoolEntry {
  readonly canvas: Canvas;
  readonly ctx: SKRSContext2D;
}

export interface CanvasAcquireOptions {
  readonly dirty?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface CanvasPool {
  acquire(width: number, height: number, options?: CanvasAcquireOptions): CanvasPoolEntry;
  release(entry: CanvasPoolEntry): void;
  clear(): void;
  readonly size: number;
}

export function clearRegion(
  ctx: SKRSContext2D,
  region: { x: number; y: number; width: number; height: number },
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(region.x, region.y, region.width, region.height);
  ctx.restore();
}

export function createCanvasPool(maxPerSize = 4): CanvasPool {
  const free = new Map<string, CanvasPoolEntry[]>();
  const live = new Set<CanvasPoolEntry>();
  const key = (width: number, height: number): string => `${width}x${height}`;

  const pool: CanvasPool = {
    acquire(width, height, options) {
      const k = key(width, height);
      const bucket = free.get(k);
      const reused = bucket?.pop();
      if (reused) {
        live.add(reused);
        reused.canvas.width = width;
        reused.canvas.height = height;
        if (options?.dirty) clearRegion(reused.ctx, options.dirty);
        else reused.ctx.clearRect(0, 0, width, height);
        return reused;
      }
      const canvas = createCanvas(width, height);
      const entry: CanvasPoolEntry = { canvas, ctx: createContext(canvas) };
      live.add(entry);
      return entry;
    },
    release(entry) {
      if (!live.delete(entry)) return;
      const k = key(entry.canvas.width, entry.canvas.height);
      const bucket = free.get(k) ?? [];
      if (bucket.length < maxPerSize) {
        bucket.push(entry);
        free.set(k, bucket);
      }
    },
    clear() {
      free.clear();
      live.clear();
    },
    get size() {
      let total = 0;
      for (const bucket of free.values()) total += bucket.length;
      return total;
    },
  };

  return pool;
}

export interface CacheStats {
  readonly name: string;
  readonly entries: number;
  readonly bytes: number;
  readonly maxBytes: number;
  readonly evictions: number;
}

/**
 * Byte-bounded least-recently-used cache. Reads refresh entry order, so a
 * canvas used every frame survives while one-off resolution buffers drain.
 * Stats expose bytes, entries and eviction count so a render can prove its
 * caches are bounded and shrink after a job.
 */
export class ByteBoundedCache<K, V> {
  private readonly map = new Map<K, V>();
  private bytes = 0;
  private evictions = 0;
  private readonly onEvict: ((key: K, value: V) => void) | undefined;

  constructor(
    private readonly name: string,
    private readonly maxBytes: number,
    private readonly sizeOf: (value: V) => number,
    onEvict?: (key: K, value: V) => void,
  ) {
    this.onEvict = onEvict;
    registerByteCache(this);
  }

  get size(): number {
    return this.map.size;
  }

  get byteSize(): number {
    return this.bytes;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  set(key: K, value: V): void {
    const previous = this.map.get(key);
    if (previous !== undefined) {
      this.bytes -= this.sizeOf(previous);
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.bytes += this.sizeOf(value);
    this.evict();
  }

  delete(key: K): boolean {
    const value = this.map.get(key);
    if (value === undefined) return false;
    this.map.delete(key);
    this.bytes -= this.sizeOf(value);
    this.onEvict?.(key, value);
    return true;
  }

  clear(): void {
    for (const [key, value] of this.map) this.onEvict?.(key, value);
    this.map.clear();
    this.bytes = 0;
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }

  stats(): CacheStats {
    return {
      name: this.name,
      entries: this.map.size,
      bytes: this.bytes,
      maxBytes: this.maxBytes,
      evictions: this.evictions,
    };
  }

  private evict(): void {
    while (this.bytes > this.maxBytes && this.map.size > 0) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      const value = this.map.get(oldest);
      this.map.delete(oldest);
      this.bytes -= value === undefined ? 0 : this.sizeOf(value);
      this.evictions += 1;
      if (value !== undefined) this.onEvict?.(oldest, value);
    }
  }
}

const byteCacheRegistry: { stats(): CacheStats }[] = [];

function registerByteCache(cache: { stats(): CacheStats }): void {
  byteCacheRegistry.push(cache);
}

/** A disposed job's caches stop counting toward the live job totals. */
export function unregisterByteCache(cache: { stats(): CacheStats }): void {
  const index = byteCacheRegistry.indexOf(cache);
  if (index >= 0) byteCacheRegistry.splice(index, 1);
}

/** Every renderer cache with its current bytes, limit and eviction count. */
export function getRendererCacheStats(): readonly CacheStats[] {
  return byteCacheRegistry.map((cache) => cache.stats());
}

export function evictOldest<K, V>(map: Map<K, V>, maxSize: number): void {
  if (map.size >= maxSize) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
}

export interface BufferPool {
  acquire(width: number, height: number): Uint8ClampedArray;
  release(buffer: Uint8ClampedArray): void;
  readonly size: number;
}

/** Reuses RGBA byte buffers sized width*height*4 across frames. */
export function createBufferPool(maxPerSize = 8): BufferPool {
  const free = new Map<number, Uint8ClampedArray[]>();
  return {
    acquire(width, height) {
      const length = width * height * 4;
      const bucket = free.get(length);
      const reused = bucket?.pop();
      if (reused) return reused;
      return new Uint8ClampedArray(length);
    },
    release(buffer) {
      const bucket = free.get(buffer.length) ?? [];
      if (bucket.length < maxPerSize) {
        bucket.push(buffer);
        free.set(buffer.length, bucket);
      }
    },
    get size() {
      let total = 0;
      for (const bucket of free.values()) total += bucket.length;
      return total;
    },
  };
}
