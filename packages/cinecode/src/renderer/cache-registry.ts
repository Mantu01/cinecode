import { getGlobalCacheService, type GlobalCacheService, type GlobalCacheStats } from "../pipeline/global-cache.js";

export type CacheCategory = "images" | "video-frames" | "rgba" | "canvases" | "3d" | "general";

const CATEGORY_QUOTA_RATIOS: Record<CacheCategory, number> = {
  "images": 0.20,
  "video-frames": 0.35,
  "rgba": 0.10,
  "canvases": 0.25,
  "3d": 0.10,
  "general": 0.10,
};

export interface SessionEntryRecord {
  readonly category: string;
  readonly key: string;
  readonly cleanup?: () => void;
}

export class ProcessCacheRegistry {
  private globalService: GlobalCacheService;
  private readonly sessionEntries = new Map<string, SessionEntryRecord[]>();

  constructor(totalBudgetBytes = 256 * 1024 * 1024) {
    this.globalService = this.initGlobalService(totalBudgetBytes);
  }

  private initGlobalService(totalBytes: number): GlobalCacheService {
    const limits: Record<string, number> = {};
    for (const [cat, ratio] of Object.entries(CATEGORY_QUOTA_RATIOS)) {
      limits[cat] = Math.max(1024 * 1024, Math.floor(totalBytes * ratio));
    }
    return getGlobalCacheService(totalBytes);
  }

  configureBudget(totalBudgetBytes: number): void {
    if (totalBudgetBytes <= 0) return;
    this.globalService = this.initGlobalService(totalBudgetBytes);
  }

  getService(): GlobalCacheService {
    return this.globalService;
  }

  registerSessionEntry(sessionId: string, category: string, key: string, cleanup?: () => void): void {
    let list = this.sessionEntries.get(sessionId);
    if (!list) {
      list = [];
      this.sessionEntries.set(sessionId, list);
    }
    list.push({ category, key, cleanup });
  }

  releaseSession(sessionId: string): void {
    const list = this.sessionEntries.get(sessionId);
    if (!list) return;
    this.sessionEntries.delete(sessionId);
    for (const entry of list) {
      try {
        entry.cleanup?.();
      } catch {
        // Note: best-effort cleanup on release
      }
      this.globalService.delete(entry.category, entry.key);
    }
  }

  clearAll(): void {
    for (const list of this.sessionEntries.values()) {
      for (const entry of list) {
        try {
          entry.cleanup?.();
        } catch {
          // Note: best-effort cleanup
        }
      }
    }
    this.sessionEntries.clear();
    this.globalService.clear();
  }

  getStats(): GlobalCacheStats {
    return this.globalService.stats();
  }
}

let defaultRegistry: ProcessCacheRegistry | null = null;

export function getProcessCacheRegistry(totalBudget?: number): ProcessCacheRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new ProcessCacheRegistry(totalBudget);
  } else if (totalBudget !== undefined && defaultRegistry.getStats().maxBytes !== totalBudget) {
    defaultRegistry.configureBudget(totalBudget);
  }
  return defaultRegistry;
}

export function configureProcessCacheRegistry(budgetBytes: number): void {
  getProcessCacheRegistry(budgetBytes).configureBudget(budgetBytes);
}

export function releaseSessionCaches(sessionId: string): void {
  defaultRegistry?.releaseSession(sessionId);
}
