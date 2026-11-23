import { authoringIssue, AUTHORING_CODES } from "../validation/errors.js";
import type { AnimatableValue } from "../types/animatable.js";
import type { EasingDescriptor } from "../types/easing.js";
import { type FrameConversion, timeInputToFrames, createConversion } from "../time/convert.js";
import { mixColors, parseColor } from "../easing/colors.js";
import { interpolateKeyframeValue, keyframeProgress } from "./interpolate.js";
import { namedEasingDescriptor } from "../easing/curve.js";
import type { KeyframeInterpolationInput } from "./types.js";

function resolveEasingInput(easing: unknown): EasingDescriptor | undefined {
  if (typeof easing === "string") return namedEasingDescriptor(easing) ?? undefined;
  return easing as EasingDescriptor | undefined;
}

export interface EngineKeyframe {
  readonly atFrames: number;
  readonly value: AnimatableValue;
  readonly interpolation?: KeyframeInterpolationInput;
  readonly easing?: EasingDescriptor;
}

export function createEngineKeyframe(
  atFrames: number,
  value: AnimatableValue,
  easing?: EasingDescriptor,
  interpolation?: KeyframeInterpolationInput,
): EngineKeyframe {
  const base: EngineKeyframe = { atFrames, value };
  return {
    ...base,
    ...(easing === undefined ? {} : { easing }),
    ...(interpolation === undefined ? {} : { interpolation }),
  };
}

export type AnimatablePropertyMap = Readonly<Record<string, readonly EngineKeyframe[]>>;

export function buildPropertyMap(
  entries: readonly (readonly [property: string, keyframes: readonly EngineKeyframe[]])[],
): AnimatablePropertyMap {
  const map: Record<string, readonly EngineKeyframe[]> = {};
  for (const [property, list] of entries) {
    map[property] = list;
  }
  return map;
}

export function validateKeyframes(
  property: string,
  keyframes: readonly EngineKeyframe[],
  position?: { file: string; line: number; column: number },
): void {
  for (let i = 1; i < keyframes.length; i += 1) {
    const previous = keyframes[i - 1]!;
    const current = keyframes[i]!;
    if (current.atFrames < previous.atFrames) {
      throw authoringIssue(
        AUTHORING_CODES.invalidKeyframes,
        `Keyframes for "${property}" are not sorted by time`,
        { position },
      );
    }
    if (current.atFrames === previous.atFrames) {
      throw authoringIssue(
        AUTHORING_CODES.invalidKeyframes,
        `Keyframes for "${property}" have a duplicate time at ${current.atFrames} frames`,
        { position },
      );
    }
  }
}

export function sortKeyframes(keyframes: readonly EngineKeyframe[]): readonly EngineKeyframe[] {
  return [...keyframes].sort((a, b) => a.atFrames - b.atFrames);
}

export interface InterpolationContext {
  readonly conversion: FrameConversion;
  readonly fps: number;
}

export function interpolateProperty(
  keyframes: readonly EngineKeyframe[],
  clipFrame: number,
  context: InterpolationContext,
): AnimatableValue {
  if (keyframes.length === 0) {
    throw new RangeError("interpolateProperty requires at least one keyframe");
  }
  const first = keyframes[0]!;
  if (clipFrame <= first.atFrames) {
    return first.value;
  }
  const last = keyframes[keyframes.length - 1]!;
  if (clipFrame >= last.atFrames) {
    return last.value;
  }
  let index = 0;
  for (let i = 1; i < keyframes.length; i += 1) {
    if (keyframes[i]!.atFrames > clipFrame) {
      index = i - 1;
      break;
    }
  }
  const from = keyframes[index]!;
  const to = keyframes[index + 1]!;
  const span = to.atFrames - from.atFrames;
  const localTime = span > 0 ? Math.min(1, Math.max(0, (clipFrame - from.atFrames) / span)) : 1;
  const easing = keyframeProgress(from.interpolation, from.easing, context.fps);
  const eased = evaluationSafe(easing(localTime));
  return interpolateValues(from.value, to.value, eased);
}

function evaluationSafe(progress: number): number {
  if (!Number.isFinite(progress)) {
    return 1;
  }
  return Math.min(1, Math.max(0, progress));
}

export function interpolateValues(from: AnimatableValue, to: AnimatableValue, t: number): AnimatableValue {
  return interpolateKeyframeValue(from, to, t) as AnimatableValue;
}

export function colorAt(from: string, to: string, t: number): string {
  return mixColors(from, to, t);
}

export function sampleHexString(hex: string): { r: number; g: number; b: number } {
  const rgba = parseColor(hex);
  return { r: rgba.r, g: rgba.g, b: rgba.b };
}

export { timeInputToFrames };

export function resolveClipKeyframes<T extends Record<string, any>>(clip: T, frame: number, fps: number): T {
  if (!clip.keyframes) return clip;
  const rawKeyframes = clip.keyframes;
  const entries: [string, readonly unknown[]][] = Array.isArray(rawKeyframes)
    ? (rawKeyframes as unknown as [string, readonly unknown[]][])
    : Object.entries(rawKeyframes);
  if (entries.length === 0) return clip;

  const conversion = createConversion(fps);
  const clipStart = typeof clip.start === "number"
    ? Math.round(clip.start * fps)
    : typeof clip.start === "string"
      ? timeInputToFrames(clip.start, conversion)
      : 0;
  const localFrame = frame - clipStart;
  const ctx: InterpolationContext = { conversion, fps };

  const overrides: Record<string, unknown> = {};
  for (const [prop, tuples] of entries) {
    if (!Array.isArray(tuples) || tuples.length === 0) continue;
    const engineKfs = tuples.map((t: readonly [time: number, value: unknown, easing?: unknown]) => {
      const atTime = typeof t[0] === "number" ? t[0] : 0;
      const atFrames = typeof t[0] === "number" && t[0] <= 1000 && !Number.isInteger(t[0])
        ? Math.round(t[0] * fps)
        : typeof t[0] === "string"
          ? timeInputToFrames(t[0], conversion)
          : Math.round(atTime * (atTime <= 60 ? fps : 1));
      return createEngineKeyframe(atFrames, t[1] as AnimatableValue, resolveEasingInput(t[2]));
    });
    const sorted = sortKeyframes(engineKfs as readonly EngineKeyframe[]) as readonly EngineKeyframe[];
    overrides[prop] = interpolateProperty(sorted, localFrame, ctx);
  }

  const result: Record<string, any> = { ...clip };
  for (const [prop, value] of Object.entries(overrides)) {
    if (prop.includes(".")) {
      const parts = prop.split(".");
      let current: Record<string, any> = result;
      for (let i = 0; i < parts.length - 1; i++) {
        current[parts[i]!] = { ...current[parts[i]!] };
        current = current[parts[i]!];
      }
      current[parts[parts.length - 1]!] = value;
    } else if (prop === "x" || prop === "y" || prop === "rotation") {
      result.transform = { ...result.transform, [prop]: value };
    } else if (prop === "scale") {
      result.transform = { ...result.transform, scaleX: value, scaleY: value };
    } else {
      result[prop] = value;
    }
  }
  return result as T;
}
