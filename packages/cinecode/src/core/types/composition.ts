import type { Timeline } from "./tracks.js";
import type { Paint } from "./visual.js";
import type { AudioConfig } from "./config.js";

import type { SplitRegion } from "../../renderer/pip.js";
import type { TempoRegion } from "../time/tempoMap.js";

export interface CompositionProps {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly background?: ColorSpec;
  readonly duration?: number | string;
  readonly tempo?: readonly TempoRegion[];
  readonly audio?: AudioConfig;
  readonly rootTimeline: Timeline;
  readonly splitScreen?: SplitScreenConfig;
  readonly skybox?: SkyboxConfig;
  readonly chapters?: readonly ChapterMarker[];
  readonly postProcessing?: PostProcessingConfig;
  /** Set to false to render without burning subtitle tracks into frames. */
  readonly burnSubtitles?: boolean;
  /** How clips that extend past the composition duration are handled. */
  readonly boundaryBehavior?: "clamp" | "extend" | "strict";
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
  readonly tempo?: readonly TempoRegion[];
  readonly audio: AudioConfig;
  readonly rootTimeline: Timeline;
  readonly splitScreen?: SplitScreenConfig;
  readonly skybox?: SkyboxConfig;
  readonly chapters?: readonly ChapterMarker[];
  readonly postProcessing?: PostProcessingConfig;
  readonly burnSubtitles?: boolean;
  readonly boundaryBehavior?: "clamp" | "extend" | "strict";
}
