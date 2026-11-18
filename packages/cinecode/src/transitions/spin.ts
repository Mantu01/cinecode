import type { SKRSContext2D } from "@napi-rs/canvas";
import { defineTransition, type TransitionContext, type TransitionProcessor } from "./engine.js";

export type SpinDirection = "clockwise" | "counterclockwise";

export function spinTransition(
  ctx: SKRSContext2D,
  context: TransitionContext,
  durationScale = 1,
  direction: SpinDirection = "clockwise",
): void {
  const { progress, from, to, width, height } = context;
  const sign = direction === "clockwise" ? 1 : -1;
  const degrees = 360 * Math.max(0, durationScale);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(sign * progress * degrees * (Math.PI / 180));
  ctx.scale(1 - progress * 0.35, 1 - progress * 0.35);
  ctx.globalAlpha = 1 - progress;
  ctx.drawImage(from, -width / 2, -height / 2, width, height);
  ctx.restore();

  const radius = Math.hypot(width, height) * 0.5 * Math.min(1, progress * 1.15);
  ctx.save();
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-sign * (1 - progress) * degrees * (Math.PI / 180));
  ctx.scale(0.4 + progress * 0.6, 0.4 + progress * 0.6);
  ctx.globalAlpha = Math.min(1, progress * 1.6);
  ctx.drawImage(to, -width / 2, -height / 2, width, height);
  ctx.restore();
}

export const spinTransitionProcessor: TransitionProcessor = defineTransition({
  name: "spin",
  params: {
    durationScale: { default: 1, type: "number" },
    direction: { default: "clockwise", type: "string" },
  },
  process: (ctx, context, params) =>
    spinTransition(
      ctx,
      context,
      params.durationScale as number,
      (params.direction as SpinDirection) ?? "clockwise",
    ),
});

