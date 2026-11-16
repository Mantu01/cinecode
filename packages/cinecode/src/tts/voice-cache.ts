import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const VOICE_CACHE_DIR = join(homedir(), ".cinecode", "voices");
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface VoiceCacheEntry {
  voiceId: string;
  buffer: Buffer;
  cachedAt: number;
  ttlMs: number;
}

interface StoredVoiceCacheEntry {
  voiceId: string;
  buffer: number[];
  cachedAt: number;
  ttlMs: number;
}

function entryPath(dir: string, voiceId: string): string {
  return join(dir, `${voiceId}.json`);
}

export class VoiceCache {
  constructor(private readonly dir: string = VOICE_CACHE_DIR) {}

  async get(voiceId: string): Promise<Buffer | null> {
    const raw = await readFile(join(this.dir, `${voiceId}.json`), "utf8").catch(() => null);
    if (!raw) return null;
    let entry: VoiceCacheEntry;
    try {
      entry = JSON.parse(raw) as VoiceCacheEntry;
    } catch {
      return null;
    }
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      await rm(join(this.dir, `${voiceId}.json`), { force: true }).catch(() => undefined);
      return null;
    }
    return Buffer.from(entry.buffer);
  }

  async set(voiceId: string, buffer: Buffer, ttlMs: number = DEFAULT_TTL_MS): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const entry: StoredVoiceCacheEntry = {
      voiceId,
      buffer: Array.from(buffer),
      cachedAt: Date.now(),
      ttlMs,
    };
    await writeFile(join(this.dir, `${voiceId}.json`), JSON.stringify(entry), "utf8");
  }

  async purge(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true }).catch(() => undefined);
  }

  async status(): Promise<{ count: number; sizeBytes: number }> {
    const files = await readdir(this.dir).catch(() => []);
    let count = 0;
    let sizeBytes = 0;
    for (const file of files) {
      const info = await stat(join(this.dir, file)).catch(() => null);
      if (!info?.isFile()) continue;
      count += 1;
      sizeBytes += info.size;
    }
    return { count, sizeBytes };
  }
}

export const voiceCache = new VoiceCache();
