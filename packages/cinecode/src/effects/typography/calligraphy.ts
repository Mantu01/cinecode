import type { SKRSContext2D } from "@napi-rs/canvas";
import { noise2d } from "../../core/random/index.js";
import { layoutLetters, type LetterLayout } from "./letter-scatter.js";

export interface CalligraphyParams {
  readonly strokeSpeed?: number;
  readonly strokeWidth?: number;
  readonly inkColor?: string;
  readonly pressureVariation?: number;
  readonly bleed?: number;
  readonly seed?: number;
}

export interface CalligraphyCharState extends LetterLayout {
  readonly index: number;
  readonly progress: number;
  readonly revealWidth: number;
  readonly pressure: number;
  readonly bleedAlpha: number;
}

export function evaluateCalligraphy(
  layout: readonly LetterLayout[],
  timeSeconds: number,
  params: CalligraphyParams = {},
): readonly CalligraphyCharState[] {
  const strokeSpeed = Math.max(1, params.strokeSpeed ?? 120);
  const pressureVariation = Math.max(0, Math.min(1, params.pressureVariation ?? 0.3));
  const bleed = Math.max(0, Math.min(1, params.bleed ?? 0.2));
  const seed = params.seed ?? 5;
  let cursorTime = 0;

  return layout.map((letter, index) => {
    const duration = Math.max(0.02, letter.width / strokeSpeed);
    const progress = Math.max(0, Math.min(1, (timeSeconds - cursorTime) / duration));
    cursorTime += duration;
    const pressureNoise = noise2d(seed + index, index * 0.4, 0.5) * 2 - 1;
    return {
      ...letter,
      index,
      progress,
      revealWidth: letter.width * progress,
      pressure: 1 + pressureNoise * pressureVariation,
      bleedAlpha: 1 - bleed * 0.4 + noise2d(seed + 31, index, timeSeconds) * bleed * 0.4,
    };
  });
}

export interface CalligraphyDrawOptions extends CalligraphyParams {
  readonly x: number;
  readonly y: number;
  readonly font?: string;
  readonly fontSize?: number;
  readonly letterSpacing?: number;
}

export function drawCalligraphy(
  ctx: SKRSContext2D,
  text: string,
  timeSeconds: number,
  options: CalligraphyDrawOptions,
): readonly CalligraphyCharState[] {
  const layout = layoutLetters(ctx, text, { font: options.font, letterSpacing: options.letterSpacing });
  const states = evaluateCalligraphy(layout, timeSeconds, options);
  const fontSize = options.fontSize ?? 64;
  const strokeWidth = options.strokeWidth ?? 3;
  const ink = options.inkColor ?? "#1a1a1a";

  ctx.save();
  ctx.font = options.font ?? `${fontSize}px serif`;
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.textBaseline = "alphabetic";

  for (const state of states) {
    if (state.progress <= 0) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(options.x + state.x - 2, options.y - fontSize * 1.2, state.revealWidth + 4, fontSize * 1.5);
    ctx.clip();
    ctx.globalAlpha = Math.min(1, state.bleedAlpha);
    ctx.lineWidth = Math.max(0.5, strokeWidth * state.pressure);
    ctx.strokeText(state.char, options.x + state.x, options.y);
    ctx.fillText(state.char, options.x + state.x, options.y);
    ctx.restore();
  }
  ctx.restore();
  return states;
}
