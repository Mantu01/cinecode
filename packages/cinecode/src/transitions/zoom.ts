import type { SKRSContext2D } from "@napi-rs/canvas";
import { defineTransition, type TransitionContext, type TransitionProcessor } from "./engine.js";

export type ZoomDirection = "in" | "out";

export function zoomTransition(
  ctx: SKRSContext2D,
  context: TransitionContext,
  direction: ZoomDirection = "out",
  speed = 1,
): void {
  const { progress, from, to, width, height } = context;
  const amount = Math.max(0, speed);
  const fromScale = direction === "out" ? 1 + progress * amount : 1 - progress * amount * 0.5;
  const toScale = direction === "out" ? 1 - progress * amount * 0.5 : 1 + (1 - progress) * amount;
  const alpha = progress;

  ctx.save();
  ctx.globalAlpha = 1 - alpha;
  ctx.translate(width / 2, height / 2);
  ctx.scale(Math.max(0.01, fromScale), Math.max(0.01, fromScale));
  ctx.drawImage(from, -width / 2, -height / 2, width, height);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(width / 2, height / 2);
  ctx.scale(Math.max(0.01, toScale), Math.max(0.01, toScale));
  ctx.drawImage(to, -width / 2, -height / 2, width, height);
  ctx.restore();
}

export const zoomTransitionProcessor: TransitionProcessor = defineTransition({
  name: "zoom",
  params: {
    direction: { default: "out", type: "string" },
    speed: { default: 1, type: "number" },
  },
  process: (ctx, context, params) =>
    zoomTransition(ctx, context, (params.direction as ZoomDirection) ?? "out", params.speed as number),
});

