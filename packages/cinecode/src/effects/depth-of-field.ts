import { Canvas } from "@napi-rs/canvas";
import type { EffectInput, EffectProcessor } from "./engine.js";
import { defineEffect, getTempCanvas } from "./engine.js";
import { registerEffect } from "../extensions/index.js";
import { calculateCoC, type DepthBuffer } from "../model-3d/depth-pass.js";

export type BokehShape = "circular" | "hexagonal" | "octagonal";

export interface DepthOfFieldParams {
  focusDistance?: number;
  aperture?: number;
  fStop?: number;
  focalLength?: number;
  bokehShape?: BokehShape;
  depthMap?: Canvas;
  depthBuffer?: Float32Array | DepthBuffer;
  near?: number;
  far?: number;
}

export function depthOfField(input: EffectInput, params: DepthOfFieldParams): void {
  const { width, height } = input;
  const focusDistance = params.focusDistance ?? 0.5;
  const aperture = params.aperture ?? 10;

  if (params.depthBuffer) {
    applyDepthBufferDof(input, params.depthBuffer, focusDistance, aperture, params);
  } else if (params.depthMap) {
    applyDepthMapDof(input, params.depthMap, focusDistance, aperture, params);
  } else {
    applyParametricDof(input, focusDistance, aperture);
  }
}

function applyParametricDof(input: EffectInput, focusDist: number, aperture: number): void {
  const { width, height } = input;
  const tmp = getTempCanvas(width, height);
  const tmpCtx = tmp.getContext("2d");
  tmpCtx.filter = `blur(${aperture}px)`;
  tmpCtx.drawImage(input.canvas, 0, 0);
  tmpCtx.filter = "none";

  const blurredData = tmpCtx.getImageData(0, 0, width, height).data;
  const inputData = input.ctx.getImageData(0, 0, width, height);

  const cx = width * 0.5;
  const cy = height * 0.5;
  const maxR = Math.hypot(cx, cy) || 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = Math.hypot(x - cx, y - cy) / maxR;
      const alpha = Math.max(0, Math.min(1, 1 - Math.abs(r - focusDist) * 2));
      const idx = (y * width + x) * 4;
      inputData.data[idx] = Math.round(blurredData[idx]! * (1 - alpha) + inputData.data[idx]! * alpha);
      inputData.data[idx + 1] = Math.round(blurredData[idx + 1]! * (1 - alpha) + inputData.data[idx + 1]! * alpha);
      inputData.data[idx + 2] = Math.round(blurredData[idx + 2]! * (1 - alpha) + inputData.data[idx + 2]! * alpha);
    }
  }

  input.ctx.putImageData(inputData, 0, 0);
}

function applyDepthBufferDof(
  input: EffectInput,
  buffer: Float32Array | DepthBuffer,
  focusDist: number,
  aperture: number,
  params: DepthOfFieldParams,
): void {
  const data = buffer instanceof Float32Array ? buffer : buffer.data;
  const { width, height } = input;
  const inputData = input.ctx.getImageData(0, 0, width, height);
  const tmp = getTempCanvas(width, height);
  const tmpCtx = tmp.getContext("2d");
  tmpCtx.filter = `blur(${aperture}px)`;
  tmpCtx.drawImage(input.canvas, 0, 0);
  tmpCtx.filter = "none";
  const blurredData = tmpCtx.getImageData(0, 0, width, height).data;

  const fStop = params.fStop ?? 2.8;
  const focalLength = params.focalLength ?? 0.05;

  for (let i = 0; i < width * height; i += 1) {
    const depth = data[i] ?? 1.0;
    const coc = calculateCoC(depth, focusDist, focalLength, fStop);
    const blurAmount = Math.min(1, coc * 200);
    const alpha = 1 - blurAmount;
    const idx = i * 4;
    inputData.data[idx] = Math.round(blurredData[idx]! * (1 - alpha) + inputData.data[idx]! * alpha);
    inputData.data[idx + 1] = Math.round(blurredData[idx + 1]! * (1 - alpha) + inputData.data[idx + 1]! * alpha);
    inputData.data[idx + 2] = Math.round(blurredData[idx + 2]! * (1 - alpha) + inputData.data[idx + 2]! * alpha);
  }

  input.ctx.putImageData(inputData, 0, 0);
}

function applyDepthMapDof(
  input: EffectInput,
  depthMap: Canvas,
  focusDist: number,
  aperture: number,
  params: DepthOfFieldParams,
): void {
  const { width, height } = input;
  const depthCtx = depthMap.getContext("2d");
  const depthData = depthCtx.getImageData(0, 0, width, height).data;
  const inputData = input.ctx.getImageData(0, 0, width, height);

  const tmp = getTempCanvas(width, height);
  const tmpCtx = tmp.getContext("2d");
  tmpCtx.filter = `blur(${aperture}px)`;
  tmpCtx.drawImage(input.canvas, 0, 0);
  tmpCtx.filter = "none";
  const blurredData = tmpCtx.getImageData(0, 0, width, height).data;

  const fStop = params.fStop;
  const focalLength = params.focalLength ?? 0.05;

  for (let i = 0; i < width * height; i++) {
    const depth = depthData[i * 4]! / 255;
    let alpha: number;
    if (fStop !== undefined) {
      const coc = calculateCoC(depth, focusDist, focalLength, fStop);
      alpha = Math.max(0, Math.min(1, 1 - coc * 200));
    } else {
      const sharpness = 1 - Math.abs(depth - focusDist) * 2;
      alpha = Math.max(0, Math.min(1, sharpness));
    }

    const idx = i * 4;
    inputData.data[idx] = Math.round(blurredData[idx]! * (1 - alpha) + inputData.data[idx]! * alpha);
    inputData.data[idx + 1] = Math.round(blurredData[idx + 1]! * (1 - alpha) + inputData.data[idx + 1]! * alpha);
    inputData.data[idx + 2] = Math.round(blurredData[idx + 2]! * (1 - alpha) + inputData.data[idx + 2]! * alpha);
  }

  input.ctx.putImageData(inputData, 0, 0);
}

export const depthOfFieldEffect: EffectProcessor = defineEffect({
  name: "depth-of-field",
  params: {
    focusDistance: { default: 0.5, type: "number" },
    aperture: { default: 10, type: "number" },
  },
  process: (input, params) => {
    depthOfField(input, {
      focusDistance: params.focusDistance as number,
      aperture: params.aperture as number,
    });
  },
});

registerEffect(depthOfFieldEffect);
