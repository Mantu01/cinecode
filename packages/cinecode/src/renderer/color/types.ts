export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface Hsla {
  readonly h: number;
  readonly s: number;
  readonly l: number;
  readonly a: number;
}

export interface GradientStop {
  readonly offset: number;
  readonly color: Rgba;
}

export type GradientType = "linear" | "radial" | "conic";

export interface LinearGradient {
  readonly type: "linear";
  readonly angle: number;
  readonly stops: readonly GradientStop[];
}

export interface RadialGradient {
  readonly type: "radial";
  readonly centerX: number;
  readonly centerY: number;
  readonly radius: number;
  readonly stops: readonly GradientStop[];
}

export interface ConicGradient {
  readonly type: "conic";
  readonly centerX: number;
  readonly centerY: number;
  readonly angle: number;
  readonly stops: readonly GradientStop[];
}

export type Gradient = LinearGradient | RadialGradient | ConicGradient;

export type Paint = Rgba | Gradient;