export interface CacheRequest {
  type: "cache-request";
  key: string;
  resolution?: { width: number; height: number };
}

export interface CacheResponse {
  type: "cache-response";
  key: string;
  hit: boolean;
  data?: Buffer;
}

export type WorkerChannelMessage = CacheRequest | CacheResponse;

export type CacheProvider = (request: CacheRequest) => Promise<Buffer | undefined>;

/**
 * Main-thread side: answers CacheRequest messages from a worker. Video frames
 * and media blobs stay in the main-thread MediaCache; each worker keeps its own
 * local copy of whatever data the channel returns.
 */
export function attachCacheChannel(worker: WorkerLike, provider: CacheProvider): void {
  worker.on("message", (msg: unknown) => {
    if (!isCacheRequest(msg)) return;
    void provider(msg)
      .then((data) =>
        worker.postMessage({
          type: "cache-response",
          key: msg.key,
          hit: data !== undefined,
          ...(data !== undefined ? { data } : {}),
        } satisfies CacheResponse),
      )
      .catch(() =>
        worker.postMessage({
          type: "cache-response",
          key: msg.key,
          hit: false,
        } satisfies CacheResponse),
      );
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
  return (
    typeof msg === "object" && msg !== null && (msg as CacheResponse).type === "cache-response"
  );
}

/** Worker-thread side: one in-flight request per key to avoid duplicate misses. */
export function createCacheClient(port: {
  on(event: "message", listener: (msg: unknown) => void): unknown;
  postMessage(value: unknown): void;
}): {
  request(key: string, resolution?: { width: number; height: number }): Promise<CacheResponse>;
} {
  const pending = new Map<string, (response: CacheResponse) => void>();
  port.on("message", (msg: unknown) => {
    if (!isCacheResponse(msg)) return;
    pending.get(msg.key)?.(msg);
    pending.delete(msg.key);
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
  };
}
