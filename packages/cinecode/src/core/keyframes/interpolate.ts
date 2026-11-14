import { mixColors } from "../easing/colors.js";
import type { Progress } from "../easing/curve.js";
import type { EasingDescriptor } from "../types/easing.js";
import { curveProgress } from "../easing/curve.js";
import {
  DEFAULT_SPRING,
  normalizeInterpolation,
  type KeyframeInterpolationInput,
  type SpringParameters,
} from "./types.js";

const BEZIER_EPSILON = 1e-7;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function bezierValue(t: number, a: number, b: number): number {
  return (1 - 3 * b + 3 * a) * t ** 3 + (3 * b - 6 * a) * t ** 2 + 3 * a * t;
}

function bezierDerivative(t: number, a: number, b: number): number {
  return 3 * (1 - 3 * b + 3 * a) * t ** 2 + 2 * (3 * b - 6 * a) * t + 3 * a;
}

function solveBezierParameter(x: number, x1: number, x2: number): number {
  let guess = x;
  for (let i = 0; i < 8; i += 1) {
    const error = bezierValue(guess, x1, x2) - x;
    if (Math.abs(error) < BEZIER_EPSILON) return clamp01(guess);
    const derivative = bezierDerivative(guess, x1, x2);
    if (Math.abs(derivative) < BEZIER_EPSILON) break;
    guess -= error / derivative;
    if (!Number.isFinite(guess)) break;
  }
  let low = 0;
  let high = 1;
  let middle = clamp01(x);
  for (let i = 0; i < 32; i += 1) {
    const value = bezierValue(middle, x1, x2);
    if (Math.abs(value - x) < BEZIER_EPSILON) break;
    if (value < x) low = middle;
    else high = middle;
    middle = (low + high) / 2;
  }
  return middle;
}

export function cubicBezierProgress(x1: number, y1: number, x2: number, y2: number): Progress {
  const controlX1 = clamp01(x1);
  const controlX2 = clamp01(x2);
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const parameter = solveBezierParameter(clamp01(t), controlX1, controlX2);
    return bezierValue(parameter, y1, y2);
  };
}

export function springSettleDuration(parameters: Partial<SpringParameters> = {}): number {
  const stiffness = parameters.stiffness ?? DEFAULT_SPRING.stiffness;
  const damping = parameters.damping ?? DEFAULT_SPRING.damping;
  const mass = parameters.mass ?? DEFAULT_SPRING.mass;
  const omega = Math.sqrt(Math.max(1e-6, stiffness) / Math.max(1e-6, mass));
  const zeta = damping / (2 * Math.sqrt(Math.max(1e-6, stiffness * mass)));
  const rate = zeta > 0 ? zeta * omega : omega;
  return Math.min(10, Math.max(0.05, 4 / Math.max(1e-6, rate)));
}

export function springInterpolationProgress(parameters: Partial<SpringParameters> = {}): Progress {
  const stiffness = parameters.stiffness ?? DEFAULT_SPRING.stiffness;
  const damping = parameters.damping ?? DEFAULT_SPRING.damping;
  const mass = parameters.mass ?? DEFAULT_SPRING.mass;
  const velocity = parameters.velocity ?? 0;
  const duration = parameters.durationSeconds ?? springSettleDuration(parameters);
  const omega = Math.sqrt(Math.max(1e-6, stiffness) / Math.max(1e-6, mass));
  const zeta = damping / (2 * Math.sqrt(Math.max(1e-6, stiffness * mass)));
  if (zeta < 1 - 1e-6) {
    const dampedOmega = omega * Math.sqrt(1 - zeta * zeta);
    const coefficient = (zeta * omega - velocity) / dampedOmega;
    return (t) => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      const time = t * duration;
      const envelope = Math.exp(-zeta * omega * time);
      return 1 - envelope * (Math.cos(dampedOmega * time) + coefficient * Math.sin(dampedOmega * time));
    };
  }
  if (zeta <= 1 + 1e-6) {
    return (t) => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      const time = t * duration;
      return 1 - Math.exp(-omega * time) * (1 + (omega - velocity) * time);
    };
  }
  const root = Math.sqrt(zeta * zeta - 1);
  const slow = -omega * (zeta - root);
  const fast = -omega * (zeta + root);
  const slowWeight = (velocity - fast) / (slow - fast);
  const fastWeight = 1 - slowWeight;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const time = t * duration;
    return 1 - (slowWeight * Math.exp(slow * time) + fastWeight * Math.exp(fast * time));
  };
}

