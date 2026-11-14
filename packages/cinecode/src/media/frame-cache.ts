export interface FrameCacheOptions {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
}

export interface FrameCacheStats {
  readonly entries: number;
  readonly bytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;

export interface FrameCacheKeyParts {
  readonly source: string;
  readonly timestamp: number;
  readonly format: string;
  readonly width?: number;
  readonly height?: number;
}

export function frameCacheKey(parts: FrameCacheKeyParts): string {
  const rounded = Math.round(parts.timestamp * 1000) / 1000;
  return [parts.source, rounded, parts.format, parts.width ?? 0, parts.height ?? 0].join("|");
}

export class FrameCache {
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly entries = new Map<string, { value: Buffer; accessed: number }>();
  private readonly inFlight = new Map<string, Promise<Buffer>>();
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: FrameCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_MAX_BYTES);
  }

  get(key: string): Buffer | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    this.entries.delete(key);
    entry.accessed = Date.now();
    this.entries.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key: string, value: Buffer): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.bytes -= existing.value.length;
      this.entries.delete(key);
    }
    if (value.length > this.maxBytes) return;
    this.entries.set(key, { value, accessed: Date.now() });
    this.bytes += value.length;
    this.evict();
  }

  private evict(): void {
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      const entry = this.entries.get(oldest);
      if (entry) this.bytes -= entry.value.length;
      this.entries.delete(oldest);
      this.evictions += 1;
    }
  }

  async getOrLoad(key: string, loader: () => Promise<Buffer>): Promise<Buffer> {
    const cached = this.get(key);
    if (cached) return cached;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const task = loader().then((buffer) => {
      this.set(key, buffer);
      return buffer;
    }).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, task);
    return task;
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.bytes -= entry.value.length;
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
    this.bytes = 0;
  }

  getStats(): FrameCacheStats {
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }
}

let defaultFrameCache: FrameCache | null = null;

export function createFrameCache(options: FrameCacheOptions = {}): FrameCache {
  return new FrameCache(options);
}

export function getDefaultFrameCache(): FrameCache {
  if (!defaultFrameCache) defaultFrameCache = new FrameCache();
  return defaultFrameCache;
}

export function resetDefaultFrameCache(): void {
  defaultFrameCache = null;
}
