export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export type Anchor = "top-left" | "center" | "top" | "bottom" | "left" | "right" | "top-right" | "bottom-left" | "bottom-right";

export interface Transform {
  readonly x?: number;
  readonly y?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly rotation?: number;
  readonly anchor?: Anchor;
}

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "add"
  | "darken"
  | "lighten"
  | "soft-light"
  | "difference";

export interface GradientStop {
  readonly color: string;
  readonly offset: number;
}

export type Paint = SolidPaint | LinearGradientPaint | RadialGradientPaint | ConicGradientPaint | ImagePaint;

export interface SolidPaint {
  readonly type: "solid";
  readonly color: string;
}

export interface LinearGradientPaint {
  readonly type: "linear";
  readonly angle: number;
  readonly stops: readonly GradientStop[];
}

export interface RadialGradientPaint {
  readonly type: "radial";
  readonly center?: Point;
  readonly radius?: number;
  readonly stops: readonly GradientStop[];
}

export interface ConicGradientPaint {
  readonly type: "conic";
  readonly center?: Point;
  readonly angle: number;
  readonly stops: readonly GradientStop[];
}

export interface ImagePaint {
  readonly type: "image";
  readonly src: string;
  readonly fit?: FitMode;
}

export type FitMode = "contain" | "cover" | "fill" | "none";

export interface Shadow {
  readonly color: string;
  readonly blur: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
}

export interface Stroke {
  readonly color: string;
  readonly width: number;
  readonly lineCap?: "butt" | "round" | "square";
  readonly lineJoin?: "miter" | "round" | "bevel";
  readonly dashes?: readonly number[];
  readonly dashOffset?: number;
}

export type ColorValue = string | Paint;
