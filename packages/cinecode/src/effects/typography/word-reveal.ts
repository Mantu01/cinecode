import type { SKRSContext2D } from "@napi-rs/canvas";

export type WordRevealDirection = "none" | "top" | "bottom" | "left" | "right";

export interface WordRevealParams {
  readonly direction?: WordRevealDirection;
  readonly highlightColor?: string;
  readonly highlightDuration?: number;
  readonly stagger?: number;
  readonly duration?: number;
  readonly slideDistance?: number;
}

export interface WordRevealState {
  readonly word: string;
  readonly index: number;
  readonly visible: boolean;
  readonly opacity: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly highlighted: boolean;
}

export function evaluateWordReveal(
  words: readonly string[],
  timeSeconds: number,
  params: WordRevealParams = {},
): readonly WordRevealState[] {
  const stagger = Math.max(0.01, params.stagger ?? 0.12);
  const duration = Math.max(0.01, params.duration ?? 0.35);
  const highlightDuration = Math.max(0, params.highlightDuration ?? 0.4);
  const distance = params.slideDistance ?? 30;
  const direction = params.direction ?? "bottom";

  return words.map((word, index) => {
    const start = index * stagger;
    const progress = Math.max(0, Math.min(1, (timeSeconds - start) / duration));
    const sinceReveal = timeSeconds - start;
    let offsetX = 0;
    let offsetY = 0;
    if (direction === "left") offsetX = -distance * (1 - progress);
    if (direction === "right") offsetX = distance * (1 - progress);
    if (direction === "top") offsetY = -distance * (1 - progress);
    if (direction === "bottom") offsetY = distance * (1 - progress);
    return {
      word,
      index,
      visible: progress > 0,
      opacity: progress,
      offsetX,
      offsetY,
      highlighted: sinceReveal >= 0 && sinceReveal <= highlightDuration,
    };
  });
}

export interface WordRevealDrawOptions extends WordRevealParams {
  readonly x: number;
  readonly y: number;
  readonly font?: string;
  readonly fillStyle?: string;
  readonly highlightBackground?: string;
  readonly highlightTextColor?: string;
  readonly wordSpacing?: number;
}

export function drawWordReveal(
  ctx: SKRSContext2D,
  text: string,
  timeSeconds: number,
  options: WordRevealDrawOptions,
): readonly WordRevealState[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const states = evaluateWordReveal(words, timeSeconds, options);
  ctx.save();
  ctx.font = options.font ?? "40px sans-serif";
  ctx.textBaseline = "alphabetic";
  let cursorX = options.x;
  const spacing = options.wordSpacing ?? ctx.measureText(" ").width;

  for (const state of states) {
    const width = ctx.measureText(state.word).width;
    if (state.visible) {
      ctx.globalAlpha = state.opacity;
      if (state.highlighted && options.highlightBackground) {
        ctx.fillStyle = options.highlightBackground;
        const padding = 6;
        ctx.fillRect(cursorX + state.offsetX - padding, options.y - 34 + state.offsetY, width + padding * 2, 46);
      }
      ctx.fillStyle = state.highlighted
        ? (options.highlightTextColor ?? options.highlightColor ?? options.fillStyle ?? "#ffffff")
        : (options.fillStyle ?? "#ffffff");
      ctx.fillText(state.word, cursorX + state.offsetX, options.y + state.offsetY);
      ctx.globalAlpha = 1;
    }
    cursorX += width + spacing;
  }
  ctx.restore();
  return states;
}
