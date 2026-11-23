// Size exception (>400 lines): one schema table keeps config, CLI and docs in sync.
import { z } from "zod";
import { MANIFEST_SCHEMA_VERSION } from "../contracts.js";
import { ALL_AUDIO_CODECS, ALL_VIDEO_CODECS, GIF_DITHER_MODES, OUTPUT_FORMATS } from "../core/output-plan.js";
import { parseMemoryBudgetMb } from "./defaults.js";
import { PLATFORM_PRESET_IDS } from "../encoder/platform-presets.js";
import { idRule } from "../manifest/ids.js";

export const RESOLUTION_DIMENSIONS = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
  "4k": { width: 3840, height: 2160 },
  "vertical-1080": { width: 1080, height: 1920 },
  "square-1080": { width: 1080, height: 1080 },
} as const;
export const RESOLUTION_PRESETS = Object.keys(RESOLUTION_DIMENSIONS) as Array<keyof typeof RESOLUTION_DIMENSIONS>;
export const SCHEMA_VERSION: 2 = MANIFEST_SCHEMA_VERSION;
export const SCHEMA_VERSIONS = [1, SCHEMA_VERSION] as const;
export const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "21:9"] as const;
export const VIDEO_CODECS = ALL_VIDEO_CODECS;
export const RENDER_FORMATS = OUTPUT_FORMATS;
export const QUALITY_SETTINGS = ["draft", "preview", "medium", "final", "lossless", "low", "high"] as const;
export const ENCODER_PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"] as const;
export const HARDWARE_ACCELERATION = ["auto", "nvenc", "videotoolbox", "qsv", "off"] as const;
export const COLOR_SPACES = ["srgb", "linear"] as const;
/** Derived from the one preset table: config, CLI and docs share these ids. */
export const PLATFORM_PRESETS = PLATFORM_PRESET_IDS;
export const AUDIO_CHANNELS = [1, 2, 6] as const;
export const SAMPLE_RATES = [22050, 44100, 48000, 96000] as const;
export const IMAGE_FORMATS = ["png", "jpg", "webp"] as const;

export const SchemaVersionSchema = z.union([z.literal(1), z.literal(SCHEMA_VERSION)]);
export const ResolutionSchema = z.string().regex(
  new RegExp(`^(\\d+x\\d+|${RESOLUTION_PRESETS.join("|")})$`),
  "Resolution must be WIDTHxHEIGHT or one of: " + RESOLUTION_PRESETS.join(", "),
);
export const AspectRatioSchema = z.enum(ASPECT_RATIOS);
export const HexColorSchema = z.string().regex(/^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/, "Must be a hex color such as #ffffff");
export const VideoCodecSchema = z.enum(VIDEO_CODECS);
export const RenderFormatSchema = z.enum(RENDER_FORMATS);
export const QualitySettingSchema = z.enum(QUALITY_SETTINGS);
export const EncoderPresetSchema = z.enum(ENCODER_PRESETS);
export const HardwareAccelerationSchema = z.enum(HARDWARE_ACCELERATION);
export const PlatformPresetSchema = z.enum(PLATFORM_PRESETS as [string, ...string[]]);
export const AudioChannelsSchema = z.union([z.literal(1), z.literal(2), z.literal(6)]);
export const SampleRateSchema = z.union([z.literal(22050), z.literal(44100), z.literal(48000), z.literal(96000)]);
export const ImageFormatSchema = z.enum(IMAGE_FORMATS);
export const ConcurrencySchema = z.union([z.number().int().positive(), z.literal("auto")]);

export const ProjectInputSchema = z.object({
  entry: z.string().min(1).optional(),
  sourceDir: z.string().min(1).optional(),
  mediaDir: z.string().min(1).optional(),
  outputDir: z.string().min(1).optional(),
  cacheDir: z.string().min(1).optional(),
}).strict();

export const VideoInputSchema = z.object({
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().positive().max(120).optional(),
  defaultDuration: z.union([z.number().positive(), z.string()]).optional(),
  background: HexColorSchema.optional(),
}).strict();

