import type { EasingDescriptor } from "../types/easing.js";

export type KeyframeTarget =
  | number
  | string
  | readonly number[]
  | { readonly r: number; readonly g: number; readonly b: number; readonly a?: number }
  | { readonly x: number; readonly y: number; readonly z?: number };

export type KeyframeInterpolationName = "linear" | "bezier" | "spring" | "hold" | "step";

export interface SpringParameters {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
  readonly velocity?: number;
  readonly durationSeconds?: number;
}

export type KeyframeInterpolation =
  | { readonly type: "linear" }
  | { readonly type: "hold" }
  | { readonly type: "step" }
  | { readonly type: "bezier"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly type: "spring"; readonly spring: Partial<SpringParameters> };

export type KeyframeInterpolationInput =
  | KeyframeInterpolationName
  | KeyframeInterpolation
  | readonly [number, number, number, number];

export interface Keyframe<T = KeyframeTarget> {
  readonly at: number | string;
  readonly value: T;
  readonly interpolation?: KeyframeInterpolationInput;
  readonly easing?: EasingDescriptor;
  readonly label?: string;
}

export const DEFAULT_SPRING: SpringParameters = {
  stiffness: 100,
  damping: 10,
  mass: 1,
};

export function normalizeInterpolation(input: KeyframeInterpolationInput | undefined): KeyframeInterpolation {
  if (input === undefined) return { type: "linear" };
  if (typeof input === "string") {
    if (input === "bezier") return { type: "bezier", x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
    if (input === "spring") return { type: "spring", spring: DEFAULT_SPRING };
    return { type: input };
  }
  if (Array.isArray(input)) {
    const [x1 = 0.42, y1 = 0, x2 = 0.58, y2 = 1] = input;
    return { type: "bezier", x1, y1, x2, y2 };
  }
  return input as KeyframeInterpolation;
}