export function interpolationProgress(input: KeyframeInterpolationInput, _fps: number): Progress {
  const interpolation = normalizeInterpolation(input);
  switch (interpolation.type) {
    case "linear":
      return (t) => t;
    case "hold":
    case "step":
      return () => 0;
    case "bezier":
      return cubicBezierProgress(interpolation.x1, interpolation.y1, interpolation.x2, interpolation.y2);
    case "spring":
      return springInterpolationProgress(interpolation.spring);
  }
}

export function keyframeProgress(
  interpolation: KeyframeInterpolationInput | undefined,
  easing: EasingDescriptor | undefined,
  fps: number,
): Progress {
  if (interpolation !== undefined) return interpolationProgress(interpolation, fps);
  if (easing !== undefined) return curveProgress(easing, fps);
  return (t) => t;
}

export function interpolateNumber(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export interface VectorLike {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
}

export function interpolateVector(from: VectorLike, to: VectorLike, t: number): VectorLike {
  const fromZ = from.z ?? 0;
  const toZ = to.z ?? 0;
  if (from.z === undefined && to.z === undefined) {
    return { x: interpolateNumber(from.x, to.x, t), y: interpolateNumber(from.y, to.y, t) };
  }
  return {
    x: interpolateNumber(from.x, to.x, t),
    y: interpolateNumber(from.y, to.y, t),
    z: interpolateNumber(fromZ, toZ, t),
  };
}

export interface RgbaLike {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a?: number;
}

export function interpolateRgba(from: RgbaLike, to: RgbaLike, t: number): RgbaLike {
  return {
    r: interpolateNumber(from.r, to.r, t),
    g: interpolateNumber(from.g, to.g, t),
    b: interpolateNumber(from.b, to.b, t),
    a: interpolateNumber(from.a ?? 1, to.a ?? 1, t),
  };
}

export function interpolateColor(from: string, to: string, t: number): string {
  if (t <= 0) return from;
  if (t >= 1) return to;
  return mixColors(from, to, t);
}

export function interpolateArray(from: readonly number[], to: readonly number[], t: number): number[] {
  return from.map((value, index) => interpolateNumber(value, to[index] ?? value, t));
}

function isVectorLike(value: unknown): value is VectorLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { x?: unknown; y?: unknown };
  return typeof candidate.x === "number" && typeof candidate.y === "number";
}

function isRgbaLike(value: unknown): value is RgbaLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { r?: unknown; g?: unknown; b?: unknown };
  return typeof candidate.r === "number" && typeof candidate.g === "number" && typeof candidate.b === "number";
}

export function interpolateKeyframeValue(from: unknown, to: unknown, t: number): unknown {
  if (typeof from === "number" && typeof to === "number") return interpolateNumber(from, to, t);
  if (typeof from === "string" && typeof to === "string") return interpolateColor(from, to, t);
  if (isVectorLike(from) && isVectorLike(to)) return interpolateVector(from, to, t);
  if (isRgbaLike(from) && isRgbaLike(to)) return interpolateRgba(from, to, t);
  if (Array.isArray(from) && Array.isArray(to)) {
    const numeric = from.every((value) => typeof value === "number") && to.every((value) => typeof value === "number");
    if (numeric) return interpolateArray(from as readonly number[], to as readonly number[], t);
    return from.map((value, index) => interpolateKeyframeValue(value, to[index] ?? value, t));
  }
  return t < 1 ? from : to;
}

export function interpolateKeyframeValueAs<T>(from: T, to: T, t: number): T {
  return interpolateKeyframeValue(from, to, t) as T;
}
