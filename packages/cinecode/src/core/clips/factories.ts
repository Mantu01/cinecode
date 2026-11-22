import type {
  AudioClip,
  ComponentClip,
  GroupClip,
  ImageClip,
  Model3dClip,
  SceneClip,
  ShapeClip,
  ShapeType,
  SolidClip,
  SoundClip,
  SvgClip,
  ParticleClip,
  NoiseClip,
  AudioVisualizerClip,
  ChromaKeyClip,
  TextClip,
  VideoClip,
  Clip,
  VideoEditOptions,
} from "../types/clips.js";
import type { AudioLikeProps, MediaProps, TimeRange, TransitionRef, VisualProps, EffectRef, MaskProps, MatteProps } from "../types/clips.js";
import type { ColorValue, FitMode, Point, Shadow, Stroke, Transform, BlendMode } from "../types/visual.js";
import type { KeyframeProp, KeyframeMap } from "../types/clips.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { BUILTIN_TRANSITION_NAMES } from "../../transitions/index.js";

const COMMON_VISUAL_KEYS: readonly string[] = [
  "start",
  "end",
  "duration",
  "name",
  "transform",
  "opacity",
  "blend",
  "mask",
  "matte",
  "effects",
  "transitionIn",
  "transitionOut",
  "keyframes",
  "zIndex",
  "x",
  "y",
  "scale",
  "rotation",
  "scaleX",
  "scaleY",
];

const VIDEO_KEYS: readonly string[] = [
  ...COMMON_VISUAL_KEYS,
  "fit",
  "crop",
  "roundedCorners",
  "width",
  "height",
  "preprocess",
  "from",
  "to",
  "speed",
  "reverse",
  "loop",
  "volume",
  "color",
];

const IMAGE_KEYS: readonly string[] = [
  ...COMMON_VISUAL_KEYS,
  "fit",
  "crop",
  "flipped",
  "roundedCorners",
  "width",
  "height",
  "color",
];

const TEXT_KEYS: readonly string[] = [
  ...COMMON_VISUAL_KEYS,
  "fontFamily",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "align",
  "maxWidth",
  "autoFit",
  "fill",
  "stroke",
  "shadow",
  "characterAccess",
  "wordAccess",
  "lineAccess",
  "color",
  "width",
  "height",
];

const SHAPE_KEYS: readonly string[] = [
  ...COMMON_VISUAL_KEYS,
  "width",
  "height",
  "radius",
  "points",
  "path",
  "fill",
  "stroke",
  "shadow",
  "closed",
  "color",
];

const SOLID_KEYS: readonly string[] = [...COMMON_VISUAL_KEYS, "width", "height"];

const GROUP_KEYS: readonly string[] = [...COMMON_VISUAL_KEYS, "children"];

const SCENE_KEYS: readonly string[] = [...COMMON_VISUAL_KEYS, "width", "height", "timeline"];

const COMPONENT_KEYS: readonly string[] = [...COMMON_VISUAL_KEYS];

const AUDIO_KEYS: readonly string[] = [
  "start",
  "end",
  "duration",
  "name",
  "volume",
  "gain",
  "pan",
  "fadeIn",
  "fadeOut",
  "loop",
  "muted",
  "speed",
  "extra",
];

const SOUND_KEYS: readonly string[] = [
  "start",
  "end",
  "duration",
  "name",
  "volume",
  "gain",
  "pan",
  "fadeIn",
  "fadeOut",
  "loop",
  "muted",
  "speed",
  "params",
];

const MODEL3D_KEYS: readonly string[] = [...COMMON_VISUAL_KEYS, "width", "height", "camera", "lighting"];

const SVG_KEYS: readonly string[] = [...COMMON_VISUAL_KEYS, "src", "content", "width", "height", "fit", "color"];

const PARTICLE_KEYS: readonly string[] = [...COMMON_VISUAL_KEYS, "params"];

const NOISE_KEYS: readonly string[] = [...COMMON_VISUAL_KEYS, "params"];

const VISUALIZER_KEYS: readonly string[] = [
  ...COMMON_VISUAL_KEYS,
  "track",
  "audioSrc",
  "layout",
  "bars",
  "gap",
  "smoothing",
  "mirror",
  "minDb",
  "maxDb",
  "color",
  "gradient",
];

