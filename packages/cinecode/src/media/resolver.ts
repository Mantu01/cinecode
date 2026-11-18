import { stat, readdir } from "node:fs/promises";
import { join, resolve, relative, basename } from "node:path";
import type { MediaMetadata, MediaCache } from "./cache.js";
import { inspectMedia, getMediaType, isSupportedVideoExtension, isSupportedImageExtension, isSupportedAudioExtension } from "./inspector.js";
import { resolveMediaSource } from "../extensions/index.js";
import { getMediaResolverChain } from "./resolverChain.js";
import { recordDegradation } from "../errors/degradations.js";
import { MediaIndex } from "./media-index.js";
import { isCinecodeError } from "../errors/index.js";
import type { MainManifest, Composition } from "../core/types/index.js";

export interface ResolverOptions {
  sourceDir: string;
  mediaDir?: string;
  projectRoot?: string;
  allowCoLocatedMedia?: boolean;
  cache: MediaCache;
  cloudMedia?: readonly { url: string; name?: string; sha256?: string }[];
  ignore?: (relativePath: string) => boolean;
  manifest?: MainManifest | null;
  compositions?: readonly Composition[];
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
  readonly index: MediaIndex;
  private readonly sourceDir: string;
  private readonly cache: MediaCache;
  private readonly cloudMedia: readonly { url: string; name?: string; sha256?: string }[];

  constructor(options: ResolverOptions) {
    this.sourceDir = resolve(options.sourceDir);
    this.cache = options.cache;
    this.cloudMedia = options.cloudMedia ?? [];
    this.index = new MediaIndex({
      mediaDir: options.mediaDir ?? options.sourceDir,
      sourceDir: options.sourceDir,
      projectRoot: options.projectRoot ?? options.sourceDir,
      allowCoLocatedMedia: options.allowCoLocatedMedia,
      cache: options.cache,
      cloudMedia: options.cloudMedia,
      ignore: options.ignore,
      manifest: options.manifest,
      compositions: options.compositions,
    });
  }

  async initialize(): Promise<void> {
    await this.index.initialize();
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

    // Registered media sources get first refusal before the local lookup fails
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

    try {
      return await this.index.resolveMedia(name);
    } catch (error) {
      if (isCinecodeError(error)) throw error;
      throw new MediaResolutionErrorImpl("CC2001", `Media file not found: "${name}"`, undefined, resolve(this.sourceDir, name));
    }
  }

  async listMedia(): Promise<ResolvedMedia[]> {
    const results: ResolvedMedia[] = [];
    for (const entry of this.index.list()) {
      if (!entry.exists) continue;
      const type = getMediaType(entry.absolutePath);
      if (type === "unknown") continue;

      try {
        const metadata = await inspectMedia(entry.absolutePath, { cache: this.cache, sourceDir: this.sourceDir });
        results.push({
          path: entry.absolutePath,
          name: entry.name,
          type,
          metadata,
        });
      } catch (error) {
        recordDegradation({
          code: "CC2004",
          what: "media file omitted from listing",
          reason: error instanceof Error ? error.message : String(error),
          input: entry.absolutePath,
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