export const ImageInputSchema = z.object({
  defaultFormat: ImageFormatSchema.optional(),
  quality: z.number().int().min(1).max(100).optional(),
  scaleFactor: z.number().positive().optional(),
}).strict();

export const DevInputSchema = z.object({
  port: z.number().int().min(1).max(65535).optional(),
  host: z.string().optional(),
  open: z.boolean().optional(),
  hmr: z.boolean().optional(),
}).strict();

export const ResolutionVariantInputSchema = z.object({
  label: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  scaleFactor: z.number().positive().optional(),
  crf: z.number().int().min(0).max(63).optional(),
  codec: VideoCodecSchema.optional(),
}).strict();

export const ColorManagementInputSchema = z.object({
  workingColorSpace: z.enum(["srgb", "linear-srgb", "rec709", "acescg"]).optional(),
  outputColorSpace: z.enum(["srgb", "rec709", "display-p3", "rec2020"]).optional(),
  enabled: z.boolean().optional(),
}).strict();

export const AudioCodecSchema = z.enum(ALL_AUDIO_CODECS as unknown as [string, ...string[]]);
export const GifDitherModeSchema = z.enum(GIF_DITHER_MODES as unknown as [string, ...string[]]);

export const MemoryBudgetSchema = z.union([
  z.number().min(16),
  z.string().min(1).refine(
    (val) => {
      try {
        return parseMemoryBudgetMb(val) >= 16;
      } catch {
        return false;
      }
    },
    { message: "Memory budget must be >= 16MB, e.g. 1024, '1GB', '512MB'" },
  ),
]);

export const RenderInputSchema = z.object({
  fps: z.number().positive().max(120).optional(),
  resolution: ResolutionSchema.optional(),
  format: RenderFormatSchema.optional(),
  quality: QualitySettingSchema.optional(),
  codec: VideoCodecSchema.optional(),
  crf: z.number().int().min(0).max(63).optional(),
  preset: EncoderPresetSchema.optional(),
  hardwareAcceleration: HardwareAccelerationSchema.optional(),
  concurrency: ConcurrencySchema.optional(),
  chunkSize: z.number().int().min(1).max(10000).optional(),
  memoryBudget: MemoryBudgetSchema.optional(),
  memoryBudgetMb: z.number().int().min(16).optional(),
  overwrite: z.boolean().optional(),
  alpha: z.boolean().optional(),
  twoPass: z.boolean().optional(),
  platformPreset: PlatformPresetSchema.optional(),
  bitrate: z.number().int().positive().optional(),
  colorManagement: ColorManagementInputSchema.optional(),
  audioCodec: AudioCodecSchema.optional(),
  audioBitrate: z.number().int().min(8).max(1024).optional(),
  gifQuality: z.number().int().min(1).max(8).optional(),
  gifDither: GifDitherModeSchema.optional(),
  gifMaxFrames: z.number().int().positive().optional(),
  seed: z.number().int().min(0).optional(),
  effects: z.array(z.string().min(1)).optional(),
  noEffects: z.boolean().optional(),
  strictFonts: z.boolean().optional(),
  frameErrorPolicy: z.enum(["placeholder", "repeat-previous", "abort"]).optional(),
}).strict();

export const AudioInputSchema = z.object({
  sampleRate: SampleRateSchema.optional(),
  channels: AudioChannelsSchema.optional(),
  masterVolume: z.number().min(0).max(1).optional(),
}).strict();

export const FontEntrySchema = z.object({
  family: z.string().min(1),
  src: z.string().min(1),
  weight: z.union([z.number(), z.string()]).optional(),
  style: z.string().optional(),
}).strict();

export const CloudMediaEntrySchema = z.object({
  url: z.string(),
  name: z.string().optional(),
  sha256: z.string().optional(),
}).strict();

export const PluginEntrySchema = z.object({
  source: z.string().min(1),
  options: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
}).strict();

export const BinaryConfigSchema = z.object({
  ffmpegPath: z.string().min(1).optional(),
  ffprobePath: z.string().min(1).optional(),
}).strict();

