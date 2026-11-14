export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "21:9";

export type ColorSpace = "srgb" | "rec709" | "display-p3";

export type AlphaRenderFormat = "webm-alpha" | "prores-alpha";

export type RenderFormat =
  | "mp4"
  | "webm"
  | "prores"
  | "mkv"
  | "avi"
  | "gif"
  | "apng"
  | "png"
  | "jpg"
  | "webp"
  | "avif"
  | "pdf"
  | AlphaRenderFormat;

export type PlatformPresetName =
  | "youtube-1080p"
  | "youtube-4k"
  | "tiktok"
  | "instagram-reels"
  | "instagram-post"
  | "twitter"
  | "custom";

export interface ResolutionVariant {
  readonly label: string;
  readonly width?: number;
  readonly height?: number;
  readonly scaleFactor?: number;
  readonly crf?: number;
  readonly codec?: VideoCodec;
}

export type VideoCodec = "h264" | "h265" | "av1" | "prores" | "vp9" | "ffv1" | "utvideo";

/** Modern quality profiles. */
export type QualityPreset = "draft" | "preview" | "medium" | "final" | "lossless";

/** Legacy quality names kept for backwards compatibility. */
export type LegacyQuality = "low" | "medium" | "high";

export type QualitySetting = QualityPreset | LegacyQuality;

export type EncoderPreset =
  | "ultrafast"
  | "superfast"
  | "veryfast"
  | "faster"
  | "fast"
  | "medium"
  | "slow"
  | "slower"
  | "veryslow";

export type HardwareAcceleration = "auto" | "nvenc" | "videotoolbox" | "qsv" | "off";

export interface ProjectConfig {
  /** Project name (also used as the default output stem). */
  readonly name: string;
  /** Root manifest entry. Default: "./main.ts" (falls back to the config file). */
  readonly entry: string;
  /** Directory that holds authored sources. Default: "./src". */
  readonly sourceDir: string;
  /** Directory that receives rendered artifacts. Default: "./output". */
  readonly outputDir: string;
  /** Directory that holds render caches. Default: ".cinecode/cache". */
  readonly cacheDir: string;
}

export interface VideoConfig {
  readonly title: string;
  readonly description?: string;
  readonly author?: string;
  readonly version?: string;
  readonly tags?: readonly string[];
  readonly license?: string;
  readonly width: number;
  readonly height: number;
  readonly aspectRatio?: AspectRatio;
  readonly fps: number;
  readonly defaultDuration?: number | string;
  readonly background: string;
  readonly colorSpace?: ColorSpace;
  readonly pixelAspectRatio?: number;
}

export interface RenderConfig {
  readonly fps?: number;
  readonly resolution?: string;
  readonly format?: RenderFormat;
  readonly background?: string;
  readonly quality?: QualitySetting;
  readonly codec?: VideoCodec;
  readonly crf?: number;
  readonly preset?: EncoderPreset;
  readonly hardwareAcceleration?: HardwareAcceleration;
  readonly concurrency?: number | "auto";
  readonly chunkSize?: number;
  readonly alpha?: boolean;
  readonly twoPass?: boolean;
  readonly platformPreset?: PlatformPresetName;
  readonly enforceAspectRatio?: boolean;
  readonly variants?: readonly ResolutionVariant[];
  readonly colorManagement?: {
    readonly workingColorSpace?: "srgb" | "linear-srgb" | "rec709" | "acescg";
    readonly outputColorSpace?: "srgb" | "rec709" | "display-p3" | "rec2020";
    readonly enabled?: boolean;
  };
}

export interface ImageConfig {
  readonly defaultFormat: "png" | "jpg" | "webp" | "svg";
  readonly quality?: number;
  readonly scaleFactor?: number;
}

export interface DevConfig {
  readonly port: number;
  readonly host?: string;
  readonly open?: boolean;
  readonly hmr: boolean;
  /** Maximum undo/redo snapshots kept by the canvas interaction layer. Default: 50. */
  readonly historyDepth?: number;
}

export interface AudioConfig {
  readonly sampleRate?: number;
  readonly channels?: 1 | 2;
  readonly masterVolume?: number;
  readonly normalize?: boolean;
  readonly limiter?: {
    readonly enabled: boolean;
    readonly thresholdDb: number;
  };
  readonly sidechains?: readonly {
    readonly targetTrackName: string;
    readonly sidechainTrackName: string;
    readonly threshold?: number;
    readonly ratio?: number;
    readonly attackMs?: number;
    readonly releaseMs?: number;
  }[];
}

export interface FontEntry {
  readonly family: string;
  readonly src: string;
  readonly weight?: number | string;
  readonly style?: string;
}

export interface CloudMediaEntry {
  readonly url: string;
  readonly name?: string;
  readonly sha256?: string;
}

/**
 * The global Cinecode configuration.
 *
 * Schema v2 introduces the structured `project` / `video` / `images` / `dev`
 * blocks. The flattened legacy fields (`sourceDir`, `render`, `audio`, …) remain
 * supported: `normalizeConfig` always populates both views so existing commands
 * and projects keep working unchanged.
 */
export interface CinecodeConfig {
  readonly schemaVersion: number;

  // --- Schema v2 structured blocks ---
  readonly project?: ProjectConfig;
  readonly video?: VideoConfig;
  readonly images?: ImageConfig;
  readonly dev?: DevConfig;

  // --- Flattened / backwards-compatible view (populated by normalizeConfig) ---
  readonly name?: string;
  readonly sourceDir: string;
  readonly outputDir?: string;
  readonly cacheDir?: string;
  readonly cloudMedia?: readonly CloudMediaEntry[];
  readonly render?: RenderConfig;
  readonly audio?: AudioConfig;
  readonly fonts?: readonly FontEntry[];
  readonly concurrency?: number | "auto";
  readonly logLevel?: "silent" | "error" | "warn" | "info" | "debug";
  readonly overwrite?: boolean;
  readonly gitignore?: boolean;
  readonly plugins?: readonly PluginConfigEntry[];
  readonly pluginPrecedence?: readonly string[];
  readonly pluginPermissions?: Readonly<Record<string, readonly string[]>>;
  readonly security?: {
    readonly pluginVerification?: "strict" | "warn" | "off";
    readonly trustedKeys?: readonly string[];
  };
  readonly telemetry?: {
    readonly enabled?: boolean;
    readonly endpoint?: string;
  };
  /** Scan node_modules for marked Cinecode plugin packages. Default: true. */
  readonly autoDiscoverPlugins?: boolean;
  /** Inline glob patterns merged with .cinecodeignore for sync and media scanning. */
  readonly ignorePatterns?: readonly string[];
}

export interface PluginConfigEntry {
  readonly source: string;
  readonly options?: Readonly<Record<string, unknown>>;
  readonly enabled?: boolean;
}
