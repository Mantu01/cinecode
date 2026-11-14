import type { MediaCache } from "./cache.js";

export interface ResolveContext {
  readonly compositionPath: string;
  readonly projectRoot: string;
  readonly cache: MediaCache;
}

export interface MediaProbe {
  readonly duration?: number;
  readonly width?: number;
  readonly height?: number;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
}

export interface MediaResolver {
  readonly name: string;
  resolve(uri: string, context: ResolveContext): Promise<ArrayBuffer>;
  canResolve(uri: string): boolean;
  probe?(uri: string, context: ResolveContext): Promise<MediaProbe>;
}

export interface ResolverFetchOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}
