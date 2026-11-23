export interface FrameCacheIndexEntry {
  readonly hash: string;
  readonly size: number;
  readonly access: number;
  readonly chunkIndex?: number;
  readonly offset?: number;
}

export interface FrameCacheIndex {
  readonly version: 2;
  readonly compositionId: string;
  readonly compositionHash: string;
  frames: Record<string, FrameCacheIndexEntry>;
  chunks: Record<string, { readonly frames: readonly number[]; readonly timestamp: number; readonly payloadHash?: string; readonly payloadSize?: number }>;
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
