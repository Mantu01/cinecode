import { createHash } from "node:crypto";
import { CACHE_FORMAT_VERSION } from "../contracts.js";

export interface CacheKeyContract {
  readonly compositionHash: string;
  readonly frameIndex: number;
  readonly geometry: string;
  readonly seed: number;
  readonly rendererVersion: string;
  readonly effectList: readonly string[];
}

/** Generates deterministic cache key from the full contract parameters. */
export function buildContractCacheKey(contract: CacheKeyContract): string {
  const effects = contract.effectList.slice().sort().join(",");
  const canonical = `${contract.compositionHash}::${contract.frameIndex}::${contract.geometry}::${contract.seed}::${contract.rendererVersion}::${effects}`;
  return createHash("sha256").update(canonical).digest("hex");
}

export interface GlobalCacheEntry<T = unknown> {
  readonly partition: string;
  readonly key: string;
  readonly value: T;
  readonly byteSize: number;
  readonly formatVersion: number;
  lastAccessed: number;
  readonly onEvict?: (key: string, value: T) => void;
}

export interface GlobalCacheStats {
  readonly totalBytes: number;
  readonly maxBytes: number;
  readonly totalEntries: number;
  readonly evictions: number;
  readonly partitions: Record<string, { entries: number; bytes: number; evictions: number; maxBytes?: number }>;
}

export interface PartitionStats {
  readonly name: string;
  readonly entries: number;
  readonly bytes: number;
  readonly maxBytes: number;
  readonly evictions: number;
}

/**
 * Byte-bounded cache service with named partitions and single global LRU eviction.
 * Eviction is cross-partition so large partitions cannot starve others beyond the global budget.
 */
export class GlobalCacheService {
  private readonly totalMaxBytes: number;
  private currentBytes = 0;
  private totalEvictions = 0;
  private readonly partitionLimits = new Map<string, number>();
  private readonly partitionBytes = new Map<string, number>();
  private readonly partitionEvictions = new Map<string, number>();
  private readonly entries = new Map<string, GlobalCacheEntry<any>>(); // Note: heterogeneous cache entry map
  private readonly lruOrder = new Map<string, boolean>();

  constructor(totalMaxBytes: number, partitionLimits: Record<string, number> = {}) {
    this.totalMaxBytes = Math.max(1024, Math.floor(totalMaxBytes));
    for (const [name, limit] of Object.entries(partitionLimits)) {
      this.partitionLimits.set(name, Math.max(0, Math.floor(limit)));
    }
  }

  get totalBytes(): number {
    return this.currentBytes;
  }

  get maxBytes(): number {
    return this.totalMaxBytes;
  }

  get size(): number {
    return this.entries.size;
  }

  has(partition: string, key: string): boolean {
    return this.entries.has(`${partition}::${key}`);
  }

  /** Gets entry; validates format version and refuses stale incompatible entries with a note. */
  get<T = unknown>(
    partition: string,
    key: string,
    expectedFormatVersion = CACHE_FORMAT_VERSION,
  ): { hit: boolean; value?: T; note?: string } {
    const fullKey = `${partition}::${key}`;
    const entry = this.entries.get(fullKey);
    if (!entry) {
      return { hit: false };
    }
    if (entry.formatVersion !== expectedFormatVersion) {
      return {
        hit: false,
        note: `[CC7106] Incompatible cache format version ${entry.formatVersion} (expected ${expectedFormatVersion}); entry refused`,
      };
    }
    entry.lastAccessed = Date.now();
    this.lruOrder.delete(fullKey);
    this.lruOrder.set(fullKey, true);
    return { hit: true, value: entry.value as T };
  }

  set<T = unknown>(
    partition: string,
    key: string,
    value: T,
    byteSize: number,
    options: {
      formatVersion?: number;
      onEvict?: (key: string, value: T) => void;
    } = {},
  ): void {
    const fullKey = `${partition}::${key}`;
    const size = Math.max(0, Math.floor(byteSize));
    const formatVersion = options.formatVersion ?? CACHE_FORMAT_VERSION;

    if (this.entries.has(fullKey)) {
      this.delete(partition, key);
    }

    const entry: GlobalCacheEntry<T> = {
      partition,
      key,
      value,
      byteSize: size,
      formatVersion,
      lastAccessed: Date.now(),
      onEvict: options.onEvict,
    };

    this.entries.set(fullKey, entry);
    this.lruOrder.set(fullKey, true);
    this.currentBytes += size;
    this.partitionBytes.set(partition, (this.partitionBytes.get(partition) ?? 0) + size);

    // Evict within partition if local partition limit is configured and exceeded
    const pLimit = this.partitionLimits.get(partition);
    if (pLimit !== undefined && (this.partitionBytes.get(partition) ?? 0) > pLimit) {
      this.evictPartition(partition, pLimit);
    }

    // Cross-partition eviction: ensure totalBytes <= totalMaxBytes
    this.evictGlobal();
  }

  delete(partition: string, key: string): boolean {
    const fullKey = `${partition}::${key}`;
    const entry = this.entries.get(fullKey);
    if (!entry) return false;

    this.entries.delete(fullKey);
    this.lruOrder.delete(fullKey);
    this.currentBytes -= entry.byteSize;
    this.partitionBytes.set(partition, Math.max(0, (this.partitionBytes.get(partition) ?? 0) - entry.byteSize));
    entry.onEvict?.(entry.key, entry.value);
    return true;
  }

