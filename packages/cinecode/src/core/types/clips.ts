// Size exception (>400 lines): canonical clip and layer types table per quality-standards §2.
import type { Camera } from "../../renderer/camera/rig.js";
import type { ParticlePhysicsConfig } from "../../particles/types.js";
import type { MaterialSlotOverride } from "../../model-3d/materials/types.js";
import type { AudioBuffer } from "../../audio/types.js";
import type { AnimatableValue } from "./animatable.js";
import type { EasingDescriptor } from "./easing.js";
import type { Timeline } from "./tracks.js";
import type {
  Anchor,
  BlendMode,
  ColorValue,
  FitMode,
  Point,
  Shadow,
  Size,
  Stroke,
  Transform,
} from "./visual.js";

export interface TimeRange {
  readonly start?: number | string;
  readonly end?: number | string;
  readonly duration?: number | string;
}

export interface VisualProps {
  readonly start?: number | string;
  readonly end?: number | string;
  readonly duration?: number | string;
  readonly transform?: Transform;
  readonly opacity?: number;
  readonly blend?: BlendMode;
  readonly mask?: MaskProps;
  readonly matte?: MatteProps;
  readonly effects?: readonly EffectRef[];
  readonly dropShadow?: Shadow;
  readonly transitionIn?: TransitionRef;
  readonly transitionOut?: TransitionRef;
  readonly keyframes?: readonly KeyframeProp[] | KeyframeMap;
  readonly name?: string;
}

export type KeyframeMap = Readonly<Record<string, readonly (readonly [time: number, value: unknown, easing?: unknown])[]>>;

export type KeyframeProp = readonly [property: string, frames: readonly KeyframeTuple[]];

export type KeyframeTuple =
  | readonly [time: number, value: AnimatableValue]
  | readonly [time: number, value: AnimatableValue, easing: EasingDescriptor];

export interface MaskProps {
  readonly kind: "shape" | "path";
  readonly shape: MaskShape;
  readonly invert?: boolean;
}

export type MaskShape =
  | {
      readonly kind: "rectangle";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: "ellipse";
      readonly cx: number;
      readonly cy: number;
      readonly radiusX: number;
      readonly radiusY: number;
    }
  | { readonly kind: "path"; readonly segments: readonly PathSegment[] };

export interface MatteProps {
  readonly kind: "alpha" | "luminance";
  readonly source: string;
}

export interface PathSegment {
  readonly command: "move" | "line" | "cubic" | "quad" | "arc" | "close";
  readonly points: readonly Point[];
}

export interface EffectRef {
  readonly name: string;
  readonly enabled?: boolean;
  readonly from?: number | string;
  readonly to?: number | string;
  readonly params?: Record<string, AnimatableValue>;
  readonly keyframes?: readonly KeyframeProp[];
}

export interface TransitionRef {
  readonly name: string;
  readonly duration?: number | string;
  readonly params?: Record<string, AnimatableValue>;
}

export type Clip =
  | VideoClip
  | ImageClip
  | TextClip
  | ShapeClip
  | SolidClip
  | GroupClip
  | SceneClip
  | ComponentClip
  | AudioClip
  | SoundClip
  | TtsClip
  | Model3dClip
  | SvgClip
  | ParticleClip
  | NoiseClip
  | AudioVisualizerClip
  | ChromaKeyClip
  | SubtitleClip
  | DataVizClip
  | StickerClip
  | GradientMeshClip
  | MeshWarpClip
  | Text3dClip
  | MultiCameraClip;

export type VisualClip = Exclude<Clip, AudioClip | SoundClip | TtsClip>;

export interface MediaProps {
  readonly trimStart?: number | string;
  readonly trimEnd?: number | string;
  readonly speed?: number;
  readonly reverse?: boolean;
  readonly volume?: number;
  readonly muted?: boolean;
}

export interface AudioLikeProps {
  readonly trimStart?: number | string;
  readonly trimEnd?: number | string;
  readonly speed?: number;
  readonly reverse?: boolean;
  readonly loop?: boolean;
  readonly volume?: number;
  readonly fadeIn?: number | string;
  readonly fadeOut?: number | string;
  readonly pan?: number;
  readonly muted?: boolean;
  readonly position3d?: SpatialAudioPosition;
  readonly sidechainFrom?: string;
}

