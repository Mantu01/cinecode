import type { Canvas } from "@napi-rs/canvas";
import type { Composition, VisualClip } from "../core/types/index.js";
import type { Rgba, Gradient } from "./color/types.js";
import type { FrameConversion } from "../core/time/index.js";
import type { RenderRuntime } from "./runtime.js";
import type { RenderSession } from "./session.js";

export interface RenderContext {
  readonly composition: Composition;
  readonly conversion: FrameConversion;
  readonly frame: number;
  readonly time: number;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly background: string | Rgba | Gradient;
  readonly runtime?: RenderRuntime;
  readonly session: RenderSession;
}

export interface RenderResult {
  readonly canvas: Canvas;
  readonly frame: number;
  readonly time: number;
}

export interface RenderFrameOptions {
  readonly resolutionScale?: number;
  readonly runtime?: RenderRuntime;
  readonly session?: RenderSession;
}

export interface VideoFrameRef {
  readonly src: string;
  readonly sourceFrame: number;
}

export interface ClipVisualInput {
  readonly clipCanvas: Canvas;
  readonly clip: VisualClip;
  readonly context: RenderContext;
  readonly underlying: Canvas | null;
}

export interface CompositionIndex {
  readonly totalFrames: number;
  readonly activeByFrame: Map<number, VisualClip[]>;
  readonly trackByClip: Map<VisualClip, number>;
}

export const EMPTY_CLIPS: VisualClip[] = [];

export const UNBOUNDED_CLIP_TYPES = new Set([
  "particle",
  "noise",
  "audioVisualizer",
  "model3d",
  "multiCamera",
  "meshwarp",
  "text3d",
  "dataViz",
  "gradient-mesh",
  "sticker",
  "svg",
  "group",
  "scene",
]);

export const REJECTED_CLIP_TYPES = ["component"] as const;

export const SUPPORTED_VISUAL_CLIP_TYPES = [
  "solid",
  "shape",
  "text",
  "image",
  "video",
  "group",
  "scene",
  "model3d",
  "multiCamera",
  "svg",
  "particle",
  "noise",
  "audioVisualizer",
  "chromakey",
  "subtitle",
  "dataViz",
  "sticker",
  "gradient-mesh",
  "meshwarp",
  "text3d",
] as const;