const CHROMA_KEYS: readonly string[] = [...COMMON_VISUAL_KEYS, "color", "similarity", "smoothness", "spill"];

function validateTransition(trans: TransitionRef): void {
  if (typeof trans === "object" && trans && trans.name) {
    if (!BUILTIN_TRANSITION_NAMES.includes(trans.name)) {
      throw createError(ErrorCode.CC3007, {
        kind: "transition",
        id: trans.name,
        available: BUILTIN_TRANSITION_NAMES.join(", "),
      });
    }
  }
}

function validateClipOptions(options: Record<string, unknown>, validKeys: readonly string[], clipType: string): void {
  for (const key of Object.keys(options)) {
    if (!validKeys.includes(key)) {
      throw createError(ErrorCode.CC1014, {
        kind: `${clipType} option`,
        name: key,
        available: validKeys.join(", "),
      });
    }
  }
  if ("transitionIn" in options && options.transitionIn) {
    validateTransition(options.transitionIn as TransitionRef);
  }
  if ("transitionOut" in options && options.transitionOut) {
    validateTransition(options.transitionOut as TransitionRef);
  }
  if ("start" in options && options.start !== undefined) {
    if (typeof options.start === "number" && (options.start < 0 || !Number.isFinite(options.start))) {
      throw createError(ErrorCode.CC1012, { reason: `start must be non-negative, got ${options.start}` });
    }
  }
  if ("duration" in options && options.duration !== undefined) {
    if (typeof options.duration === "number" && (options.duration <= 0 || !Number.isFinite(options.duration))) {
      throw createError(ErrorCode.CC1012, { reason: `duration must be positive, got ${options.duration}` });
    }
  }
}

type WithVisual = VisualProps & {
  readonly transform?: Transform;
  readonly opacity?: number;
  readonly blend?: BlendMode;
  readonly mask?: MaskProps;
  readonly matte?: MatteProps;
  readonly effects?: readonly EffectRef[];
  readonly transitionIn?: TransitionRef;
  readonly transitionOut?: TransitionRef;
  readonly keyframes?: readonly KeyframeProp[] | KeyframeMap;
  readonly name?: string;
};

export interface VideoOptions extends WithVisual, MediaProps {
  readonly fit?: FitMode;
  readonly crop?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly roundedCorners?: number;
  readonly width?: number;
  readonly height?: number;
  readonly preprocess?: VideoEditOptions;
}

