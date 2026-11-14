import path from "node:path";
import fs from "node:fs";

export interface TenantQuota {
  maxDiskBytes: number;
  maxWorkerThreads: number;
  maxConcurrentRenders: number;
}

export const DEFAULT_TENANT_QUOTA: TenantQuota = {
  maxDiskBytes: 50 * 1024 * 1024 * 1024,
  maxWorkerThreads: 8,
  maxConcurrentRenders: 4,
};

export class TenantContext {
  readonly tenantId: string;
  readonly cacheDir: string;
  readonly quota: TenantQuota;
  private activeRenders = 0;

  constructor(tenantId: string, baseCacheDir = ".cinecode/cache", quota: Partial<TenantQuota> = {}) {
    if (!tenantId || !/^[A-Za-z0-9_-]+$/.test(tenantId)) {
      throw new Error(`Invalid tenant ID: '${tenantId}'. Must be alphanumeric with dashes or underscores.`);
    }
    this.tenantId = tenantId;
    this.cacheDir = path.resolve(baseCacheDir, "tenants", tenantId);
    this.quota = { ...DEFAULT_TENANT_QUOTA, ...quota };
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  getTenantScopedPath(subpath: string): string {
    const resolved = path.resolve(this.cacheDir, subpath);
    if (!resolved.startsWith(this.cacheDir)) {
      throw new Error(`Directory traversal violation: path escapes tenant scope '${this.tenantId}'`);
    }
    return resolved;
  }

  canStartRender(): boolean {
    return this.activeRenders < this.quota.maxConcurrentRenders;
  }

  acquireRenderSlot(): void {
    if (!this.canStartRender()) {
      throw new Error(`Tenant '${this.tenantId}' exceeded max concurrent renders quota (${this.quota.maxConcurrentRenders})`);
    }
    this.activeRenders++;
  }

  releaseRenderSlot(): void {
    if (this.activeRenders > 0) this.activeRenders--;
  }

  get currentActiveRenders(): number {
    return this.activeRenders;
  }
}
