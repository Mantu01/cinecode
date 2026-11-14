/**
 * Loop, cycle, and time-scoping constructs for procedural animation.
 *
 * These are pure time-warping functions that map a global time into a local
 * time axis, or a local progress into a looping/cycling/ping-ponging one. They
 * let authors express rhythmic and repeating motion without enumerating frames,
 * and they are deterministic: same inputs, same output.
 */

/** Wrap `time` into [0, duration), restarting each cycle (classic loop). */
export function cycle(time: number, duration: number): number {
  if (duration <= 0) return 0;
  return ((time % duration) + duration) % duration;
}

/** Ping-pong: reflect time back and forth across [0, duration). */
export function pingPong(time: number, duration: number): number {
  if (duration <= 0) return 0;
  const t = ((time % (duration * 2)) + duration * 2) % (duration * 2);
  return t <= duration ? t : duration * 2 - t;
}

/** Clamp time to [0, duration], holding the end value past the duration. */
export function hold(time: number, duration: number): number {
  return Math.max(0, Math.min(duration, time));
}

/** Progress in [0, 1] over `duration` seconds, clamped. */
export function progress(time: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(1, time / duration));
}

export interface TimeScopeOptions {
  /** Local duration of the sub-animation, in seconds. */
  readonly duration: number;
  /** Loop mode applied inside the scope. */
  readonly mode?: "once" | "cycle" | "ping-pong" | "hold";
  /** Phase offset in seconds applied before scoping (for rhythmic alignment). */
  readonly phase?: number;
  /** Number of repetitions for cycle/ping-pong before settling (Infinity = forever). */
  readonly repetitions?: number;
}

/**
 * Map a global time into a local, scoped time axis. `TimeScope` lets a
 * sub-animation play over its own local clock that maps into the composition
 * timeline, with optional looping, phase offset, and repetition control.
 */
export function timeScope(globalTime: number, options: TimeScopeOptions): number {
  const { duration, mode = "once", phase = 0, repetitions = Infinity } = options;
  const t = globalTime - phase;
  if (t < 0) return 0;
  switch (mode) {
    case "once":
      return hold(t, duration);
    case "cycle": {
      if (t >= duration * repetitions) return duration;
      return cycle(t, duration);
    }
    case "ping-pong": {
      if (t >= duration * 2 * repetitions) return duration;
      return pingPong(t, duration);
    }
    case "hold":
      return hold(t, duration);
  }
}

/**
 * Turn a local time-to-value function into a looping global one. The returned
 * function samples `fn` at the scoped local time for the given loop mode.
 */
export function loopScope<T>(
  fn: (localTime: number) => T,
  options: TimeScopeOptions,
): (globalTime: number) => T {
  return (globalTime: number) => fn(timeScope(globalTime, options));
}

/** Nested scope: apply an inner scope within an already-scoped local time. */
export function nestedScope(innerTime: number, inner: TimeScopeOptions): number {
  return timeScope(innerTime, inner);
}

/**
 * Repeat a step function `n` times per second, passing the repetition index and
 * the within-step progress. Useful for rhythmic/stepped animation.
 */
export function beat(time: number, bpm: number): { readonly index: number; readonly within: number } {
  const beatsPerSecond = bpm / 60;
  const absolute = time * beatsPerSecond;
  const index = Math.floor(absolute);
  return { index, within: absolute - index };
}