export const CinecodeConfigInputSchema = z.object({
  $schema: z.string().optional(),
  extends: z.string().optional(),
  schemaVersion: SchemaVersionSchema.optional(),
  project: ProjectInputSchema.optional(),
  video: VideoInputSchema.optional(),
  images: ImageInputSchema.optional(),
  dev: DevInputSchema.optional(),
  binaries: BinaryConfigSchema.optional(),
  allowCoLocatedMedia: z.boolean().optional(),
  cloudMedia: z.array(CloudMediaEntrySchema).optional(),
  render: RenderInputSchema.optional(),
  audio: AudioInputSchema.optional(),
  fonts: z.array(FontEntrySchema).optional(),
  concurrency: ConcurrencySchema.optional(),
  overwrite: z.boolean().optional(),
  gitignore: z.boolean().optional(),
  plugins: z.array(z.union([z.string().min(1), PluginEntrySchema])).optional(),
  pluginPrecedence: z.array(z.string()).optional(),
  autoDiscoverPlugins: z.boolean().optional(),
  ignorePatterns: z.array(z.string()).optional(),
}).strict();

export const ProjectConfigSchema = z.object({
  entry: z.string().min(1),
  sourceDir: z.string().min(1),
  mediaDir: z.string().min(1),
  outputDir: z.string().min(1),
  cacheDir: z.string().min(1),
}).strict();

export const VideoConfigSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive().max(120),
  defaultDuration: z.union([z.number(), z.string()]).optional(),
  background: z.string().min(1),
}).strict();

export const ImageConfigSchema = z.object({
  defaultFormat: ImageFormatSchema,
  quality: z.number().int().min(1).max(100).optional(),
  scaleFactor: z.number().positive().optional(),
}).strict();

export const DevConfigSchema = z.object({
  port: z.number().int().min(1).max(65535),
  host: z.string().optional(),
  open: z.boolean().optional(),
  hmr: z.boolean(),
}).strict();

export const RenderConfigSchema = RenderInputSchema.extend({
  fps: z.number().positive().max(120),
  resolution: ResolutionSchema,
  format: RenderFormatSchema,
  quality: QualitySettingSchema,
  codec: VideoCodecSchema,
  preset: EncoderPresetSchema,
  hardwareAcceleration: HardwareAccelerationSchema,
});

export const AudioConfigSchema = AudioInputSchema;

export const PluginConfigEntrySchema = PluginEntrySchema;

export const NormalizedConfigSchema = CinecodeConfigInputSchema.extend({
  schemaVersion: SchemaVersionSchema,
  project: ProjectConfigSchema,
  video: VideoConfigSchema,
  images: ImageConfigSchema,
  dev: DevConfigSchema,
  sourceDir: z.string().min(1),
  mediaDir: z.string().min(1),
  outputDir: z.string().min(1),
  cacheDir: z.string().min(1),
  allowCoLocatedMedia: z.boolean().optional(),
  cloudMedia: z.array(CloudMediaEntrySchema),
  render: RenderConfigSchema,
  audio: AudioConfigSchema,
  fonts: z.array(FontEntrySchema),
  concurrency: ConcurrencySchema,
  overwrite: z.boolean(),
  gitignore: z.boolean(),
  plugins: z.array(PluginEntrySchema),
  pluginPrecedence: z.array(z.string()),
  autoDiscoverPlugins: z.boolean(),
  ignorePatterns: z.array(z.string()),
}).strict();

export const NormalizedCinecodeConfigSchema = NormalizedConfigSchema;
export const CinecodeConfigSchema = CinecodeConfigInputSchema;

export type InferredCinecodeConfig = z.infer<typeof CinecodeConfigInputSchema>;
export type InferredVideoConfig = z.infer<typeof VideoInputSchema>;
export type InferredRenderConfig = z.infer<typeof RenderInputSchema>;

export interface ZodValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly code: string;
  readonly expected?: string;
  readonly received?: unknown;
  readonly keys?: readonly string[];
}

export interface ZodValidationResult {
  valid: boolean;
  errors: ZodValidationIssue[];
}