export interface SpatialAudioPosition {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly maxDistance?: number;
  readonly rolloffFactor?: number;
  readonly velocity?: { readonly x?: number; readonly y?: number; readonly z?: number };
}

export interface VideoClip extends VisualProps, MediaProps {
  readonly type: "video";
  readonly src: string;
  readonly fit?: FitMode;
  readonly crop?: CropProps;
  readonly roundedCorners?: number;
  readonly width?: number;
  readonly height?: number;
  readonly preprocess?: VideoEditOptions;
}

export interface VideoEditOptions {
  readonly trimStart?: number;
  readonly trimEnd?: number;
  readonly speed?: number;
  readonly crop?: CropProps;
  readonly mirror?: "horizontal" | "vertical";
  readonly fadeDuration?: number;
}

export interface ImageClip extends VisualProps {
  readonly type: "image";
  readonly src: string;
  readonly fit?: FitMode;
  readonly crop?: CropProps;
  readonly flipped?: boolean;
  readonly roundedCorners?: number;
  /** Drawn size in composition pixels. Required — media clips have no intrinsic bounds. */
  readonly width?: number;
  readonly height?: number;
}

export interface CropProps {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TextClip extends VisualProps {
  readonly type: "text";
  readonly content: string;
  readonly fontFamily?: string;
  readonly fontWeight?: number | string;
  readonly fontStyle?: string;
  readonly fontSize: number;
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

export interface ShapeClip extends VisualProps {
  readonly type: "shape";
  readonly shapeType: ShapeType;
  readonly width?: number;
  readonly height?: number;
  readonly radius?: number;
  readonly points?: readonly Point[];
  readonly path?: readonly PathSegment[];
  readonly fill?: ColorValue;
  readonly stroke?: Stroke;
  readonly shadow?: Shadow;
  readonly closed?: boolean;
}

export type ShapeType = "rectangle" | "rounded-rectangle" | "ellipse" | "line" | "polygon" | "path";

export interface SolidClip extends VisualProps {
  readonly type: "solid";
  readonly color: ColorValue;
  readonly width?: number;
  readonly height?: number;
}

export interface GroupClip extends VisualProps {
  readonly type: "group";
  readonly children: readonly Clip[];
}

export interface SceneClip extends VisualProps {
  readonly type: "scene";
  readonly ref: string;
  readonly props?: Record<string, unknown>;
  readonly timeline?: Timeline;
  readonly width?: number;
  readonly height?: number;
}

export interface ComponentClip extends VisualProps {
  readonly type: "component";
  readonly ref: string;
  readonly props?: Record<string, unknown>;
}

export type AudioStemName = "vocals" | "drums" | "bass" | "other";

export interface AudioClip extends TimeRange, AudioLikeProps {
  readonly type: "audio";
  readonly name?: string;
  readonly src: string;
  readonly stem?: AudioStemName;
  readonly stemModel?: string;
  /** Inline decoded buffer (synthesized or pre-decoded audio). */
  readonly buffer?: AudioBuffer;
}

export interface SoundClip extends TimeRange, AudioLikeProps {
  readonly type: "sound";
  readonly name?: string;
  readonly ref: string;
  readonly params?: Record<string, unknown>;
}

export interface TtsClip extends TimeRange, AudioLikeProps {
  readonly type: "tts";
  readonly text: string;
  readonly voice?: string;
  readonly speed?: number;
  readonly pitch?: number;
  readonly language?: string;
  readonly engine?: "edge" | "system";
}

export type CameraTransitionType = "cut" | "dissolve" | "wipe";

export interface CameraSwitchEvent {
  readonly timestampSeconds: number;
  readonly targetCameraId: string;
  readonly transitionType: CameraTransitionType;
  readonly transitionDurationSeconds?: number;
}

export interface MultiCameraClip extends VisualProps {
  readonly type: "multiCamera";
  readonly src: string;
  readonly cameras: Record<string, Camera>;
  readonly switches?: readonly CameraSwitchEvent[];
  readonly defaultCameraId?: string;
  readonly width?: number;
  readonly height?: number;
  readonly background?: string;
  readonly lighting?: Model3dLighting;
  readonly materialOverrides?: readonly MaterialSlotOverride[];
  readonly animation?: {
    readonly clipName?: string;
    readonly speed?: number;
    readonly loop?: boolean;
  };
  readonly wipeDirection?: "left" | "right" | "up" | "down";
}

export interface Model3dClip extends VisualProps {
  readonly type: "model3d";
  readonly src: string;
  readonly width?: number;
  readonly height?: number;
  readonly camera?: {
    readonly orbit?: boolean;
    readonly radius?: number;
    readonly speed?: number;
  };
  readonly lighting?: Model3dLighting;
  readonly materialOverrides?: readonly MaterialSlotOverride[];
  readonly animation?: {
    readonly clipName?: string;
    readonly speed?: number;
    readonly loop?: boolean;
  };
}

export interface Model3dLighting {
  readonly ambient?: { color?: string; intensity?: number };
  readonly directional?: {
    color?: string;
    intensity?: number;
    direction?: [number, number, number];
    castShadows?: boolean;
    shadowSoftness?: number;
    shadowResolution?: number;
  };
}

export interface SvgClip extends VisualProps {
  readonly type: "svg";
  readonly src?: string;
  readonly content?: string;
  readonly width?: number;
  readonly height?: number;
}

export interface ParticleClip extends VisualProps {
  readonly type: "particle";
  readonly params: {
    readonly emitRate: number;
    readonly lifetime: number;
    readonly velocity?: number;
    readonly gravity?: number;
    readonly sizeStart: number;
    readonly sizeEnd?: number;
    readonly colorStart: string;
    readonly colorEnd?: string;
    readonly blending?: "additive" | "normal";
    readonly emitterShape?: "point" | "circle" | "rectangle";
    readonly emitterRadius?: number;
    readonly emitterWidth?: number;
    readonly emitterHeight?: number;
    readonly physics?: ParticlePhysicsConfig;
    readonly debug?: boolean;
  };
  readonly seed?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface NoiseClip extends VisualProps {
  readonly type: "noise";
  readonly params: {
    readonly kind: "simplex" | "perlin" | "value";
    readonly dimensions: 2 | 3;
    readonly scale: number;
    readonly offsetX?: number;
    readonly offsetY?: number;
    readonly animationSpeed?: number;
    readonly seed?: number;
    readonly outputType?: "luminance" | "rgb" | "rgba";
  };
  readonly width?: number;
  readonly height?: number;
}

export interface AudioVisualizerClip extends VisualProps {
  readonly type: "audioVisualizer";
  readonly trackRef: string;
  readonly vizType: "bars" | "waveform" | "radial" | "circular";
  readonly barCount?: number;
  readonly barWidth?: number;
  readonly barGap?: number;
  readonly frequencyScale?: "linear" | "logarithmic";
  readonly smoothing?: number;
  readonly fill?: string;
  readonly mirror?: boolean;
  readonly width?: number;
  readonly height?: number;
}

export interface ChromaKeyClip extends VisualProps {
  readonly type: "chromakey";
  readonly src: string;
  readonly keyColor?: string;
  readonly similarity?: number;
  readonly spillSuppress?: number;
  readonly softness?: number;
  readonly fit?: FitMode;
  readonly crop?: CropProps;
  readonly width?: number;
  readonly height?: number;
}

export interface SubtitleClip extends VisualProps {
  readonly type: "subtitle";
  readonly src: string;
  readonly style?: {
    readonly fontSize?: number;
    readonly fontFamily?: string;
    readonly fillColor?: string;
    readonly strokeColor?: string;
    readonly strokeWidth?: number;
    readonly outline?: boolean;
    readonly crossfadeDuration?: number;
  };
  readonly position?: "bottom" | "top" | "custom";
  readonly customY?: number;
  readonly charReveal?: boolean;
}

export interface DataVizClip extends VisualProps {
  readonly type: "dataViz";
  readonly data: readonly number[] | ReadonlyArray<{ label: string; value: number }>;
  readonly chartType: "bar" | "line" | "scatter";
  readonly xAxisLabel?: string;
  readonly yAxisLabel?: string;
  readonly colors?: readonly string[];
  readonly showValues?: boolean;
  readonly animDuration?: number;
}

export interface StickerClip extends VisualProps {
  readonly type: "sticker";
  readonly emoji: string;
  readonly size: number;
  readonly font?: string;
}

export interface GradientMeshClip extends VisualProps {
  readonly type: "gradient-mesh";
  readonly gridCols: number;
  readonly gridRows: number;
  readonly anchors: readonly { x: number; y: number; color: string }[];
  readonly width?: number;
  readonly height?: number;
}

export interface Text3dClip extends VisualProps {
  readonly type: "text3d";
  readonly content: string;
  readonly fontFamily?: string;
  readonly fontWeight?: number | string;
  readonly fontStyle?: string;
  readonly fontSize: number;
  readonly extrusionDepth?: number;
  readonly bevel?: boolean;
  readonly bevelDepth?: number;
  readonly frontColor?: string;
  readonly sideColor?: string;
  readonly backColor?: string;
  readonly rotationY?: number;
  readonly rotationX?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface MeshWarpClip extends VisualProps {
  readonly type: "meshwarp";
  readonly src: string;
  readonly cols: number;
  readonly rows: number;
  readonly warpPoints?: readonly { col: number; row: number; dx: number; dy: number }[];
  readonly animated?: boolean;
  readonly width?: number;
  readonly height?: number;
}

export function clipName(clip: Clip): string {
  if (typeof clip === "object" && "name" in clip && typeof clip.name === "string") {
    return clip.name;
  }
  switch (clip.type) {
    case "video":
    case "image":
    case "audio":
      return clip.src;
    case "text":
      return clip.content.length > 20 ? `${clip.content.slice(0, 20)}…` : clip.content;
    case "shape":
      return clip.shapeType;
    case "solid":
      return `solid(${typeof clip.color === "string" ? clip.color : clip.color.type})`;
    case "scene":
    case "component":
    case "sound":
      return clip.ref;
    case "tts":
      return clip.text.length > 20 ? `${clip.text.slice(0, 20)}…` : clip.text;
    case "model3d":
      return clip.src;
    case "svg":
      return clip.src ?? "inline-svg";
    case "particle":
      return `particle(${clip.params.emitRate}/s)`;
    case "noise":
      return `noise(${clip.params.kind})`;
    case "audioVisualizer":
      return `viz(${clip.trackRef})`;
    case "chromakey":
      return clip.src;
    case "subtitle":
      return clip.src;
    case "dataViz":
      return `chart(${clip.chartType})`;
    case "sticker":
      return clip.emoji;
    case "gradient-mesh":
      return `mesh(${clip.gridCols}x${clip.gridRows})`;
    case "meshwarp":
      return clip.src;
    case "text3d":
      return clip.content.length > 20 ? `${clip.content.slice(0, 20)}…` : clip.content;
    case "group":
      return `group(${clip.children.length})`;
  }
  return "clip";
}

export function isAudioClip(clip: Clip): clip is AudioClip | SoundClip | TtsClip {
  return clip.type === "audio" || clip.type === "sound" || clip.type === "tts";
}

export function clipSize(clip: VisualClip): Size | undefined {
  if (
    clip.type === "shape" ||
    clip.type === "solid" ||
    clip.type === "svg" ||
    clip.type === "particle" ||
    clip.type === "audioVisualizer" ||
    clip.type === "chromakey"
  ) {
    if (clip.width !== undefined && clip.height !== undefined) {
      return { width: clip.width, height: clip.height };
    }
  }
  return undefined;
}

export function clipAnchorOffset(clip: VisualClip, anchor: Anchor): Point {
  const size = clipSize(clip);
  if (size === undefined) {
    return { x: 0, y: 0 };
  }
  switch (anchor) {
    case "top-left":
      return { x: 0, y: 0 };
    case "top":
      return { x: size.width / 2, y: 0 };
    case "top-right":
      return { x: size.width, y: 0 };
    case "left":
      return { x: 0, y: size.height / 2 };
    case "center":
      return { x: size.width / 2, y: size.height / 2 };
    case "right":
      return { x: size.width, y: size.height / 2 };
    case "bottom-left":
      return { x: 0, y: size.height };
    case "bottom":
      return { x: size.width / 2, y: size.height };
    case "bottom-right":
      return { x: size.width, y: size.height };
  }
}
