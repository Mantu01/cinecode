import type { SKRSContext2D, Canvas } from "@napi-rs/canvas";

/**
 * Procedural per-frame drawing model for standalone animation.
 *
 * A frame builder receives frame index / time / seed and draws the frame
 * directly. Draw operations can overlap with explicit z-order, independent of
 * clip-on-track layering. This model lives alongside the clip model — a
 * builder can be used on its own or combined with clip-based composition.
 *
 * Everything here is deterministic: the same builder + frame + seed always
 * produces the same draw sequence.
 */

export interface FrameDrawContext {
  readonly ctx: SKRSContext2D;
  readonly canvas: Canvas;
  readonly frame: number;
  readonly time: number;
  readonly fps: number;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
}

export type FrameBuilder = (context: FrameDrawContext) => void;

export interface DrawOp {
  /** Higher z draws later (on top). Ties break by insertion order. */
  readonly z: number;
  readonly draw: (context: FrameDrawContext) => void;
}

export interface DrawList {
  /** Queue a draw op at the given z-order. */
  push(z: number, draw: (context: FrameDrawContext) => void): void;
  /** Run all queued ops in deterministic z-order against the context. */
  flush(context: FrameDrawContext): void;
  readonly length: number;
}

/**
 * Create a z-ordered draw list. Ops are sorted by z (ascending), then by
 * insertion order for ties, so overlapping draws are deterministic.
 */
export function createDrawList(): DrawList {
  const ops: (DrawOp & { readonly seq: number })[] = [];
  let seq = 0;
  return {
    push(z, draw) {
      ops.push({ z, draw, seq });
      seq += 1;
    },
    flush(context) {
      const ordered = [...ops].sort((a, b) => (a.z === b.z ? a.seq - b.seq : a.z - b.z));
      for (const op of ordered) op.draw(context);
      ops.length = 0;
      seq = 0;
    },
    get length() {
      return ops.length;
    },
  };
}

/**
 * Render a frame builder onto a canvas. The builder draws directly onto the
 * context; clearing/background handling is the caller's responsibility so the
 * model composites cleanly with clip-based layers.
 */
export function buildFrame(
  canvas: Canvas,
  ctx: SKRSContext2D,
  builder: FrameBuilder,
  params: { readonly frame: number; readonly fps: number; readonly seed: number },
): void {
  const context: FrameDrawContext = {
    ctx,
    canvas,
    frame: params.frame,
    time: params.frame / params.fps,
    fps: params.fps,
    seed: params.seed,
    width: canvas.width,
    height: canvas.height,
  };
  builder(context);
}

/**
 * Scoped draw helper: runs `fn` with a private draw list, flushing ops in
 * z-order at the end. Lets a sub-animation group its own overlapping draws
 * without leaking ordering into the outer frame.
 */
export function withDrawList(context: FrameDrawContext, fn: (list: DrawList) => void): void {
  const list = createDrawList();
  fn(list);
  list.flush(context);
}
