import { stat, readdir } from "node:fs/promises";
import { join, resolve, relative, basename } from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { MediaMetadata, MediaCache } from "./cache.js";
import { inspectMedia, getMediaType, getExtendedMediaType, type MediaFileType } from "./inspector.js";
import { resolveMediaFilePath } from "./paths.js";
import { createError, ErrorCode } from "../errors/index.js";
import { recordDegradation } from "../errors/degradations.js";
import type { MainManifest, Composition } from "../core/types/index.js";
import type { ResolvedMedia } from "./resolver.js";

export type MediaReferenceState = "referenced" | "unreferenced" | "missing";

export interface MediaIndexEntry {
  readonly id: string;
  readonly name: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly root: "media" | "source";
  readonly type: MediaFileType;
  readonly size: number;
  readonly exists: boolean;
  readonly hash?: string;
  readonly metadata?: MediaMetadata;
  readonly state: MediaReferenceState;
  readonly origin: "local" | "cloud";
  readonly referencedBy: readonly string[];
}

export interface MediaIndexOptions {
  readonly mediaDir: string;
  readonly sourceDir: string;
  readonly projectRoot: string;
  readonly allowCoLocatedMedia?: boolean;
  readonly cache: MediaCache;
  readonly cloudMedia?: readonly { url: string; name?: string; sha256?: string }[];
  readonly ignore?: (relativePath: string) => boolean;
  readonly manifest?: MainManifest | null;
  readonly compositions?: readonly Composition[];
}

export class MediaIndex {
  readonly mediaDir: string;
  readonly sourceDir: string;
  readonly projectRoot: string;
  readonly allowCoLocatedMedia: boolean;
  private readonly cache: MediaCache;
  private readonly cloudMedia: readonly { url: string; name?: string; sha256?: string }[];
  private readonly ignore?: (relativePath: string) => boolean;
  private readonly manifest?: MainManifest | null;
  private readonly compositions?: readonly Composition[];

  private entriesByPath = new Map<string, MediaIndexEntry>();
  private entriesByName = new Map<string, MediaIndexEntry[]>();
  private initialized = false;

  constructor(options: MediaIndexOptions) {
    this.projectRoot = resolve(options.projectRoot);
    this.mediaDir = resolve(this.projectRoot, options.mediaDir);
    this.sourceDir = resolve(this.projectRoot, options.sourceDir);
    this.allowCoLocatedMedia = options.allowCoLocatedMedia === true;
    this.cache = options.cache;
    this.cloudMedia = options.cloudMedia ?? [];
    this.ignore = options.ignore;
    this.manifest = options.manifest;
    this.compositions = options.compositions;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.entriesByPath.clear();
    this.entriesByName.clear();

    await this.scanDirectory(this.mediaDir, "media");
    if (this.allowCoLocatedMedia) {
      await this.scanDirectory(this.sourceDir, "source");
    }

    await this.correlateReferences();
    this.initialized = true;
  }

