export interface CacheRequest {
  type: "cache-request";
  key: string;
  resolution?: { width: number; height: number };
}

export interface CacheItem {
  data: Buffer;
  width?: number;
  height?: number;
  format?: "rgba" | "rgb24";
}

export interface CacheResponse {
  type: "cache-response";
  key: string;
  hit: boolean;
  data?: Buffer;
  width?: number;
  height?: number;
  format?: "rgba" | "rgb24";
  error?: string;
}

export interface CacheBatchRequest {
  type: "cache-batch-request";
  id: number;
  keys: string[];
}

export interface CacheBatchResponse {
  type: "cache-batch-response";
  id: number;
  items: CacheResponse[];
}

export type WorkerChannelMessage = CacheRequest | CacheResponse | CacheBatchRequest | CacheBatchResponse;

export type CacheProvider = (request: CacheRequest) => Promise<Buffer | CacheItem | undefined>;
export type BatchCacheProvider = (keys: readonly string[]) => Promise<Map<string, CacheItem>>;

export interface CacheChannelOptions {
  readonly single?: CacheProvider;
  readonly batch?: BatchCacheProvider;
}

/**
 * Main-thread side: answers CacheRequest / CacheBatchRequest messages from a worker.
 * Binary buffers cross directly via structured clone without base64 or JSON wrapping.
 */
export function attachCacheChannel(
  worker: WorkerLike,
  providerOrOptions: CacheProvider | CacheChannelOptions,
): void {
  const single = typeof providerOrOptions === "function" ? providerOrOptions : providerOrOptions.single;
  const batch = typeof providerOrOptions === "object" ? providerOrOptions.batch : undefined;

  worker.on("message", (msg: unknown) => {
    if (isCacheRequest(msg)) {
      if (!single && !batch) {
        worker.postMessage({ type: "cache-response", key: msg.key, hit: false } satisfies CacheResponse);
        return;
      }
      const p = single
        ? single(msg)
        : batch!([msg.key]).then((map) => map.get(msg.key));

      p.then((result) => {
        if (!result) {
          worker.postMessage({ type: "cache-response", key: msg.key, hit: false } satisfies CacheResponse);
          return;
        }
        if (Buffer.isBuffer(result)) {
          worker.postMessage({ type: "cache-response", key: msg.key, hit: true, data: result } satisfies CacheResponse);
        } else {
          worker.postMessage({
            type: "cache-response",
            key: msg.key,
            hit: true,
            data: result.data,
            width: result.width,
            height: result.height,
            format: result.format,
          } satisfies CacheResponse);
        }
      }).catch((err: unknown) => {
        worker.postMessage({
          type: "cache-response",
          key: msg.key,
          hit: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies CacheResponse);
      });
      return;
    }

    if (isCacheBatchRequest(msg)) {
      if (batch) {
        batch(msg.keys)
          .then((map) => {
            const items: CacheResponse[] = msg.keys.map((key) => {
              const item = map.get(key);
              if (!item) return { type: "cache-response", key, hit: false };
              return {
                type: "cache-response",
                key,
                hit: true,
                data: item.data,
                width: item.width,
                height: item.height,
                format: item.format,
              };
            });
            worker.postMessage({ type: "cache-batch-response", id: msg.id, items } satisfies CacheBatchResponse);
          })
          .catch((err: unknown) => {
            const error = err instanceof Error ? err.message : String(err);
            const items: CacheResponse[] = msg.keys.map((key) => ({
              type: "cache-response",
              key,
              hit: false,
              error,
            }));
            worker.postMessage({ type: "cache-batch-response", id: msg.id, items } satisfies CacheBatchResponse);
          });
      } else if (single) {
        Promise.all(
          msg.keys.map(async (key) => {
            try {
              const res = await single({ type: "cache-request", key });
              if (!res) return { type: "cache-response" as const, key, hit: false };
              if (Buffer.isBuffer(res)) return { type: "cache-response" as const, key, hit: true, data: res };
              return {
                type: "cache-response" as const,
                key,
                hit: true,
                data: res.data,
                width: res.width,
                height: res.height,
                format: res.format,
              };
            } catch (err: unknown) {
              return {
                type: "cache-response" as const,
                key,
                hit: false,
                error: err instanceof Error ? err.message : String(err),
              };
            }
          }),
        ).then((items) => {
          worker.postMessage({ type: "cache-batch-response", id: msg.id, items } satisfies CacheBatchResponse);
        });
      } else {
        const items: CacheResponse[] = msg.keys.map((key) => ({ type: "cache-response", key, hit: false }));
        worker.postMessage({ type: "cache-batch-response", id: msg.id, items } satisfies CacheBatchResponse);
      }
    }
  });
}

export interface WorkerLike {
  on(event: "message", listener: (msg: unknown) => void): unknown;
  postMessage(value: unknown): void;
}

function isCacheRequest(msg: unknown): msg is CacheRequest {
  return typeof msg === "object" && msg !== null && (msg as CacheRequest).type === "cache-request";
}

function isCacheResponse(msg: unknown): msg is CacheResponse {
  return typeof msg === "object" && msg !== null && (msg as CacheResponse).type === "cache-response";
}

function isCacheBatchRequest(msg: unknown): msg is CacheBatchRequest {
  return typeof msg === "object" && msg !== null && (msg as CacheBatchRequest).type === "cache-batch-request";
}

function isCacheBatchResponse(msg: unknown): msg is CacheBatchResponse {
  return typeof msg === "object" && msg !== null && (msg as CacheBatchResponse).type === "cache-batch-response";
}

export interface CacheClient {
  request(key: string, resolution?: { width: number; height: number }): Promise<CacheResponse>;
  requestBatch(keys: readonly string[]): Promise<CacheResponse[]>;
}

let batchIdSequence = 0;

/** Worker-thread side: supports single and batch raw binary frame requests. */
export function createCacheClient(port: {
  on(event: "message", listener: (msg: unknown) => void): unknown;
  postMessage(value: unknown): void;
}): CacheClient {
  const pending = new Map<string, (response: CacheResponse) => void>();
  const pendingBatches = new Map<number, (items: CacheResponse[]) => void>();

  port.on("message", (msg: unknown) => {
    if (isCacheResponse(msg)) {
      pending.get(msg.key)?.(msg);
      pending.delete(msg.key);
      return;
    }
    if (isCacheBatchResponse(msg)) {
      pendingBatches.get(msg.id)?.(msg.items);
      pendingBatches.delete(msg.id);
    }
  });

  return {
    request(key, resolution) {
      return new Promise<CacheResponse>((resolve) => {
        pending.set(key, resolve);
        port.postMessage({
          type: "cache-request",
          key,
          ...(resolution ? { resolution } : {}),
        } satisfies CacheRequest);
      });
    },
    requestBatch(keys) {
      if (keys.length === 0) return Promise.resolve([]);
      return new Promise<CacheResponse[]>((resolve) => {
        const id = ++batchIdSequence;
        pendingBatches.set(id, resolve);
        port.postMessage({
          type: "cache-batch-request",
          id,
          keys: [...keys],
        } satisfies CacheBatchRequest);
      });
    },
  };
}
