import type { Timeline } from "./tracks.js";
import type { Paint } from "./visual.js";
import type { AudioConfig } from "./config.js";
import type { SidechainConfig } from "../../audio/mixer.js";

import type { SplitRegion } from "../../renderer/pip.js";
import type { TempoRegion } from "../time/tempoMap.js";

export interface CompositionAudio extends AudioConfig {
  readonly sidechains?: readonly SidechainConfig[];
}

/** One manifest audio bed as the mixer placed it. */
export interface AudioPlacement {
  readonly id: string;
  readonly start: number;
  readonly duration: number;
  readonly gain: number;
}

export interface CompositionProps {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly background?: ColorSpec;
  readonly duration?: number | string;
  /** Resolved end of the content, independent of the declared duration. */
  readonly contentDuration?: number;
  readonly tempo?: readonly TempoRegion[];
  readonly audio?: CompositionAudio;
  /** Every manifest audio bed placed by the assembler. */
  readonly audioPlacements?: readonly AudioPlacement[];
  readonly rootTimeline: Timeline;
  readonly splitScreen?: SplitScreenConfig;
  readonly skybox?: SkyboxConfig;
  readonly chapters?: readonly ChapterMarker[];
  readonly postProcessing?: PostProcessingConfig;
  /** Set to false to render without burning subtitle tracks into frames. */
  readonly burnSubtitles?: boolean;
  /** How clips that extend past the composition duration are handled. */
  readonly boundaryBehavior?: "clamp" | "extend" | "strict";
  readonly previewScale?: number;
  readonly scenes?: Readonly<Record<string, Timeline>>;
}

export interface SkyboxConfig {
  readonly type: "cube" | "equirectangular" | "procedural";
  readonly faces?: readonly string[];
  readonly src?: string;
  readonly exposure?: number;
  readonly yaw?: number;
  readonly pitch?: number;
}

export interface ChapterMarker {
  readonly time: number;
  readonly title: string;
}

export interface PostProcessingConfig {
  readonly effects?: readonly PostProcessEffectConfig[];
  readonly previewMode?: boolean;
  readonly resolutionScale?: number;
}

export interface PostProcessEffectConfig {
  readonly name: string;
  readonly params?: Record<string, unknown>;
  readonly enabled?: boolean;
  readonly priority?: number;
}

export interface SplitScreenConfig {
  readonly layout: "side-by-side" | "pip" | "grid-2x2" | "grid-3x3" | "thirds-vertical" | "thirds-horizontal" | "custom";
  readonly regions?: readonly SplitRegion[];
  readonly padding?: number;
}

export type ColorSpec = string | Paint;

export type ResolvedBackground = {
  readonly type: "solid";
  readonly color: string;
};

export interface Composition {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly background: ColorSpec;
  readonly duration?: number | string;
  /** Resolved end of the content, independent of the declared duration. */
  readonly contentDuration?: number;
  readonly tempo?: readonly TempoRegion[];
  readonly audio: CompositionAudio;
  readonly audioPlacements?: readonly AudioPlacement[];
  readonly rootTimeline: Timeline;
  readonly splitScreen?: SplitScreenConfig;
  readonly skybox?: SkyboxConfig;
  readonly chapters?: readonly ChapterMarker[];
  readonly postProcessing?: PostProcessingConfig;
  readonly burnSubtitles?: boolean;
  readonly boundaryBehavior?: "clamp" | "extend" | "strict";
  readonly previewScale?: number;
  readonly scenes?: Readonly<Record<string, Timeline>>;
}
