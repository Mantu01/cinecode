import { stat, readdir } from "node:fs/promises";
import { join, resolve, relative, basename } from "node:path";
import type { MediaMetadata, MediaCache } from "./cache.js";
import { inspectMedia, getMediaType, isSupportedVideoExtension, isSupportedImageExtension, isSupportedAudioExtension } from "./inspector.js";
import { resolveMediaSource } from "../extensions/index.js";
import { getMediaResolverChain } from "./resolverChain.js";
import { recordDegradation } from "../errors/degradations.js";

export interface ResolverOptions {
  sourceDir: string;
  cache: MediaCache;
  cloudMedia?: readonly { url: string; name?: string; sha256?: string }[];
  ignore?: (relativePath: string) => boolean;
}

export interface ResolvedMedia {
  readonly path: string;
  readonly name: string;
  readonly type: "video" | "image" | "audio";
  readonly metadata: MediaMetadata;
}

export interface MediaResolutionError extends Error {
  readonly code: "CC2001" | "CC2002" | "CC2003";
  readonly suggestions?: string[];
}

export class MediaResolutionErrorImpl extends Error {
  readonly code: "CC2001" | "CC2002" | "CC2003";
  readonly severity = "error" as const;
  readonly suggestions?: string[];
  readonly location?: { file: string };
  readonly fixHint?: string;

  constructor(
    code: "CC2001" | "CC2002" | "CC2003",
    message: string,
    suggestions?: string[],
    path?: string,
  ) {
    super(message);
    this.name = "MediaResolutionError";
    this.code = code;
    this.suggestions = suggestions;
    this.location = path ? { file: path } : undefined;
    this.fixHint = code === "CC2001" ? "Verify the resolved path exists; run `cinecode media:list`." : "Check the file with `ffmpeg -i <file>` and re-export it if corrupted.";
  }
}

export class MediaCatalog {
  private readonly sourceDir: string;
  private readonly cache: MediaCache;
  private readonly cloudMedia: readonly { url: string; name?: string; sha256?: string }[];
  private readonly ignore?: (relativePath: string) => boolean;
  private fileIndex: Map<string, string> = new Map();

  constructor(options: ResolverOptions) {
    this.sourceDir = resolve(options.sourceDir);
    this.cache = options.cache;
    this.cloudMedia = options.cloudMedia ?? [];
    this.ignore = options.ignore;
  }

  async initialize(): Promise<void> {
    await this.buildFileIndex();
  }

  private async buildFileIndex(): Promise<void> {
    this.fileIndex.clear();
    await this.indexDirectory(this.sourceDir);
  }

