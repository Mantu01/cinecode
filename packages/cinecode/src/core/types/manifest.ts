import type { RenderFormat, VideoCodec, QualitySetting } from "./config.js";

/** Shared fields for every registrable asset in `main.ts`. */
export interface ManifestEntryBase {
  /** Stable identifier referenced by timelines and the `generate` CLI. */
  readonly id: string;
  /** Human readable label shown in the interactive CLI. */
  readonly name?: string;
  /** File that exports the asset (scene/audio/image/timeline builder). */
  readonly file?: string;
}

/** A standalone still image registered in `main.ts`. */
export interface ImageEntry extends ManifestEntryBase {
  readonly width?: number;
  readonly height?: number;
  readonly format?: "png" | "jpg" | "webp";
  /** 0-100 for jpg/webp. */
  readonly quality?: number;
  /** Retina multiplier (e.g. 2 for 2x stills). */
  readonly scaleFactor?: number;
  readonly background?: string;
  readonly seed?: number;
}

/** A procedural or file-backed audio asset registered in `main.ts`. */
export interface AudioEntry extends ManifestEntryBase {
  readonly src?: string;
  readonly sampleRate?: number;
  readonly channels?: 1 | 2;
  readonly gain?: number;
  readonly duration?: number | string;
}

/** A reusable visual scene registered in `main.ts`. */
export interface SceneEntry extends ManifestEntryBase {
  readonly duration?: number | string;
  /** Accept a declared duration shorter than the content and report dropped frames. */
  readonly truncate?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly background?: string;
}

/** A multi-scene timeline registered in `main.ts`. */
export interface TimelineEntry extends ManifestEntryBase {
  readonly duration?: number | string;
  /** Accept a declared duration shorter than the content and report dropped frames. */
  readonly truncate?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly background?: string;
  readonly format?: RenderFormat;
  readonly codec?: VideoCodec;
  readonly quality?: QualitySetting;
  readonly sceneRefs?: readonly string[];
  readonly audioRef?: readonly string[];
}

/** Extensibility contract reserved for future character rigs. */
export interface CharacterEntry extends ManifestEntryBase {
  readonly props?: Record<string, unknown>;
}

/** Extensibility contract reserved for future motion presets. */
export interface MotionEntry extends ManifestEntryBase {
  readonly props?: Record<string, unknown>;
}

/**
 * The root manifest authored in `main.ts`. Every entry references an isolated
 * file so it can be generated, previewed and cached independently.
 */
export interface MainManifest {
  readonly images?: readonly ImageEntry[];
  readonly audio?: readonly AudioEntry[];
  readonly scenes?: readonly SceneEntry[];
  readonly timelines?: readonly TimelineEntry[];
  /** Reserved for future-proofing. */
  readonly characters?: readonly CharacterEntry[];
  /** Reserved for future-proofing. */
  readonly motions?: readonly MotionEntry[];
}

export type ManifestKind = "image" | "audio" | "scene" | "timeline" | "character" | "motion";

export interface ResolvedEntry<T> {
  readonly entry: T;
  readonly filePath: string | null;
}

export function collectEntries(
  manifest: MainManifest,
  kind: ManifestKind,
): readonly ManifestEntryBase[] {
  switch (kind) {
    case "image":
      return manifest.images ?? [];
    case "audio":
      return manifest.audio ?? [];
    case "scene":
      return manifest.scenes ?? [];
    case "timeline":
      return manifest.timelines ?? [];
    case "character":
    case "motion":
      return [];
  }
}
