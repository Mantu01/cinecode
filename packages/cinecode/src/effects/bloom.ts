import { Canvas } from "@napi-rs/canvas";
import type { EffectInput, EffectProcessor } from "./engine.js";
import { defineEffect, getData, putData } from "./engine.js";
import { gaussianBlur } from "./engine.js";

export interface BloomParams {
  threshold?: number;
  intensity?: number;
  blurRadius?: number;
}

export function bloom(input: EffectInput, params: BloomParams): void {
  const { width, height } = input;
  const threshold = (params.threshold ?? 0.8) * 255;
  const intensity = params.intensity ?? 0.5;
  const blurRadius = params.blurRadius ?? 30;

  const brightCanvas = new Canvas(width, height);
  const brightCtx = brightCanvas.getContext("2d");
  brightCtx.drawImage(input.canvas, 0, 0);
  const brightData = getData({ ...input, canvas: brightCanvas, ctx: brightCtx });

  for (let i = 0; i < brightData.length; i += 4) {
    const lum = (brightData[i]! + brightData[i + 1]! + brightData[i + 2]!) / 3;
    if (lum < threshold) {
      brightData[i] = brightData[i + 1] = brightData[i + 2] = 0;
    }
  }
  putData({ ...input, canvas: brightCanvas, ctx: brightCtx }, brightData);

  gaussianBlur({ canvas: brightCanvas, ctx: brightCtx, width, height, time: input.time, seed: input.seed }, blurRadius);

  input.ctx.save();
  input.ctx.globalCompositeOperation = "lighter";
  input.ctx.globalAlpha = intensity;
  input.ctx.drawImage(brightCanvas, 0, 0);
  input.ctx.globalCompositeOperation = "source-over";
  input.ctx.globalAlpha = 1;
  input.ctx.restore();
}

export const bloomEffect: EffectProcessor = defineEffect({
  name: "bloom",
  params: {
    threshold: { default: 0.8, type: "number" },
    intensity: { default: 0.5, type: "number" },
    blurRadius: { default: 30, type: "number" },
  },
  process: (input, params) => {
    bloom(input, {
      threshold: params.threshold as number,
      intensity: params.intensity as number,
      blurRadius: params.blurRadius as number,
    });
  },
});