export interface ImageOptions extends WithVisual {
  readonly fit?: FitMode;
  readonly crop?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly flipped?: boolean;
  readonly roundedCorners?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface TextOptions extends WithVisual {
  readonly fontFamily?: string;
  readonly fontWeight?: number | string;
  readonly fontStyle?: string;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly align?: "left" | "center" | "right";
  readonly maxWidth?: number;
  readonly autoFit?: boolean;
  readonly fill?: ColorValue;
  readonly stroke?: Stroke;
  readonly shadow?: Shadow;
  readonly characterAccess?: boolean;
  readonly wordAccess?: boolean;
  readonly lineAccess?: boolean;
}

export interface ShapeOptions extends WithVisual {
  readonly width?: number;
  readonly height?: number;
  readonly radius?: number;
  readonly points?: readonly Point[];
  readonly path?: ShapeClip["path"];
  readonly fill?: ColorValue;
  readonly stroke?: Stroke;
  readonly shadow?: Shadow;
  readonly closed?: boolean;
}

export interface SolidOptions extends WithVisual {
  readonly width?: number;
  readonly height?: number;
}

export interface GroupOptions extends WithVisual {
  readonly children?: readonly Clip[];
}

export interface AudioOptions extends TimeRange, AudioLikeProps {
  readonly name?: string;
  readonly extra?: Record<string, unknown>;
}

export interface SoundOptions extends TimeRange, AudioLikeProps {
  readonly name?: string;
  readonly params?: Record<string, unknown>;
}

export interface Model3dOptions extends VisualProps {
  readonly width?: number;
  readonly height?: number;
  readonly camera?: {
    readonly orbit?: boolean;
    readonly radius?: number;
    readonly speed?: number;
  };
  readonly lighting?: {
    readonly ambient?: { color?: string; intensity?: number };
    readonly directional?: { color?: string; intensity?: number; direction?: [number, number, number] };
  };
}

export function video(src: string, options: VideoOptions = {}): VideoClip {
  validateClipOptions(options as Record<string, unknown>, VIDEO_KEYS, "video");
  return { type: "video", src, ...options };
}

export function image(src: string, options: ImageOptions = {}): ImageClip {
  validateClipOptions(options as Record<string, unknown>, IMAGE_KEYS, "image");
  return { type: "image", src, ...options };
}

export function text(content: string, fontSize: number, options: TextOptions = {}): TextClip {
  validateClipOptions(options as Record<string, unknown>, TEXT_KEYS, "text");
  return { type: "text", content, fontSize, ...options };
}

export function shape(shapeType: ShapeType, options: ShapeOptions = {}): ShapeClip {
  validateClipOptions(options as Record<string, unknown>, SHAPE_KEYS, "shape");
  return { type: "shape", shapeType, ...options };
}

export function solid(color: ColorValue, options: SolidOptions = {}): SolidClip {
  validateClipOptions(options as Record<string, unknown>, SOLID_KEYS, "solid");
  return { type: "solid", color, ...options };
}

export function group(children: readonly Clip[], options: GroupOptions = {}): GroupClip {
  validateClipOptions(options as Record<string, unknown>, GROUP_KEYS, "group");
  return { type: "group", children, ...options };
}

export function scene(ref: string, props?: Record<string, unknown>, options: Omit<VisualProps, "name"> = {}): SceneClip {
  validateClipOptions(options as Record<string, unknown>, SCENE_KEYS, "scene");
  return { type: "scene", ref, props, ...options };
}

export function component(ref: string, props?: Record<string, unknown>, options: Omit<VisualProps, "name"> = {}): ComponentClip {
  validateClipOptions(options as Record<string, unknown>, COMPONENT_KEYS, "component");
  return { type: "component", ref, props, ...options };
}

export function audio(src: string, options: AudioOptions = {}): AudioClip {
  validateClipOptions(options as Record<string, unknown>, AUDIO_KEYS, "audio");
  return { type: "audio", src, ...options };
}

export function sound(ref: string, options: SoundOptions = {}): SoundClip {
  validateClipOptions(options as Record<string, unknown>, SOUND_KEYS, "sound");
  return { type: "sound", ref, ...options };
}

export function model3d(src: string, options: Model3dOptions = {}): Model3dClip {
  validateClipOptions(options as Record<string, unknown>, MODEL3D_KEYS, "model3d");
  return { type: "model3d", src, ...options };
}

export function svgClip(props: Partial<SvgClip> & { src?: string; content?: string } = {}): SvgClip {
  validateClipOptions(props as Record<string, unknown>, SVG_KEYS, "svg");
  return { type: "svg", ...props };
}

export function particleClip(params: ParticleClip["params"], overrides: Partial<ParticleClip> = {}): ParticleClip {
  validateClipOptions(overrides as Record<string, unknown>, PARTICLE_KEYS, "particle");
  return { type: "particle", params, ...overrides };
}

export function noiseClip(params: NoiseClip["params"], overrides: Partial<NoiseClip> = {}): NoiseClip {
  validateClipOptions(overrides as Record<string, unknown>, NOISE_KEYS, "noise");
  return { type: "noise", params, ...overrides };
}

export function audioVisualizerClip(props: Omit<AudioVisualizerClip, "type">): AudioVisualizerClip {
  validateClipOptions(props as Record<string, unknown>, VISUALIZER_KEYS, "audioVisualizer");
  return { type: "audioVisualizer", ...props };
}

export function chromaKeyClip(src: string, props: Omit<ChromaKeyClip, "type" | "src"> = {}): ChromaKeyClip {
  validateClipOptions(props as Record<string, unknown>, CHROMA_KEYS, "chromakey");
  return { type: "chromakey", src, ...props };
}

export function media(name: string): string {
  return name;
}