  private async scanDirectory(dir: string, rootType: "media" | "source"): Promise<void> {
    try {
      const items = await readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = join(dir, item.name);
        if (item.isDirectory()) {
          if (rootType === "source" && ["node_modules", ".git", ".cinecode"].includes(item.name)) continue;
          await this.scanDirectory(fullPath, rootType);
        } else if (item.isFile()) {
          const rootBase = rootType === "media" ? this.mediaDir : this.sourceDir;
          const relPath = relative(rootBase, fullPath).replace(/\\/g, "/");
          if (this.ignore?.(relPath)) continue;

          const type = getExtendedMediaType(fullPath);
          if (rootType === "source" && (type === "unknown" || fullPath.endsWith(".ts") || fullPath.endsWith(".js") || fullPath.endsWith(".json"))) {
            continue;
          }

          let size = 0;
          try {
            const st = await stat(fullPath);
            size = st.size;
          } catch {
            // Note: stat failed, use size 0
            void 0;
          }

          const entry: MediaIndexEntry = {
            id: relPath,
            name: item.name,
            relativePath: relPath,
            absolutePath: fullPath,
            root: rootType,
            type,
            size,
            exists: true,
            state: "unreferenced",
            origin: "local",
            referencedBy: [],
          };
          this.addEntry(entry);
        }
      }
    } catch (error) {
      recordDegradation({
        code: "CC2004",
        what: `media directory scan incomplete for ${dir}`,
        reason: error instanceof Error ? error.message : String(error),
        input: dir,
        instead: "files below this directory are not indexed until it is readable",
      });
    }
  }

  private addEntry(entry: MediaIndexEntry): void {
    this.entriesByPath.set(entry.absolutePath, entry);
    const lowerName = entry.name.toLowerCase();
    const existing = this.entriesByName.get(lowerName) ?? [];
    existing.push(entry);
    this.entriesByName.set(lowerName, existing);
  }

  private async correlateReferences(): Promise<void> {
    const references = new Map<string, Set<string>>();

    const addRef = (ref: string, by: string): void => {
      const existing = references.get(ref) ?? new Set<string>();
      existing.add(by);
      references.set(ref, existing);
    };

    if (this.manifest) {
      for (const aud of this.manifest.audio ?? []) {
        if (aud.src) addRef(aud.src, `audio:${aud.id}`);
        if (aud.file && (aud.file.endsWith(".wav") || aud.file.endsWith(".mp3") || aud.file.endsWith(".flac"))) {
          addRef(aud.file, `audio:${aud.id}`);
        }
      }
    }

    if (this.compositions) {
      for (const comp of this.compositions) {
        const rawComp = comp as Composition & { tracks?: Array<{ clips?: Array<{ src?: string }> }> };
        const tracks = rawComp.rootTimeline?.tracks ?? rawComp.tracks ?? [];
        for (const track of tracks) {
          for (const clip of track.clips ?? []) {
            const src = (clip as { src?: string }).src;
            if (src) {
              addRef(src, `comp:${comp.name}`);
            }
          }
        }
      }
    }

    for (const cloud of this.cloudMedia) {
      const fileName = cloud.name ?? cloud.url.split("/").pop() ?? "download";
      addRef(fileName, `cloudMedia:${cloud.url}`);
    }

    for (const [ref, bySet] of references) {
      const byArray = Array.from(bySet);
      const match = this.findMatchingEntry(ref);
      if (match) {
        const updated: MediaIndexEntry = {
          ...match,
          state: "referenced",
          origin: ref.startsWith("http://") || ref.startsWith("https://") ? "cloud" : match.origin,
          referencedBy: [...new Set([...match.referencedBy, ...byArray])],
        };
        this.entriesByPath.set(match.absolutePath, updated);
      } else {
        const isCloud = ref.startsWith("http://") || ref.startsWith("https://") || Array.from(bySet).some(b => b.startsWith("cloudMedia:"));
        const missingEntry: MediaIndexEntry = {
          id: ref,
          name: basename(ref),
          relativePath: ref,
          absolutePath: resolve(this.mediaDir, ref),
          root: "media",
          type: getExtendedMediaType(ref),
          size: 0,
          exists: false,
          state: "missing",
          origin: isCloud ? "cloud" : "local",
          referencedBy: byArray,
        };
        this.addEntry(missingEntry);
      }
    }
  }

  private findMatchingEntry(ref: string): MediaIndexEntry | undefined {
    const directMedia = resolve(this.mediaDir, ref);
    if (this.entriesByPath.has(directMedia)) {
      return this.entriesByPath.get(directMedia);
    }
    if (this.allowCoLocatedMedia) {
      const directSource = resolve(this.sourceDir, ref);
      if (this.entriesByPath.has(directSource)) {
        return this.entriesByPath.get(directSource);
      }
    }
    const lower = basename(ref).toLowerCase();
    const matches = this.entriesByName.get(lower);
    if (matches && matches.length > 0) {
      const inMedia = matches.find(m => m.root === "media" && m.exists);
      if (inMedia) return inMedia;
      if (this.allowCoLocatedMedia) {
        const inSource = matches.find(m => m.root === "source" && m.exists);
        if (inSource) return inSource;
      }
      return matches[0];
    }
    return undefined;
  }

  // One media resolution rule: media root first, then co-located under source root if allowed, then fail.
  async resolveMedia(ref: string): Promise<ResolvedMedia> {
    if (!this.initialized) await this.initialize();

    const resolved = resolveMediaFilePath(ref, this.projectRoot, {
      mediaDir: this.mediaDir,
      sourceDir: this.sourceDir,
      allowCoLocatedMedia: this.allowCoLocatedMedia,
    });

    const direct = this.entriesByPath.get(resolved);
    if (direct) {
      return this.toResolvedMedia(direct);
    }

    const metadata = await inspectMedia(resolved, { cache: this.cache, sourceDir: this.sourceDir });
    return {
      path: resolved,
      name: basename(resolved),
      type: getMediaType(resolved) as "video" | "image" | "audio",
      metadata,
    };
  }

  private async toResolvedMedia(entry: MediaIndexEntry): Promise<ResolvedMedia> {
    const metadata = await inspectMedia(entry.absolutePath, { cache: this.cache, sourceDir: this.sourceDir });
    return {
      path: entry.absolutePath,
      name: entry.name,
      type: entry.type === "video" || entry.type === "image" || entry.type === "audio" ? entry.type : "video",
      metadata,
    };
  }

  list(): readonly MediaIndexEntry[] {
    return Array.from(this.entriesByPath.values());
  }

  missing(): readonly MediaIndexEntry[] {
    return this.list().filter(e => !e.exists || e.state === "missing");
  }

  referenced(): readonly MediaIndexEntry[] {
    return this.list().filter(e => e.state === "referenced");
  }

  unreferenced(): readonly MediaIndexEntry[] {
    return this.list().filter(e => e.exists && e.state === "unreferenced");
  }

  async computeFileHash(absolutePath: string): Promise<string> {
    const data = await readFile(absolutePath);
    return createHash("sha256").update(data).digest("hex");
  }
}
