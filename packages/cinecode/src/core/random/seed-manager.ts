import { noise1d, noise2d, random, type SeededRandom } from "./prng.js";

export type SeedComponent = string | number;

export const DEFAULT_ROOT_SEED = 42;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function mix32(value: number): number {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function hashSeedComponent(component: SeedComponent): number {
  if (typeof component === "number") {
    const normalized = Number.isFinite(component) ? Math.round(component) : 0;
    return mix32(normalized | 0);
  }
  let hash = FNV_OFFSET;
  for (let i = 0; i < component.length; i += 1) {
    hash ^= component.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return mix32(hash);
}

export function deriveSeed(rootSeed: number, parts: readonly SeedComponent[]): number {
  let seed = mix32(rootSeed >>> 0);
  for (const part of parts) {
    seed = mix32(seed ^ hashSeedComponent(part));
  }
  return seed >>> 0;
}

export class SeedManager {
  private readonly rootSeedValue: number;
  private readonly path: readonly SeedComponent[];

  constructor(rootSeed: number = DEFAULT_ROOT_SEED, path: readonly SeedComponent[] = []) {
    this.rootSeedValue = Number.isFinite(rootSeed) ? Math.max(0, Math.floor(rootSeed)) : DEFAULT_ROOT_SEED;
    this.path = [...path];
  }

  get rootSeed(): number {
    return this.rootSeedValue;
  }

  get pathComponents(): readonly SeedComponent[] {
    return this.path;
  }

  getSubseed(parts: readonly SeedComponent[] = []): number {
    return deriveSeed(this.rootSeedValue, [...this.path, ...parts]);
  }

  child(parts: readonly SeedComponent[]): SeedManager {
    return new SeedManager(this.rootSeedValue, [...this.path, ...parts]);
  }

  random(parts: readonly SeedComponent[] = []): SeededRandom {
    return random(this.getSubseed(parts));
  }

  next(parts: readonly SeedComponent[] = []): number {
    return this.random(parts).next();
  }

  range(min: number, max: number, parts: readonly SeedComponent[] = []): number {
    return this.random(parts).range(min, max);
  }

  int(maxExclusive: number, parts: readonly SeedComponent[] = []): number {
    return this.random(parts).int(maxExclusive);
  }

  noise2d(x: number, y: number, parts: readonly SeedComponent[] = []): number {
    return noise2d(this.getSubseed(parts), x, y);
  }

  noise1d(t: number, parts: readonly SeedComponent[] = []): number {
    return noise1d(this.getSubseed(parts), t);
  }

  forFrame(frameIndex: number, context: readonly SeedComponent[] = []): SeedManager {
    return this.child([...context, frameIndex]);
  }

  forClip(clipId: string, trackId?: string): SeedManager {
    return this.child(trackId === undefined ? ["clip", clipId] : ["track", trackId, "clip", clipId]);
  }
}

let defaultSeedManager = new SeedManager(DEFAULT_ROOT_SEED);

export function createSeedManager(rootSeed: number = DEFAULT_ROOT_SEED): SeedManager {
  return new SeedManager(rootSeed);
}

export function getDefaultSeedManager(): SeedManager {
  return defaultSeedManager;
}

export function configureSeedManager(rootSeed: number): SeedManager {
  defaultSeedManager = new SeedManager(rootSeed);
  return defaultSeedManager;
}

export function resetSeedManager(): void {
  defaultSeedManager = new SeedManager(DEFAULT_ROOT_SEED);
}
