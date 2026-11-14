import type { EffectProcessor } from "./engine.js";
import { registerEffect } from "../extensions/index.js";
import { getData, putData, type EffectInput } from "./engine.js";
import { gaussianBlur } from "./engine.js";

export interface BoxBlurParams {
  radius?: number;
}

function boxBlurPass(data: Uint8ClampedArray, width: number, height: number, radius: number, vertical: boolean): Uint8ClampedArray {
  const output = new Uint8ClampedArray(data.length);
  const windowSize = radius * 2 + 1;
  const outerLength = vertical ? height : width;
  const innerLength = vertical ? width : height;
  const outerStride = vertical ? width * 4 : 4;
  const innerStride = vertical ? 4 : width * 4;
  for (let outer = 0; outer < outerLength; outer += 1) {
    const base = outer * outerStride;
    const sums: number[] = [0, 0, 0, 0];
    for (let inner = -radius; inner <= radius; inner += 1) {
      const clamped = Math.max(0, Math.min(innerLength - 1, inner));
      const index = base + clamped * innerStride;
      for (let c = 0; c < 4; c += 1) sums[c]! += data[index + c]!;
    }
    for (let inner = 0; inner < innerLength; inner += 1) {
      const index = base + inner * innerStride;
      for (let c = 0; c < 4; c += 1) {
        output[index + c] = sums[c]! / windowSize;
      }
      const addInner = Math.min(innerLength - 1, inner + radius + 1);
      const removeInner = Math.max(0, inner - radius);
      const addIndex = base + addInner * innerStride;
      const removeIndex = base + removeInner * innerStride;
      for (let c = 0; c < 4; c += 1) {
        sums[c]! += data[addIndex + c]! - data[removeIndex + c]!;
      }
    }
  }
  return output;
}

export function boxBlur(input: EffectInput, params: BoxBlurParams): void {
  const radius = Math.max(0, Math.min(50, Math.round(params.radius ?? 2)));
  if (radius === 0) return;
  const data = getData(input);
  const horizontal = boxBlurPass(data, input.width, input.height, radius, false);
  const vertical = boxBlurPass(horizontal, input.width, input.height, radius, true);
  putData(input, vertical);
}

export function gaussianBlurEffectFn(input: EffectInput, params: { radius?: number }): void {
  const radius = Math.max(0, Math.min(100, params.radius ?? 5));
  if (radius === 0) return;
  gaussianBlur(input, radius);
}

export const boxBlurEffect: EffectProcessor = {
  name: "box-blur",
  apply: (input, params) => {
    boxBlur(input, { radius: params.radius as number | undefined });
  },
};

export const gaussianBlurEffect: EffectProcessor = {
  name: "gaussian-blur",
  apply: (input, params) => {
    gaussianBlurEffectFn(input, { radius: params.radius as number | undefined });
  },
};

registerEffect(boxBlurEffect);
registerEffect(gaussianBlurEffect);
