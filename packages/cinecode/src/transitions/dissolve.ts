import { Canvas } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";
import { defineTransition, type TransitionContext, type TransitionProcessor } from "./engine.js";
import { registerTransition } from "../extensions/index.js";

export interface DissolveOptions {
  readonly mask?: Canvas;
  readonly invert?: boolean;
  readonly softness?: number;
}

function buildLuminanceMask(source: Canvas, width: number, height: number): Canvas {
  const mask = new Canvas(width, height);
  const maskCtx = mask.getContext("2d");
  maskCtx.drawImage(source, 0, 0, width, height);
  const image = maskCtx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
    data[i] = luminance;
    data[i + 1] = luminance;
    data[i + 2] = luminance;
    data[i + 3] = 255;
  }
  maskCtx.putImageData(image, 0, 0);
  return mask;
}

export function dissolveByImage(
  ctx: SKRSContext2D,
  context: TransitionContext,
  options: DissolveOptions = {},
): void {
  const { progress, from, to, width, height } = context;
  const base = options.mask ?? buildLuminanceMask(from, width, height);
  const softness = Math.max(0, options.softness ?? 0);

  const masked = new Canvas(width, height);
  const maskedCtx = masked.getContext("2d");
  maskedCtx.drawImage(to, 0, 0, width, height);
  maskedCtx.globalCompositeOperation = "destination-in";
  maskedCtx.globalAlpha = clamp01(progress);
  maskedCtx.drawImage(base, 0, 0, width, height);
  maskedCtx.globalCompositeOperation = "source-over";
  maskedCtx.globalAlpha = 1;

  if (options.invert === true) {
    const inverted = new Canvas(width, height);
    const invertedCtx = inverted.getContext("2d");
    invertedCtx.drawImage(to, 0, 0, width, height);
    invertedCtx.globalCompositeOperation = "destination-out";
    invertedCtx.globalAlpha = clamp01(progress);
    invertedCtx.drawImage(base, 0, 0, width, height);
    invertedCtx.globalCompositeOperation = "source-over";
    invertedCtx.globalAlpha = 1;
    ctx.save();
    ctx.drawImage(from, 0, 0);
    ctx.globalAlpha = 1 - clamp01(progress);
    ctx.drawImage(inverted, 0, 0);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.drawImage(from, 0, 0);
  if (softness > 0) {
    ctx.globalAlpha = 1 - softness;
    ctx.drawImage(from, 0, 0);
    ctx.globalAlpha = 1;
  }
  ctx.drawImage(masked, 0, 0);
  ctx.restore();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export const dissolveTransition: TransitionProcessor = defineTransition({
  name: "dissolve",
  params: {
    source: { default: "luminance", type: "string" },
    invert: { default: false, type: "boolean" },
    softness: { default: 0, type: "number" },
  },
  process: (ctx, context, params) => {
    dissolveByImage(ctx, context, {
      invert: params.invert as boolean,
      softness: params.softness as number,
    });
  },
});

registerTransition(dissolveTransition);
