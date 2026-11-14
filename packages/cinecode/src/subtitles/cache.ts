import { loadSubtitles } from "./load.js";
import type { SubtitleEntry } from "./parser.js";

const subtitleCache = new Map<string, Promise<SubtitleEntry[]>>();

export function getSubtitleEntries(filePath: string): Promise<SubtitleEntry[]> {
  let pending = subtitleCache.get(filePath);
  if (pending === undefined) {
    pending = loadSubtitles(filePath);
    subtitleCache.set(filePath, pending);
  }
  return pending;
}

export function clearSubtitleCache(): void {
  subtitleCache.clear();
}

export function isSubtitleCached(filePath: string): boolean {
  return subtitleCache.has(filePath);
}
