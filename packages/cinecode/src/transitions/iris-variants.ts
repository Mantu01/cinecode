import type { SKRSContext2D } from "@napi-rs/canvas";
import { defineTransition, type TransitionContext, type TransitionProcessor } from "./engine.js";
import { registerTransition } from "../extensions/index.js";

export type IrisShape = "circle" | "rect";

export interface IrisOptions {
  readonly shape?: IrisShape;
  readonly centerX?: number;
  readonly centerY?: number;
  readonly softness?: number;
}

function aperturePath(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  openness: number,
  options: IrisOptions,
): void {
  const cx = options.centerX ?? width / 2;
  const cy = options.centerY ?? height / 2;
  const amount = Math.max(0, Math.min(1, openness));
  ctx.beginPath();
  if (options.shape === "rect") {
    const rectWidth = width * amount;
    const rectHeight = height * amount;
    ctx.rect(cx - rectWidth / 2, cy - rectHeight / 2, rectWidth, rectHeight);
    return;
  }
  const maxRadius = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));
  ctx.arc(cx, cy, amount * maxRadius, 0, Math.PI * 2);
}

export function irisOpen(
  ctx: SKRSContext2D,
  context: TransitionContext,
  options: IrisOptions = {},
): void {
  const { progress, from, to, width, height } = context;
  ctx.save();
  ctx.drawImage(progress <= 0 ? from : to, 0, 0);
  if (progress <= 0) {
    ctx.restore();
    return;
  }
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  aperturePath(ctx, width, height, progress, options);
  ctx.clip();
  ctx.drawImage(to, 0, 0);
  ctx.restore();
  ctx.restore();
}

export function irisClose(
  ctx: SKRSContext2D,
  context: TransitionContext,
  options: IrisOptions = {},
): void {
  const { progress, from, to, width, height } = context;
  ctx.save();
  ctx.drawImage(progress >= 1 ? to : from, 0, 0);
  if (progress <= 0) {
    ctx.restore();
    return;
  }
  ctx.save();
  aperturePath(ctx, width, height, progress, options);
  ctx.clip();
  ctx.drawImage(to, 0, 0);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  aperturePath(ctx, width, height, progress, options);
  ctx.fillStyle = "#000000";
  ctx.fill("evenodd");
  ctx.restore();
  ctx.restore();
}

export const irisOpenTransition: TransitionProcessor = defineTransition({
  name: "iris-open",
  params: {
    shape: { default: "circle", type: "string" },
    softness: { default: 0, type: "number" },
  },
  process: (ctx, context, params) =>
    irisOpen(ctx, context, {
      shape: (params.shape as IrisShape) ?? "circle",
      softness: params.softness as number,
      centerX: params.centerX as number | undefined,
      centerY: params.centerY as number | undefined,
    }),
});

export const irisCloseTransition: TransitionProcessor = defineTransition({
  name: "iris-close",
  params: {
    shape: { default: "circle", type: "string" },
    softness: { default: 0, type: "number" },
  },
  process: (ctx, context, params) =>
    irisClose(ctx, context, {
      shape: (params.shape as IrisShape) ?? "circle",
      softness: params.softness as number,
      centerX: params.centerX as number | undefined,
      centerY: params.centerY as number | undefined,
    }),
});

registerTransition(irisOpenTransition);
registerTransition(irisCloseTransition);