function expectedOf(issue: z.core.$ZodIssue): string | undefined {
  if (issue.code === "invalid_type") return String(issue.expected);
  if (issue.code === "invalid_value") return issue.values.map((value) => JSON.stringify(value)).join(" | ");
  if (issue.code === "too_small") return `${issue.origin} >= ${String(issue.minimum)}`;
  if (issue.code === "too_big") return `${issue.origin} <= ${String(issue.maximum)}`;
  if (issue.code === "unrecognized_keys") return "a known config key";
  if (issue.code === "invalid_format") return issue.format;
  return undefined;
}

function receivedOf(issue: z.core.$ZodIssue): unknown {
  if (issue.code === "invalid_type" || issue.code === "invalid_value" || issue.code === "too_small" || issue.code === "too_big" || issue.code === "invalid_format") {
    return issue.input;
  }
  return undefined;
}

function flattenUnionIssues(issues: readonly z.core.$ZodIssue[], prefix: PropertyKey[] = []): z.core.$ZodIssue[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    const nested = (issue as { errors?: z.core.$ZodIssue[][] }).errors;
    return issue.code === "invalid_union" && nested ? flattenUnionIssues(nested.flat(), path) : [{ ...issue, path }];
  });
}

function toValidationResult(result: z.ZodSafeParseResult<unknown>): ZodValidationResult {
  if (result.success) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: flattenUnionIssues(result.error.issues).map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
      expected: expectedOf(issue),
      received: receivedOf(issue),
      keys: issue.code === "unrecognized_keys" ? issue.keys : undefined,
    })),
  };
}

export function validateConfigWithZod(config: unknown): ZodValidationResult {
  return toValidationResult(CinecodeConfigInputSchema.safeParse(config));
}

export function validateNormalizedConfigWithZod(config: unknown): ZodValidationResult {
  return toValidationResult(NormalizedConfigSchema.safeParse(config));
}

export const ManifestDurationSchema = z.union([z.number().finite().positive(), z.string().min(1)]);
export const ManifestDimensionSchema = z.number().int().min(2).max(16384);
export const ManifestFpsSchema = z.number().positive().max(120);

const ManifestEntryBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  file: z.string().min(1).optional(),
}).strict();

export const ManifestImageEntrySchema = ManifestEntryBaseSchema.extend({
  width: ManifestDimensionSchema.optional(),
  height: ManifestDimensionSchema.optional(),
  format: ImageFormatSchema.optional(),
  quality: z.number().int().min(1).max(100).optional(),
  scaleFactor: z.number().positive().optional(),
  background: HexColorSchema.optional(),
  seed: z.number().optional(),
})
  .strict()
  .superRefine((entry, ctx) => {
    if (!entry.file) {
      ctx.addIssue({
        code: "custom",
        path: ["file"],
        message: `image "${entry.id}" declares no source; accepted source: "file"`,
      });
    }
  });

export const ManifestAudioEntrySchema = ManifestEntryBaseSchema.extend({
  src: z.string().min(1).optional(),
  sampleRate: z.number().int().positive().optional(),
  channels: AudioChannelsSchema.optional(),
  /** Linear gain: 0 silent, 1 unity, up to 4 (+12 dB). */
  gain: z.number().finite().min(0).max(4).optional(),
  duration: ManifestDurationSchema.optional(),
})
  .strict()
  .superRefine((entry, ctx) => {
    const sources = [entry.file, entry.src].filter((value) => value !== undefined).length;
    if (sources === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["file"],
        message: `audio "${entry.id}" declares no source; accepted sources: "file" or "src"`,
      });
    } else if (sources === 2) {
      ctx.addIssue({
        code: "custom",
        path: ["file"],
        message: `audio "${entry.id}" declares both "file" and "src"; keep exactly one source`,
      });
    }
  });

const ManifestVisualEntrySchema = ManifestEntryBaseSchema.extend({
  duration: ManifestDurationSchema.optional(),
  /** Accept a declared duration shorter than the content and report the dropped frames. */
  truncate: z.boolean().optional(),
  width: ManifestDimensionSchema.optional(),
  height: ManifestDimensionSchema.optional(),
  fps: ManifestFpsSchema.optional(),
  background: HexColorSchema.optional(),
}).strict();

