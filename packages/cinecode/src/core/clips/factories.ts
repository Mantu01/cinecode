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
  return { type: "video", src, ...options };
}

export function image(src: string, options: ImageOptions = {}): ImageClip {
  return { type: "image", src, ...options };
}

export function text(content: string, fontSize: number, options: TextOptions = {}): TextClip {
  return { type: "text", content, fontSize, ...options };
}

export function shape(shapeType: ShapeType, options: ShapeOptions = {}): ShapeClip {
  return { type: "shape", shapeType, ...options };
}

export function solid(color: ColorValue, options: SolidOptions = {}): SolidClip {
  return { type: "solid", color, ...options };
}

export function group(children: readonly Clip[], options: GroupOptions = {}): GroupClip {
  return { type: "group", children, ...options };
}

export function scene(ref: string, props?: Record<string, unknown>, options: Omit<VisualProps, "name"> = {}): SceneClip {
  return { type: "scene", ref, props, ...options };
}

export function component(ref: string, props?: Record<string, unknown>, options: Omit<VisualProps, "name"> = {}): ComponentClip {
  return { type: "component", ref, props, ...options };
}

export function audio(src: string, options: AudioOptions = {}): AudioClip {
  return { type: "audio", src, ...options };
}

export function sound(ref: string, options: SoundOptions = {}): SoundClip {
  return { type: "sound", ref, ...options };
}

export function model3d(src: string, options: Model3dOptions = {}): Model3dClip {
  return { type: "model3d", src, ...options };
}

export function svgClip(props: Partial<SvgClip> & { src?: string; content?: string } = {}): SvgClip {
  return { type: "svg", ...props };
}

export function particleClip(params: ParticleClip["params"], overrides: Partial<ParticleClip> = {}): ParticleClip {
  return { type: "particle", params, ...overrides };
}

export function noiseClip(params: NoiseClip["params"], overrides: Partial<NoiseClip> = {}): NoiseClip {
  return { type: "noise", params, ...overrides };
}

export function audioVisualizerClip(props: Omit<AudioVisualizerClip, "type">): AudioVisualizerClip {
  return { type: "audioVisualizer", ...props };
}

export function chromaKeyClip(src: string, props: Omit<ChromaKeyClip, "type" | "src"> = {}): ChromaKeyClip {
  return { type: "chromakey", src, ...props };
}

export function media(name: string): string {
  return name;
}
