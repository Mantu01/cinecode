import type { EasingDescriptor, EaseFamily, EaseMode, StepsPosition } from "../types/easing.js";

export type Progress = (t: number) => number;

export function linearProgress(t: number): number {
  return t;
}

function easeIn(family: EaseFamily, t: number): number {
  switch (family) {
    case "sine":
      return 1 - Math.cos((t * Math.PI) / 2);
    case "quad":
      return t * t;
    case "cubic":
      return t * t * t;
    case "quart":
      return t ** 4;
    case "expo":
      return t === 0 ? 0 : 2 ** (10 * (t - 1));
    case "back":
      return t * t * (2.70158 * t - 1.70158);
    case "elastic":
      return t === 0 ? 0 : t === 1 ? 1 : -(2 ** (10 * t - 10)) * Math.sin(((t * 10 - 10.75) * 2 * Math.PI) / 4);
    case "bounce":
      return bounceOut(t);
  }
}

function easeOut(family: EaseFamily, t: number): number {
  switch (family) {
    case "sine":
      return Math.sin((t * Math.PI) / 2);
    case "quad":
      return 1 - (1 - t) ** 2;
    case "cubic":
      return 1 - (1 - t) ** 3;
    case "quart":
      return 1 - (1 - t) ** 4;
    case "expo":
      return t === 1 ? 1 : 1 - 2 ** (-10 * t);
    case "back":
      return 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
    case "elastic":
      return t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * 2 * Math.PI) / 4) + 1;
    case "bounce":
      return 1 - bounceOut(1 - t);
  }
}

function bounceOut(input: number): number {
  if (input < 4 / 11) return (121 * input * input) / 16;
  if (input < 8 / 11) return (363 / 40) * input * input - (99 / 10) * input + 17 / 5;
  if (input < 9 / 10) return (4356 / 361) * input * input - (35442 / 1705) * input + 16061 / 1805;
  return (54 / 5) * input * input - (513 / 25) * input + 268 / 25;
}

export function easeProgress(family: EaseFamily, mode: EaseMode): Progress {
  switch (mode) {
    case "in":
      return (t) => easeIn(family, t);
    case "out":
      return (t) => easeOut(family, t);
    case "in-out": {
      const half = 0.5;
      return (t) => (t < half ? easeIn(family, t * 2) / 2 : 1 - easeIn(family, (1 - t) * 2) / 2);
    }
  }
}

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Progress {
  const bez = (v: number, a: number, b: number) =>
    ((1 - 3 * b + 3 * a) * v ** 3 + (3 * b - 6 * a) * v ** 2 + 3 * a * v);
  const bezDeriv = (v: number, a: number, b: number) =>
    3 * (1 - 3 * b + 3 * a) * v ** 2 + 2 * (3 * b - 6 * a) * v + 3 * a;
  const solveX = (t: number) => {
    let guess = t;
    for (let i = 0; i < 8; i += 1) {
      const err = bez(guess, x1, x2) - t;
      const d = bezDeriv(guess, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      guess -= err / d;
    }
    return guess;
  };
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const x = solveX(t);
    return bez(x, y1, y2);
  };
}

const DEFAULT_SPRING_STIFFNESS = 100;
const DEFAULT_SPRING_DAMPING = 10;
const DEFAULT_SPRING_MASS = 1;
const DEFAULT_VELOCITY = 0;

export interface SpringSegment {
  readonly from: number;
  readonly to: number;
  readonly span: number;
  readonly samples: number;
  readonly values: Float64Array;
}

export function springSamples(
  stiffness = DEFAULT_SPRING_STIFFNESS,
  damping = DEFAULT_SPRING_DAMPING,
  mass = DEFAULT_SPRING_MASS,
  velocity = DEFAULT_VELOCITY,
  fps: number,
): Float64Array {
  const k = stiffness;
  const c = damping;
  const m = mass;
  const dt = 1 / (fps * 8);
  const stepCount = Math.ceil(fps * 8);
  const out = new Float64Array(stepCount + 1);
  let pos = 0;
  let vel = velocity;
  for (let i = 0; i <= stepCount; i += 1) {
    out[i] = pos;
    const force = k * (1 - pos) - c * vel;
    const accel = force / m;
    vel += accel * dt;
    pos += vel * dt;
  }
  return out;
}

export function springProgress(stiffness = DEFAULT_SPRING_STIFFNESS, damping = DEFAULT_SPRING_DAMPING, mass = DEFAULT_SPRING_MASS, velocity = DEFAULT_VELOCITY, fps: number): Progress {
  const values = springSamples(stiffness, damping, mass, velocity, fps);
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const x = t * (values.length - 1);
    const i = Math.floor(x);
    const frac = x - i;
    return values[i]! * (1 - frac) + values[i + 1]! * frac;
  };
}

export function stepsProgress(count: number, position: StepsPosition): Progress {
  return (t) => {
    const clamped = Math.min(1, Math.max(0, t));
    switch (position) {
      case "start":
        return Math.floor(clamped * count) / count;
      case "end":
        return Math.ceil(clamped * count) / count;
      case "both":
        return clamp01(Math.round(clamped * count) / count);
      case "none":
        return clamp01(Math.round((clamped - 0.5) * count) / count + 0.5);
    }
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function curveProgress(descriptor: EasingDescriptor, fps: number): Progress {
  switch (descriptor.kind) {
    case "linear":
      return linearProgress;
    case "hold":
      return () => 0;
    case "ease":
      return easeProgress(descriptor.family, descriptor.mode);
    case "cubic-bezier":
      return cubicBezier(descriptor.x1, descriptor.y1, descriptor.x2, descriptor.y2);
    case "spring":
      return springProgress(descriptor.stiffness, descriptor.damping, descriptor.mass, descriptor.velocity ?? 0, fps);
    case "steps":
      return stepsProgress(descriptor.count, descriptor.position);
    case "bezier-curve":
      return cubicBezier(descriptor.points[1]!, descriptor.points[2]!, descriptor.points[5]!, descriptor.points[6]!);
  }
}
