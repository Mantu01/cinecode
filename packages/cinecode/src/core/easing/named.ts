import { easeProgress, linearProgress, type Progress } from "./curve.js";

/**
 * Named easing exports for every built-in curve. These are thin, stable
 * aliases over `easeProgress` so authors can import a specific easing
 * directly instead of composing family/mode pairs.
 */

export const easeLinear: Progress = linearProgress;

export const easeInSine: Progress = easeProgress("sine", "in");
export const easeOutSine: Progress = easeProgress("sine", "out");
export const easeInOutSine: Progress = easeProgress("sine", "in-out");

export const easeInQuad: Progress = easeProgress("quad", "in");
export const easeOutQuad: Progress = easeProgress("quad", "out");
export const easeInOutQuad: Progress = easeProgress("quad", "in-out");

export const easeInCubic: Progress = easeProgress("cubic", "in");
export const easeOutCubic: Progress = easeProgress("cubic", "out");
export const easeInOutCubic: Progress = easeProgress("cubic", "in-out");

export const easeInQuart: Progress = easeProgress("quart", "in");
export const easeOutQuart: Progress = easeProgress("quart", "out");
export const easeInOutQuart: Progress = easeProgress("quart", "in-out");

export const easeInExpo: Progress = easeProgress("expo", "in");
export const easeOutExpo: Progress = easeProgress("expo", "out");
export const easeInOutExpo: Progress = easeProgress("expo", "in-out");

export const easeInBack: Progress = easeProgress("back", "in");
export const easeOutBack: Progress = easeProgress("back", "out");
export const easeInOutBack: Progress = easeProgress("back", "in-out");

export const easeInElastic: Progress = easeProgress("elastic", "in");
export const easeOutElastic: Progress = easeProgress("elastic", "out");
export const easeInOutElastic: Progress = easeProgress("elastic", "in-out");

export const easeInBounce: Progress = easeProgress("bounce", "in");
export const easeOutBounce: Progress = easeProgress("bounce", "out");
export const easeInOutBounce: Progress = easeProgress("bounce", "in-out");

/**
 * Wrap an arbitrary progress function as a typed easing curve. The function
 * must be deterministic: given the same input it must return the same output.
 */
export function customEasing(fn: (t: number) => number): Progress {
  return (t) => fn(t);
}
