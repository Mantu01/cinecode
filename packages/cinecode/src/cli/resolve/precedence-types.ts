import type {
  CinecodeConfig,
  HardwareAcceleration,
  QualitySetting,
  RenderFormat,
  VideoCodec,
} from "../../core/types/index.js";
import type { FullPlatformPreset } from "../../encoder/platform-presets.js";
import type { GifDitherMode } from "../../core/output-plan.js";
import type { AudioMuxCodec } from "../../audio/muxer.js";
import type { InstrumentationCounters } from "../../media/instrumentation.js";
import type { ResourcePlan } from "../../pipeline/resource-planner.js";

import type { ColorManagementInput } from "../shared/color-management.js";
export { normalizeColorManagement } from "../shared/color-management.js";
export type { ColorManagementInput };

export type ParameterOrigin = "flag" | "selection" | "preset" | "config" | "default";

export interface ResolvedField<T> {
  readonly value: T;
  readonly origin: ParameterOrigin;
  readonly source: string;
  readonly originLabel: string;
}

export interface ResolvedFrameWindow {
  readonly from: number;
  readonly to: number;
  readonly totalFrames: number;
}

export interface ResolvedRenderParameters {
  readonly width: ResolvedField<number>;
  readonly height: ResolvedField<number>;
  readonly fps: ResolvedField<number>;
  readonly format: ResolvedField<RenderFormat>;
  readonly codec: ResolvedField<VideoCodec>;
  readonly quality: ResolvedField<QualitySetting>;
  readonly crf: ResolvedField<number>;
  readonly bitrate: ResolvedField<string | undefined>;
  readonly concurrency: ResolvedField<number | "auto">;
  readonly chunkSize: ResolvedField<number>;
  readonly hardwareAcceleration: ResolvedField<HardwareAcceleration>;
  readonly memoryBudgetMb: ResolvedField<number | undefined>;
  readonly alpha: ResolvedField<boolean>;
  readonly colorManagement: ResolvedField<ColorManagementInput>;
  readonly twoPass: ResolvedField<boolean>;
  readonly outputPath: ResolvedField<string>;
  readonly frameWindow: ResolvedField<ResolvedFrameWindow>;
  readonly overwrite: ResolvedField<boolean>;
  readonly audioCodec: ResolvedField<AudioMuxCodec | undefined>;
  readonly audioBitrate: ResolvedField<number | undefined>;
  readonly gifQuality: ResolvedField<number | undefined>;
  readonly gifDither: ResolvedField<GifDitherMode | undefined>;
  readonly gifMaxFrames: ResolvedField<number | undefined>;
  readonly seed: ResolvedField<number | undefined>;
  readonly effects: ResolvedField<readonly string[] | undefined>;
  readonly noEffects: ResolvedField<boolean>;
  readonly strictFonts: ResolvedField<boolean>;
  readonly frameErrorPolicy: ResolvedField<"placeholder" | "repeat-previous" | "abort">;
}

export interface ExplainReport {
  readonly root: string;
  readonly configPath: string;
  readonly manifestPath: string;
  readonly mode: string;
  readonly selection: string;
  readonly frameWindow: ResolvedFrameWindow;
  readonly parameters: ResolvedRenderParameters;
  readonly instrumentation?: InstrumentationCounters;
  readonly resourcePlan?: ResourcePlan;
}

export interface PrecedenceFlags {
  readonly width?: number;
  readonly height?: number;
  readonly resolution?: string;
  readonly fps?: number;
  readonly format?: RenderFormat;
  readonly codec?: VideoCodec;
  readonly quality?: QualitySetting;
  readonly crf?: number;
  readonly bitrate?: string;
  readonly concurrency?: number | "auto";
  readonly chunkSize?: number;
  readonly hardwareAcceleration?: HardwareAcceleration;
  readonly memoryBudget?: string | number;
  readonly alpha?: boolean;
  readonly colorManagement?: ColorManagementInput;
  readonly twoPass?: boolean;
  readonly out?: string;
  readonly from?: string | number;
  readonly to?: string | number;
  readonly range?: string;
  readonly preset?: string;
  readonly preview?: boolean;
  readonly overwrite?: boolean;
  readonly audioCodec?: AudioMuxCodec;
  readonly audioBitrate?: number;
  readonly gifQuality?: number;
  readonly gifDither?: GifDitherMode;
  readonly gifMaxFrames?: number;
  readonly seed?: number;
  readonly effects?: string | readonly string[];
  readonly noEffects?: boolean;
  readonly strictFonts?: boolean;
  readonly strict?: boolean;
  readonly frameErrorPolicy?: "placeholder" | "repeat-previous" | "abort";
}

export interface PrecedenceSelection {
  readonly id?: string;
  readonly name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly duration?: number | string;
  readonly format?: RenderFormat;
  readonly codec?: VideoCodec;
  readonly quality?: QualitySetting;
}

export interface PrecedenceOptions {
  readonly flags?: PrecedenceFlags;
  readonly selection?: PrecedenceSelection;
  readonly project?: {
    readonly root: string;
    readonly configPath?: string;
    readonly manifestPath?: string;
    readonly mode?: string;
    readonly selection?: string;
    readonly config: CinecodeConfig;
    readonly roots?: import("./project-context.js").ProjectRoots;
  };
  /** Key paths the author wrote; only an explicit key outranks a selection. */
  readonly explicit?: ReadonlySet<string>;
  readonly kind?: "video" | "still";
}
