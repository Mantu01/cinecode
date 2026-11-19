import type { Canvas } from "@napi-rs/canvas";
import type { Composition, RenderFormat } from "../core/types/index.js";
import type { EffectProcessor } from "../effects/engine.js";
import type { TransitionProcessor } from "../transitions/engine.js";

export type PluginKind =
  | "effect"
  | "transition"
  | "audioProcessor"
  | "mediaSource"
  | "renderer"
  | "command"
  | "encoder"
  | "decoder"
  | "imageProcessor";

export type HookName =
  | "beforeRender"
  | "afterRender"
  | "beforeFrame"
  | "afterFrame"
  | "beforeEncode"
  | "afterEncode"
  | "beforeMix"
  | "afterMix"
  | "onProgress"
  | "onWarning"
  | "onResolutionChange"
  | "onError";

export const HOOK_NAMES: readonly HookName[] = [
  "beforeRender",
  "afterRender",
  "beforeFrame",
  "afterFrame",
  "beforeEncode",
  "afterEncode",
  "beforeMix",
  "afterMix",
  "onProgress",
  "onWarning",
  "onResolutionChange",
  "onError",
];

export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly kind: PluginKind;
  readonly description?: string;
  readonly author?: string;
  readonly main?: string;
  readonly apiVersion?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly permissions?: readonly string[];
  readonly deprecated?: boolean | string;
  readonly deprecatedSince?: string;
  readonly replacement?: string;
  readonly minEngineVersion?: string;
  readonly maxEngineVersion?: string;
}

export interface BeforeRenderHookData {
  readonly composition: Composition;
  readonly totalFrames: number;
}

export interface AfterRenderHookData {
  readonly composition: Composition;
  readonly outputPath: string;
  readonly totalFrames: number;
  readonly durationMs: number;
}

export interface BeforeFrameHookData {
  readonly composition: Composition;
  readonly frame: number;
  readonly frameNumber?: number;
  readonly totalFrames?: number;
  readonly timestamp?: number;
  readonly canvas?: Canvas;
}

export type AfterFrameHookData = BeforeFrameHookData;

export interface BeforeEncodeHookData {
  readonly composition: Composition;
  readonly outputPath: string;
  readonly format: RenderFormat;
  readonly totalFrames: number;
  readonly encoderArgs: string[];
}

export interface AfterEncodeHookData {
  readonly composition: Composition;
  readonly outputPath: string;
  readonly durationMs: number;
  readonly fileSize: number;
}

export interface BeforeMixHookData {
  readonly composition: Composition;
  readonly trackCount: number;
  readonly sampleRate: number;
  readonly durationSeconds: number;
}

export interface AfterMixHookData extends BeforeMixHookData {
  readonly durationMs: number;
  readonly peakLevel: number;
  readonly peakAfterLimit?: number;
  readonly silent?: boolean;
  readonly channelConversions?: readonly {
    readonly id: string;
    readonly from: number;
    readonly to: number;
    readonly kind: "upmix" | "downmix";
  }[];
}

export interface ProgressHookData {
  readonly currentFrame: number;
  readonly totalFrames: number;
  readonly elapsedMs: number;
  readonly etaMs?: number;
}

export interface WarningHookData {
  readonly message: string;
  readonly stage: string;
  readonly frame?: number;
}

export interface ResolutionChangeHookData {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
}

export interface OnErrorHookData {
  readonly error: Error;
  readonly context: string;
  readonly frame?: number;
}

export type HookDataMap = {
  beforeRender: BeforeRenderHookData;
  afterRender: AfterRenderHookData;
  beforeFrame: BeforeFrameHookData;
  afterFrame: AfterFrameHookData;
  beforeEncode: BeforeEncodeHookData;
  afterEncode: AfterEncodeHookData;
  beforeMix: BeforeMixHookData;
  afterMix: AfterMixHookData;
  onProgress: ProgressHookData;
  onWarning: WarningHookData;
  onResolutionChange: ResolutionChangeHookData;
  onError: OnErrorHookData;
};

export type HookHandler<K extends HookName> = (data: HookDataMap[K]) => void | Promise<void>;

export type PluginHooks = {
  readonly [K in HookName]?: HookHandler<K> | readonly HookHandler<K>[];
};

export interface PluginContext {
  readonly options: Readonly<Record<string, unknown>>;
  readonly log: (message: string) => void;
  readonly registerEffect?: (effect: EffectProcessor) => void;
  readonly registerTransition?: (transition: TransitionProcessor) => void;
}

export interface CinecodePlugin {
  readonly manifest: PluginManifest;
  readonly hooks?: PluginHooks;
  readonly effects?: readonly EffectProcessor[];
  readonly transitions?: readonly TransitionProcessor[];
  readonly init?: (context: PluginContext) => void | Promise<void>;
  readonly setup?: (context: PluginContext) => void | Promise<void>;
  readonly teardown?: (context: PluginContext) => void | Promise<void>;
}

export type PluginState = "registered" | "initializing" | "active" | "failed" | "disposed";

export interface RegisteredPlugin {
  readonly plugin: CinecodePlugin;
  readonly options: Readonly<Record<string, unknown>>;
  readonly source?: string;
  state: PluginState;
  readonly errors: readonly Error[];
}

export interface PluginConflict {
  readonly feature: string;
  readonly winningPlugin: string;
  readonly losingPlugin: string;
  readonly reason: string;
}

export interface HookRunResult<K extends HookName> {
  readonly hook: K;
  readonly executed: number;
  readonly failures: readonly { readonly plugin: string; readonly error: Error }[];
}