  private evictGlobal(): void {
    while (this.currentBytes > this.totalMaxBytes && this.lruOrder.size > 0) {
      const oldestKey = this.lruOrder.keys().next().value;
      if (!oldestKey) break;
      const entry = this.entries.get(oldestKey);
      if (!entry) {
        this.lruOrder.delete(oldestKey);
        continue;
      }
      this.entries.delete(oldestKey);
      this.lruOrder.delete(oldestKey);
      this.currentBytes -= entry.byteSize;
      const pBytes = this.partitionBytes.get(entry.partition) ?? 0;
      this.partitionBytes.set(entry.partition, Math.max(0, pBytes - entry.byteSize));
      this.partitionEvictions.set(entry.partition, (this.partitionEvictions.get(entry.partition) ?? 0) + 1);
      this.totalEvictions += 1;
      entry.onEvict?.(entry.key, entry.value);
    }
  }

  private evictPartition(partition: string, targetBytes: number): void {
    for (const fullKey of this.lruOrder.keys()) {
      if ((this.partitionBytes.get(partition) ?? 0) <= targetBytes) break;
      const entry = this.entries.get(fullKey);
      if (entry && entry.partition === partition) {
        this.entries.delete(fullKey);
        this.lruOrder.delete(fullKey);
        this.currentBytes -= entry.byteSize;
        const pBytes = this.partitionBytes.get(partition) ?? 0;
        this.partitionBytes.set(partition, Math.max(0, pBytes - entry.byteSize));
        this.partitionEvictions.set(partition, (this.partitionEvictions.get(partition) ?? 0) + 1);
        this.totalEvictions += 1;
        entry.onEvict?.(entry.key, entry.value);
      }
    }
  }

  clear(partition?: string): void {
    if (partition) {
      for (const [fullKey, entry] of [...this.entries.entries()]) {
        if (entry.partition === partition) {
          this.delete(partition, entry.key);
        }
      }
    } else {
      for (const entry of this.entries.values()) {
        entry.onEvict?.(entry.key, entry.value);
      }
      this.entries.clear();
      this.lruOrder.clear();
      this.currentBytes = 0;
      this.partitionBytes.clear();
    }
  }

  stats(): GlobalCacheStats {
    const partitions: Record<string, { entries: number; bytes: number; evictions: number; maxBytes?: number }> = {};
    for (const [_, entry] of this.entries) {
      if (!partitions[entry.partition]) {
        partitions[entry.partition] = {
          entries: 0,
          bytes: this.partitionBytes.get(entry.partition) ?? 0,
          evictions: this.partitionEvictions.get(entry.partition) ?? 0,
          maxBytes: this.partitionLimits.get(entry.partition),
        };
      }
      partitions[entry.partition]!.entries++;
    }
    return {
      totalBytes: this.currentBytes,
      maxBytes: this.totalMaxBytes,
      totalEntries: this.entries.size,
      evictions: this.totalEvictions,
      partitions,
    };
  }

  createPartition<K = string, V = unknown>(name: string, sizeOf?: (value: V) => number, maxBytes?: number): CachePartition<K, V> {
    if (maxBytes !== undefined) {
      this.partitionLimits.set(name, maxBytes);
    }
    return new CachePartition<K, V>(this, name, sizeOf);
  }
}

export class CachePartition<K = string, V = unknown> {
  constructor(
    private readonly service: GlobalCacheService,
    readonly name: string,
    private readonly sizeOf: (value: V) => number = () => 1,
  ) {}

  get size(): number {
    const stats = this.service.stats();
    return stats.partitions[this.name]?.entries ?? 0;
  }

  get byteSize(): number {
    return this.service.stats().partitions[this.name]?.bytes ?? 0;
  }

  get(key: K): V | undefined {
    const res = this.service.get<V>(this.name, String(key));
    return res.hit ? res.value : undefined;
  }

  getWithCheck(key: K, expectedFormatVersion = CACHE_FORMAT_VERSION): { hit: boolean; value?: V; note?: string } {
    return this.service.get<V>(this.name, String(key), expectedFormatVersion);
  }

  has(key: K): boolean {
    return this.service.has(this.name, String(key));
  }

  set(key: K, value: V, options?: { formatVersion?: number; onEvict?: (key: string, value: V) => void }): void {
    const bytes = this.sizeOf(value);
    this.service.set<V>(this.name, String(key), value, bytes, options);
  }

  delete(key: K): boolean {
    return this.service.delete(this.name, String(key));
  }

  clear(): void {
    this.service.clear(this.name);
  }

  stats(): PartitionStats {
    const globalStats = this.service.stats();
    const p = globalStats.partitions[this.name];
    return {
      name: this.name,
      entries: p?.entries ?? 0,
      bytes: p?.bytes ?? 0,
      maxBytes: p?.maxBytes ?? this.service.maxBytes,
      evictions: p?.evictions ?? 0,
    };
  }
}

let defaultGlobalCacheService: GlobalCacheService | null = null;

export function getGlobalCacheService(totalBudget?: number): GlobalCacheService {
  if (!defaultGlobalCacheService || (totalBudget !== undefined && defaultGlobalCacheService.maxBytes !== totalBudget)) {
    defaultGlobalCacheService = new GlobalCacheService(totalBudget ?? 256 * 1024 * 1024);
  }
  return defaultGlobalCacheService;
}

export function setGlobalCacheService(service: GlobalCacheService | null): void {
  defaultGlobalCacheService = service;
}
