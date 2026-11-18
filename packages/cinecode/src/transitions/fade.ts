import type { SKRSContext2D } from "@napi-rs/canvas";
import { defineTransition, type TransitionContext, type TransitionProcessor } from "./engine.js";

export function fadeToColor(
  ctx: SKRSContext2D,
  context: TransitionContext,
  color = "#000000",
): void {
  const { progress, from, to, width, height } = context;
  ctx.save();
  if (progress < 0.5) {
    ctx.drawImage(from, 0, 0);
  } else {
    ctx.drawImage(to, 0, 0);
  }
  const alpha = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
  if (alpha > 0) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

export function fadeToBlack(ctx: SKRSContext2D, context: TransitionContext): void {
  fadeToColor(ctx, context, "#000000");
}

export function fadeToWhite(ctx: SKRSContext2D, context: TransitionContext): void {
  fadeToColor(ctx, context, "#ffffff");
}

export const fadeTransition: TransitionProcessor = defineTransition({
  name: "fade",
  params: { color: { default: "#000000", type: "string" } },
  process: (ctx, context, params) => fadeToColor(ctx, context, (params.color as string) ?? "#000000"),
});

export const fadeToWhiteTransition: TransitionProcessor = defineTransition({
  name: "fade-white",
  params: {},
  process: (ctx, context) => fadeToWhite(ctx, context),
});

