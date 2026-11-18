import type { z } from "zod";
import type {
  AspectRatioSchema,
  AudioConfigSchema,
  AudioChannelsSchema,
  CloudMediaEntrySchema,
  DevConfigSchema,
  EncoderPresetSchema,
  FontEntrySchema,
  HardwareAccelerationSchema,
  ImageConfigSchema,
  ImageFormatSchema,
  NormalizedCinecodeConfigSchema,
  PlatformPresetSchema,
  PluginConfigEntrySchema,
  ProjectConfigSchema,
  QualitySettingSchema,
  RenderConfigSchema,
  ResolutionVariantInputSchema,
  VideoCodecSchema,
  VideoConfigSchema,
} from "../../config/zod-schema.js";
import type { RenderFormat } from "../output-plan.js";

export type { RenderFormat };
export type AspectRatio = z.infer<typeof AspectRatioSchema>;
export type AlphaRenderFormat = Extract<RenderFormat, "webm-alpha" | "prores-alpha">;
export type PlatformPresetName = z.infer<typeof PlatformPresetSchema>;
export type ResolutionVariant = z.infer<typeof ResolutionVariantInputSchema>;
export type VideoCodec = z.infer<typeof VideoCodecSchema>;
export type QualitySetting = z.infer<typeof QualitySettingSchema>;
export type QualityPreset = Exclude<QualitySetting, "low" | "high">;
export type LegacyQuality = Extract<QualitySetting, "low" | "high">;
export type EncoderPreset = z.infer<typeof EncoderPresetSchema>;
export type HardwareAcceleration = z.infer<typeof HardwareAccelerationSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type VideoConfig = z.infer<typeof VideoConfigSchema>;
export type RenderConfig = z.infer<typeof RenderConfigSchema>;
export type ImageConfig = z.infer<typeof ImageConfigSchema>;
export type DevConfig = z.infer<typeof DevConfigSchema>;
export type AudioConfig = z.infer<typeof AudioConfigSchema>;
export type AudioChannels = z.infer<typeof AudioChannelsSchema>;
export type FontEntry = z.infer<typeof FontEntrySchema>;
export type CloudMediaEntry = z.infer<typeof CloudMediaEntrySchema>;
export type PluginConfigEntry = z.infer<typeof PluginConfigEntrySchema>;
export type ImageFormat = z.infer<typeof ImageFormatSchema>;
export type CinecodeConfig = z.infer<typeof NormalizedCinecodeConfigSchema>;
