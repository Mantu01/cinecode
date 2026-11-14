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
  readonly dirty?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface CanvasPool {
  acquire(width: number, height: number, options?: CanvasAcquireOptions): CanvasPoolEntry;
  release(entry: CanvasPoolEntry): void;
  clear(): void;
  readonly size: number;
}

export function clearRegion(ctx: SKRSContext2D, region: { x: number; y: number; width: number; height: number }): void {
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