  private async indexDirectory(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.indexDirectory(fullPath);
        } else if (entry.isFile()) {
          const relPath = relative(this.sourceDir, fullPath).replace(/\\/g, "/");
          if (this.ignore?.(relPath)) continue;
          this.fileIndex.set(relPath.toLowerCase(), fullPath);
          this.fileIndex.set(entry.name.toLowerCase(), fullPath);
        }
      }
    } catch (error) {
      recordDegradation({
        code: "CC2004",
        what: "media source directory scan incomplete",
        reason: error instanceof Error ? error.message : String(error),
        input: dir,
        instead: "files below this directory are not indexed until it is readable",
      });
    }
  }

  async resolve(name: string, position?: { file: string; line: number; column: number }): Promise<ResolvedMedia> {
    if (/^(https?|s3|gs):\/\//i.test(name)) {
      const chain = getMediaResolverChain();
      try {
        const path = await chain.resolveToFile(name, {
          compositionPath: this.sourceDir,
          projectRoot: this.sourceDir,
          cache: this.cache,
        });
        const type = getMediaType(path);
        if (type === "unknown") {
          throw new MediaResolutionErrorImpl("CC2002", `Unsupported remote format: ${name}`, undefined, name);
        }
        const metadata = await inspectMedia(path, { cache: this.cache, sourceDir: this.sourceDir });
        return { path, name: basename(path), type, metadata };
      } catch (error) {
        if (error instanceof MediaResolutionErrorImpl) throw error;
        throw new MediaResolutionErrorImpl(
          "CC2003",
          `Failed to resolve remote media "${name}": ${error instanceof Error ? error.message : String(error)}`,
          undefined,
          name,
        );
      }
    }

    const normalizedName = name.toLowerCase();
    const filePath = this.fileIndex.get(normalizedName);

    if (!filePath) {
      // Registered media sources get first refusal before the local lookup fails:
      // a source can resolve refs the local index does not contain (cloud, API…).
      const source = resolveMediaSource(name);
      if (source) {
        const resolution = await source.resolve(name);
        const type = getMediaType(resolution.path);
        if (type !== "unknown") {
          try {
            const metadata = await inspectMedia(resolution.path, { cache: this.cache, sourceDir: this.sourceDir });
            return { path: resolution.path, name: resolution.name ?? basename(resolution.path), type, metadata };
          } catch (error) {
            throw new MediaResolutionErrorImpl(
              "CC2003",
              `Unreadable or corrupt file: ${resolution.path}. ${error instanceof Error ? error.message : String(error)}`,
              undefined,
              resolution.path,
            );
          }
        }
      }
      const suggestions = this.findSimilar(normalizedName);
      const message = this.formatMissingError(name, suggestions, position);
      throw new MediaResolutionErrorImpl("CC2001", message, suggestions, resolve(this.sourceDir, name));
    }

    const type = getMediaType(filePath);
    if (type === "unknown") {
      throw new MediaResolutionErrorImpl("CC2002", `Unsupported format: ${filePath}`, undefined, filePath);
    }

    try {
      await stat(filePath);
    } catch {
      throw new MediaResolutionErrorImpl("CC2003", `Unreadable or corrupt file: ${filePath}`, undefined, filePath);
    }

    const metadata = await inspectMedia(filePath, { cache: this.cache, sourceDir: this.sourceDir });

    return {
      path: filePath,
      name: basename(filePath),
      type,
      metadata,
    };
  }

  private findSimilar(name: string): string[] {
    const allNames = Array.from(this.fileIndex.keys());
    const scored = allNames
      .map(n => ({ name: n, score: this.levenshtein(name, n) }))
      .filter(x => x.score <= 3)
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map(x => x.name);
    return scored;
  }

  private levenshtein(a: string, b: string): number {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const matrix = new Array(rows * cols).fill(0);
    const idx = (r: number, c: number) => r * cols + c;

    for (let i = 0; i <= a.length; i++) matrix[idx(i, 0)] = i;
    for (let j = 0; j <= b.length; j++) matrix[idx(0, j)] = j;

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const charA = a[i - 1];
        const charB = b[j - 1];
        if (charA === charB) {
          matrix[idx(i, j)] = matrix[idx(i - 1, j - 1)];
        } else {
          matrix[idx(i, j)] = 1 + Math.min(
            matrix[idx(i - 1, j)],
            matrix[idx(i, j - 1)],
            matrix[idx(i - 1, j - 1)]
          );
        }
      }
    }
    return matrix[idx(a.length, b.length)];
  }

  private formatMissingError(
    name: string,
    suggestions: string[],
    position?: { file: string; line: number; column: number }
  ): string {
    let msg = `Media file not found: "${name}"`;
    if (position) {
      msg += ` at ${position.file}:${position.line}:${position.column}`;
    }
    if (suggestions.length > 0) {
      msg += `. Did you mean: ${suggestions.join(", ")}?`;
    }
    return msg;
  }

  async listMedia(): Promise<ResolvedMedia[]> {
    const results: ResolvedMedia[] = [];
    for (const [, filePath] of this.fileIndex) {
      const type = getMediaType(filePath);
      if (type === "unknown") continue;

      try {
        await stat(filePath);
        const metadata = await inspectMedia(filePath, { cache: this.cache, sourceDir: this.sourceDir });
        results.push({
          path: filePath,
          name: basename(filePath),
          type,
          metadata,
        });
      } catch (error) {
        recordDegradation({
          code: "CC2004",
          what: "media file omitted from listing",
          reason: error instanceof Error ? error.message : String(error),
          input: filePath,
          instead: "the file is skipped in `media:list` until it becomes readable",
        });
      }
    }
    return results;
  }

  getCloudMedia(): readonly { url: string; name?: string; sha256?: string }[] {
    return this.cloudMedia;
  }
}

export function createMediaResolver(options: ResolverOptions): MediaCatalog {
  return new MediaCatalog(options);
}

export function isVideoExtension(ext: string): boolean {
  return isSupportedVideoExtension(ext);
}

export function isImageExtension(ext: string): boolean {
  return isSupportedImageExtension(ext);
}

export function isAudioExtension(ext: string): boolean {
  return isSupportedAudioExtension(ext);
}