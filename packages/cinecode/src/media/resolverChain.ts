import { writeFile } from "node:fs/promises";
import type { MediaProbe, MediaResolver, ResolveContext } from "./resolver-types.js";
import { FileSystemMediaResolver } from "./resolvers/filesystem.js";
import { HttpMediaResolver } from "./resolvers/http.js";
import { CloudMediaResolver } from "./resolvers/cloud.js";

export class ResolverChain {
  private readonly resolvers: MediaResolver[] = [];
  private readonly fallbackResolver: MediaResolver = new FileSystemMediaResolver();

  constructor(resolvers: readonly MediaResolver[] = []) {
    this.resolvers.push(...resolvers);
  }

  add(resolver: MediaResolver): void {
    const existing = this.resolvers.findIndex((entry) => entry.name === resolver.name);
    if (existing >= 0) this.resolvers.splice(existing, 1);
    this.resolvers.push(resolver);
  }

  prepend(resolver: MediaResolver): void {
    const existing = this.resolvers.findIndex((entry) => entry.name === resolver.name);
    if (existing >= 0) this.resolvers.splice(existing, 1);
    this.resolvers.unshift(resolver);
  }

  remove(name: string): boolean {
    const index = this.resolvers.findIndex((entry) => entry.name === name);
    if (index < 0) return false;
    this.resolvers.splice(index, 1);
    return true;
  }

  list(): readonly MediaResolver[] {
    return [...this.resolvers, this.fallbackResolver];
  }

  canResolve(uri: string): boolean {
    return this.findResolver(uri) !== undefined;
  }

  async resolve(uri: string, context: ResolveContext): Promise<ArrayBuffer> {
    const resolver = this.findResolver(uri);
    if (!resolver) throw new Error(`No media resolver found for ${uri}`);
    return resolver.resolve(uri, context);
  }

  async probe(uri: string, context: ResolveContext): Promise<MediaProbe> {
    const resolver = this.findResolver(uri);
    if (!resolver?.probe) return {};
    return resolver.probe(uri, context);
  }

  async resolveToFile(uri: string, context: ResolveContext): Promise<string> {
    const cachedPath = context.cache.remoteFilePath(uri);
    const cached = await context.cache.getRemote(uri);
    if (cached) return cachedPath;
    const buffer = Buffer.from(await this.resolve(uri, context));
    await writeFile(cachedPath, buffer);
    return cachedPath;
  }

  private findResolver(uri: string): MediaResolver | undefined {
    return this.resolvers.find((resolver) => resolver.canResolve(uri)) ?? this.fallbackResolver;
  }
}

let defaultChain: ResolverChain | null = null;

export function getMediaResolverChain(): ResolverChain {
  if (!defaultChain) {
    defaultChain = new ResolverChain([
      new HttpMediaResolver(),
      new CloudMediaResolver(),
    ]);
  }
  return defaultChain;
}

export function setMediaResolverChain(chain: ResolverChain | null): void {
  defaultChain = chain;
}

export function addMediaResolverToChain(resolver: MediaResolver): void {
  getMediaResolverChain().prepend(resolver);
}
