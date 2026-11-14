import { noise1d, noise2d } from "../core/random/index.js";

/**
 * Motion-by-math: direct time-to-value functions for procedural animation.
 *
 * These are pure, deterministic functions of time (plus a seed where noise or
 * randomness is involved). They let authors express motion directly rather than
 * enumerating keyframes, and they compose with the frame-builder model.
 *
 * Every helper is deterministic: the same inputs always produce the same value.
 */

/** Oscillate between `from` and `to` using a sine wave at `hz` cycles/second. */
export function oscillate(from: number, to: number, hz: number, time: number, phase = 0): number {
  const mid = (from + to) / 2;
  const amp = (to - from) / 2;
  return mid + amp * Math.sin((time * hz + phase) * Math.PI * 2);
}

/** Triangle-wave oscillation: linear ramps between from and to, no easing. */
export function triangle(from: number, to: number, hz: number, time: number, phase = 0): number {
  const t = (time * hz + phase) % 1;
  const tri = t < 0.5 ? t * 2 : 2 - t * 2;
  return from + (to - from) * tri;
}

/** Sawtooth-wave ramp from `from` to `to`, resetting each cycle. */
export function saw(from: number, to: number, hz: number, time: number, phase = 0): number {
  const t = (time * hz + phase) % 1;
  return from + (to - from) * t;
}

/**
 * Bouncing value that decays over `duration` seconds. Returns the height
 * fraction (1 → 0) of a ball dropped from `from` and bouncing to `to`.
 */
export function bounce(from: number, to: number, time: number, duration: number, bounces = 4): number {
  if (duration <= 0) return to;
  const t = Math.max(0, Math.min(1, time / duration));
  const decay = 1 - t;
  const wave = Math.abs(Math.sin(t * Math.PI * bounces)) * decay;
  return from + (to - from) * wave;
}

/** Ease a value toward a target over time with an exponential settle. */
export function springTo(from: number, to: number, time: number, stiffness = 12, damping = 6): number {
  const x = 1 - Math.exp(-damping * time) * Math.cos(stiffness * time);
  return from + (to - from) * x;
}

/** Spin at `revolutionsPerSecond` revolutions per second, in radians. */
export function spin(revolutionsPerSecond: number, time: number, startAngle = 0): number {
  return startAngle + time * revolutionsPerSecond * Math.PI * 2;
}

/** Deterministic noise-driven value in [from, to], sampled at `hz` scale. */
export function noiseDrift(seed: number, from: number, to: number, hz: number, time: number): number {
  const n = noise1d(seed, time * hz);
  return from + (to - from) * (n * 0.5 + 0.5);
}

/** Deterministic 2D noise-driven point, useful for wandering motion. */
export function noiseWander(seed: number, radius: number, hz: number, time: number): { readonly x: number; readonly y: number } {
  const x = (noise2d(seed, time * hz, 0) - 0.5) * 2 * radius;
  const y = (noise2d(seed + 1, time * hz, 0) - 0.5) * 2 * radius;
  return { x, y };
}

/** Lissajous curve: parametric motion with independent x/y frequencies. */
export function lissajous(ax: number, ay: number, fx: number, fy: number, time: number, phaseX = 0, phaseY = 0): { readonly x: number; readonly y: number } {
  return {
    x: ax * Math.sin((fx * time + phaseX) * Math.PI * 2),
    y: ay * Math.sin((fy * time + phaseY) * Math.PI * 2),
  };
}

/** Pulse between 0 and 1 with a sharp attack and smooth release. */
export function pulse(hz: number, time: number, sharpness = 4): number {
  const t = (time * hz) % 1;
  return Math.pow(Math.sin(t * Math.PI), sharpness);
}

/** Map a value from one range to another, clamped. */
export function remap(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return outMin;
  const t = Math.max(0, Math.min(1, (value - inMin) / (inMax - inMin)));
  return outMin + (outMax - outMin) * t;
}