export const ManifestSceneEntrySchema = ManifestVisualEntrySchema.strict().superRefine((entry, ctx) => {
  if (!entry.file) {
    ctx.addIssue({
      code: "custom",
      path: ["file"],
      message: `scene "${entry.id}" declares no source; accepted source: "file"`,
    });
  }
});

export const ManifestTimelineEntrySchema = ManifestVisualEntrySchema.extend({
  format: RenderFormatSchema.optional(),
  codec: VideoCodecSchema.optional(),
  quality: QualitySettingSchema.optional(),
  sceneRefs: z.array(z.string().min(1)).optional(),
  audioRef: z.array(z.string().min(1)).optional(),
})
  .strict()
  .superRefine((entry, ctx) => {
    const hasFile = entry.file !== undefined;
    const hasRefs = (entry.sceneRefs?.length ?? 0) > 0;
    if (hasFile && hasRefs) {
      ctx.addIssue({
        code: "custom",
        path: ["sceneRefs"],
        message: `timeline "${entry.id}" declares both "file" and "sceneRefs"; remove either "file" or "sceneRefs"`,
      });
    } else if (!hasFile && !hasRefs) {
      ctx.addIssue({
        code: "custom",
        path: ["file"],
        message: `timeline "${entry.id}" declares no source; accepted sources: "file" or "sceneRefs"`,
      });
    }
  });

export const ManifestReservedEntrySchema = ManifestEntryBaseSchema.extend({
  props: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const ManifestSchema = z
  .object({
    kind: z.literal("main").optional(),
    images: z.array(ManifestImageEntrySchema).optional(),
    audio: z.array(ManifestAudioEntrySchema).optional(),
    scenes: z.array(ManifestSceneEntrySchema).optional(),
    timelines: z.array(ManifestTimelineEntrySchema).optional(),
    characters: z.array(ManifestReservedEntrySchema).optional(),
    motions: z.array(ManifestReservedEntrySchema).optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (Array.isArray(manifest.characters) && manifest.characters.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["characters"],
        message: 'collection "characters" is reserved and not supported in this release; remove "characters" from the manifest',
      });
    }
    if (Array.isArray(manifest.motions) && manifest.motions.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["motions"],
        message: 'collection "motions" is reserved and not supported in this release; remove "motions" from the manifest',
      });
    }
    const seen = new Map<string, { collection: string; index: number; id: string }>();
    for (const collection of ["images", "audio", "scenes", "timelines"] as const) {
      (manifest[collection] ?? []).forEach((entry, index) => {
        const rule = idRule(entry.id);
        if (rule) {
          ctx.addIssue({
            code: "custom",
            path: [collection, index, "id"],
            message: `${collection} "${entry.id}" is not a filesystem-safe id: ${rule}`,
          });
        }
        const key = entry.id.toLowerCase();
        if (seen.has(key)) {
          const prev = seen.get(key)!;
          ctx.addIssue({
            code: "custom",
            path: [collection, index, "id"],
            message: `duplicate id "${entry.id}" declared in ${prev.collection}[${prev.index}] and ${collection}[${index}] (ids are compared case-insensitively)`,
          });
        } else {
          seen.set(key, { collection, index, id: entry.id });
        }
      });
    }
  });

/** Raster-only image output: a vector request names the command that produces vectors. */
function vectorImageIssues(manifest: unknown): ZodValidationIssue[] {
  const images = (manifest as { images?: unknown } | null)?.images;
  if (!Array.isArray(images)) return [];
  return images.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as { id?: unknown; format?: unknown };
    if (value.format !== "svg") return [];
    return [{
      path: `images.${index}.format`,
      code: "custom",
      message: `image "${String(value.id)}" requests vector format "svg"; image output is raster only. Use \`cinecode export-svg\` to write vector frames.`,
    }];
  });
}

export function validateManifestShape(manifest: unknown): ZodValidationResult {
  const result = toValidationResult(ManifestSchema.safeParse(manifest));
  const vector = vectorImageIssues(manifest);
  if (vector.length === 0) return result;
  const claimed = new Set(vector.map((issue) => issue.path));
  return { valid: false, errors: [...result.errors.filter((issue) => !claimed.has(issue.path)), ...vector] };
}
