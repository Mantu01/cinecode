import type { SKRSContext2D } from "@napi-rs/canvas";
import { defineTransition, type TransitionContext, type TransitionProcessor } from "./engine.js";
import { registerTransition } from "../extensions/index.js";

export type DiagonalDirection =
  | "top-left-to-bottom-right"
  | "top-right-to-bottom-left"
  | "bottom-left-to-top-right"
  | "bottom-right-to-top-left";

export function diagonalWipe(
  ctx: SKRSContext2D,
  context: TransitionContext,
  direction: DiagonalDirection = "top-left-to-bottom-right",
): void {
  const { progress, from, to, width, height } = context;
  const edge = Math.max(1, (width + height) * progress);

  ctx.save();
  ctx.drawImage(from, 0, 0);
  ctx.save();
  ctx.beginPath();
  switch (direction) {
    case "top-left-to-bottom-right":
      ctx.moveTo(0, 0);
      ctx.lineTo(edge, 0);
      ctx.lineTo(0, edge);
      break;
    case "top-right-to-bottom-left":
      ctx.moveTo(width, 0);
      ctx.lineTo(width - edge, 0);
      ctx.lineTo(width, edge);
      break;
    case "bottom-left-to-top-right":
      ctx.moveTo(0, height);
      ctx.lineTo(edge, height);
      ctx.lineTo(0, height - edge);
      break;
    case "bottom-right-to-top-left":
      ctx.moveTo(width, height);
      ctx.lineTo(width - edge, height);
      ctx.lineTo(width, height - edge);
      break;
  }
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(to, 0, 0);
  ctx.restore();
  ctx.restore();
}

export function curveWipe(
  ctx: SKRSContext2D,
  context: TransitionContext,
  curveAmount = 0.5,
): void {
  const { progress, from, to, width, height } = context;
  const edge = width * progress;
  const bulge = width * Math.max(-1, Math.min(1, curveAmount)) * 0.4;

  ctx.save();
  ctx.drawImage(from, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(edge, -height);
  ctx.quadraticCurveTo(edge + bulge, height / 2, edge, height * 2);
  ctx.lineTo(width + bulge + 1, height * 2);
  ctx.lineTo(width + bulge + 1, -height);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(to, 0, 0);
  ctx.restore();
  ctx.restore();
}

export const diagonalWipeTransition: TransitionProcessor = defineTransition({
  name: "wipe-diagonal",
  params: { direction: { default: "top-left-to-bottom-right", type: "string" } },
  process: (ctx, context, params) =>
    diagonalWipe(ctx, context, (params.direction as DiagonalDirection) ?? "top-left-to-bottom-right"),
});

export const curveWipeTransition: TransitionProcessor = defineTransition({
  name: "wipe-curve",
  params: { curveAmount: { default: 0.5, type: "number" } },
  process: (ctx, context, params) => curveWipe(ctx, context, params.curveAmount as number),
});

registerTransition(diagonalWipeTransition);
registerTransition(curveWipeTransition);
