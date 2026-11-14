import { createHash } from "node:crypto";
import { toArrayBuffer, type MediaProbe, type MediaResolver, type ResolveContext } from "../resolver-types.js";

function normalize(uri: string): string {
  return createHash("sha256").update(uri).digest("hex");
}

export class HttpMediaResolver implements MediaResolver {
  readonly name = "http";

  canResolve(uri: string): boolean {
    return /^https?:\/\//i.test(uri);
  }

  async resolve(uri: string, context: ResolveContext): Promise<ArrayBuffer> {
    const cached = await context.cache.getRemote(uri);
    if (cached) return toArrayBuffer(cached);

    let response: Response;
    try {
      response = await fetch(uri, { redirect: "follow" });
    } catch (error) {
      throw new Error(
        `Failed to fetch ${uri}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch ${uri}: HTTP ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await context.cache.setRemote(uri, buffer);
    return toArrayBuffer(buffer);
  }

  async probe(uri: string, context: ResolveContext): Promise<MediaProbe> {
    try {
      const response = await fetch(uri, { method: "HEAD" });
      if (!response.ok) return {};
      const length = response.headers.get("content-length");
      return {
        mimeType: response.headers.get("content-type") ?? undefined,
        sizeBytes: length ? Number.parseInt(length, 10) : undefined,
      };
    } catch {
      void context;
      return {};
    }
  }

  cacheKey(uri: string): string {
    return normalize(uri);
  }
}
