import { z } from "zod";

export const ResolutionStringSchema = z
  .string()
  .regex(/^\d+x\d+$/, "Resolution must be in 'WIDTHxHEIGHT' format (e.g. '1920x1080')");

export const AspectRatioSchema = z
  .string()
  .regex(/^\d+:\d+$/, "Aspect ratio must be in 'W:H' format (e.g. '16:9')");

export const HexColorSchema = z
  .string()
  .regex(/^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/, "Must be a valid hex color string (e.g. '#ffffff')");

export const VideoCodecSchema = z.enum([
  "h264",
  "hevc",
  "prores",
  "vp9",
  "av1",
  "vvc",
  "ffv1",
  "utvideo",
]);

export const RenderFormatSchema = z.enum([
  "mp4",
  "webm",
  "mov",
  "gif",
  "png",
  "jpg",
  "webp",
  "avif",
  "mkv",
  "avi",
]);

export const QualityPresetSchema = z.enum(["draft", "preview", "final", "maximum"]);

export const ProjectConfigSchema = z.object({
  name: z.string().min(1, "Project name cannot be empty"),
  entry: z.string().optional(),
  sourceDir: z.string().optional(),
  outputDir: z.string().optional(),
  cacheDir: z.string().optional(),
});

export const VideoConfigSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  version: z.string().optional(),
  tags: z.array(z.string()).optional(),
  license: z.string().optional(),
  width: z.number().int().positive("Width must be a positive integer"),
  height: z.number().int().positive("Height must be a positive integer"),
  aspectRatio: AspectRatioSchema.optional(),
  fps: z.number().positive("FPS must be greater than 0"),
  defaultDuration: z.union([z.number().positive(), z.string()]).optional(),
  background: z.union([HexColorSchema, z.string()]).optional(),
  colorSpace: z.enum(["srgb", "display-p3", "rec2020"]).optional(),
  pixelAspectRatio: z.number().positive().optional(),
});

export const RenderConfigSchema = z.object({
  fps: z.number().positive().optional(),
  resolution: z.union([ResolutionStringSchema, z.object({ width: z.number().positive(), height: z.number().positive() })]).optional(),
  format: RenderFormatSchema.optional(),
  background: z.string().optional(),
  quality: QualityPresetSchema.optional(),
  codec: VideoCodecSchema.optional(),
  crf: z.number().min(0).max(63).optional(),
  preset: z.string().optional(),
  hardwareAcceleration: z.enum(["auto", "off", "nvenc", "qsv", "videotoolbox", "vaapi"]).optional(),
  concurrency: z.number().int().positive().optional(),
  chunkSize: z.number().int().positive().optional(),
});

export const ImageConfigSchema = z.object({
  defaultFormat: z.enum(["png", "jpg", "jpeg", "webp", "avif"]).optional(),
  quality: z.number().min(1).max(100).optional(),
  scaleFactor: z.number().positive().optional(),
});

export const DevConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).optional(),
  host: z.string().optional(),
  open: z.boolean().optional(),
  hmr: z.boolean().optional(),
  metricsPort: z.number().int().min(0).max(65535).optional(),
});

export const AudioConfigSchema = z.object({
  volume: z.number().min(0).max(2).optional(),
  sampleRate: z.number().int().positive().optional(),
  channels: z.union([z.literal(1), z.literal(2), z.literal(6)]).optional(),
  muted: z.boolean().optional(),
  normalize: z.boolean().optional(),
  targetLufs: z.number().optional(),
});

export const EffectConfigSchema = z.object({
  name: z.string(),
  enabled: z.boolean().optional(),
  from: z.union([z.number(), z.string()]).optional(),
  to: z.union([z.number(), z.string()]).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const ClipConfigSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  start: z.union([z.number(), z.string()]).optional(),
  duration: z.union([z.number(), z.string()]).optional(),
  effects: z.array(EffectConfigSchema).optional(),
});

export const TrackConfigSchema = z.object({
  name: z.string().optional(),
  kind: z.enum(["visual", "audio", "subtitle"]).optional(),
  muted: z.boolean().optional(),
  opacity: z.number().min(0).max(1).optional(),
  blend: z.string().optional(),
  clips: z.array(ClipConfigSchema).optional(),
});

export const CinecodeConfigSchema = z.object({
  schemaVersion: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  project: ProjectConfigSchema.optional(),
  video: VideoConfigSchema.optional(),
  images: ImageConfigSchema.optional(),
  dev: DevConfigSchema.optional(),
  render: RenderConfigSchema.optional(),
  audio: AudioConfigSchema.optional(),
  sourceDir: z.string().optional(),
  outputDir: z.string().optional(),
  cacheDir: z.string().optional(),
  concurrency: z.number().int().positive().optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).optional(),
  overwrite: z.boolean().optional(),
  gitignore: z.boolean().optional(),
  plugins: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).optional(),
  pluginPrecedence: z.record(z.string(), z.number()).optional(),
  pluginPermissions: z.record(z.string(), z.array(z.string())).optional(),
  security: z.record(z.string(), z.unknown()).optional(),
  telemetry: z.record(z.string(), z.unknown()).optional(),
});

export type InferredCinecodeConfig = z.infer<typeof CinecodeConfigSchema>;
export type InferredVideoConfig = z.infer<typeof VideoConfigSchema>;
export type InferredRenderConfig = z.infer<typeof RenderConfigSchema>;

export interface ZodValidationResult {
  valid: boolean;
  errors: Array<{
    path: string;
    message: string;
    code: string;
  }>;
}

export function validateConfigWithZod(config: unknown): ZodValidationResult {
  const result = CinecodeConfigSchema.safeParse(config);
  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));

  return { valid: false, errors };
}
