import type { SKRSContext2D } from "@napi-rs/canvas";
import { random } from "../../core/random/index.js";
import { cubicBezier } from "../../core/easing/curve.js";

export interface LetterScatterParams {
  readonly scatterRadius?: number;
  readonly rotationRange?: number;
  readonly stagger?: number;
  readonly duration?: number;
  readonly easing?: readonly [number, number, number, number];
  readonly seed?: number;
  readonly scaleFrom?: number;
}

export interface LetterLayout {
  readonly char: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

export interface LetterScatterState extends LetterLayout {
  readonly index: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly rotation: number;
  readonly scale: number;
  readonly opacity: number;
  readonly progress: number;
}

export function layoutLetters(
  ctx: SKRSContext2D,
  text: string,
  options: { readonly font?: string; readonly letterSpacing?: number } = {},
): readonly LetterLayout[] {
  ctx.save();
  ctx.font = options.font ?? "48px sans-serif";
  const spacing = options.letterSpacing ?? 0;
  let cursor = 0;
  const layout: LetterLayout[] = [];
  for (const char of text) {
    const width = ctx.measureText(char).width;
    layout.push({ char, x: cursor, y: 0, width });
    cursor += width + spacing;
  }
  ctx.restore();
  return layout;
}

export function evaluateLetterScatter(
  layout: readonly LetterLayout[],
  timeSeconds: number,
  params: LetterScatterParams = {},
): readonly LetterScatterState[] {
  const scatterRadius = params.scatterRadius ?? 200;
  const rotationRange = params.rotationRange ?? 360;
  const stagger = Math.max(0, params.stagger ?? 0.05);
  const duration = Math.max(0.01, params.duration ?? 0.8);
  const easing = params.easing ?? [0.34, 1.56, 0.64, 1];
  const curve = cubicBezier(easing[0], easing[1], easing[2], easing[3]);
  const seed = params.seed ?? 1;
  const scaleFrom = params.scaleFrom ?? 0.2;
  const rng = random(Math.max(0, seed));

  return layout.map((letter, index) => {
    const startTime = index * stagger;
    const rawProgress = Math.max(0, Math.min(1, (timeSeconds - startTime) / duration));
    const progress = curve(rawProgress);
    const angle = rng.range(0, Math.PI * 2);
    const distance = scatterRadius * rng.range(0.3, 1);
    const rotation = rng.range(-rotationRange / 2, rotationRange / 2);
    return {
      ...letter,
      index,
      offsetX: Math.cos(angle) * distance * (1 - progress),
      offsetY: Math.sin(angle) * distance * (1 - progress),
      rotation: rotation * (1 - progress),
      scale: scaleFrom + (1 - scaleFrom) * progress,
      opacity: Math.max(0, Math.min(1, progress)),
      progress,
    };
  });
}

export function drawLetterScatter(
  ctx: SKRSContext2D,
  layout: readonly LetterLayout[],
  timeSeconds: number,
  options: {
    readonly x: number;
    readonly y: number;
    readonly font?: string;
    readonly fillStyle?: string;
    readonly params?: LetterScatterParams;
  },
): readonly LetterScatterState[] {
  const states = evaluateLetterScatter(layout, timeSeconds, options.params);
  ctx.save();
  ctx.font = options.font ?? "48px sans-serif";
  ctx.fillStyle = options.fillStyle ?? "#ffffff";
  for (const state of states) {
    if (state.opacity <= 0) continue;
    ctx.save();
    ctx.globalAlpha = state.opacity;
    ctx.translate(options.x + state.x + state.offsetX, options.y + state.y + state.offsetY);
    ctx.rotate((state.rotation * Math.PI) / 180);
    ctx.scale(state.scale, state.scale);
    ctx.fillText(state.char, 0, 0);
    ctx.restore();
  }
  ctx.restore();
  return states;
}
