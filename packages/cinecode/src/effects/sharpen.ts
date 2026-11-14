import type { EffectProcessor } from "./engine.js";
import { registerEffect } from "../extensions/index.js";
import { getData, putData, type EffectInput } from "./engine.js";

export interface SharpenParams {
  amount?: number;
  radius?: number;
}

const LAPLACIAN_KERNEL: readonly number[] = [0, -1, 0, -1, 4, -1, 0, -1, 0];

function convolveChannel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  channel: number,
  kernel: readonly number[],
  divisor: number,
): Float32Array {
  const output = new Float32Array(width * height);
  const half = 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let ky = -half; ky <= half; ky += 1) {
        for (let kx = -half; kx <= half; kx += 1) {
          const sx = Math.max(0, Math.min(width - 1, x + kx));
          const sy = Math.max(0, Math.min(height - 1, y + ky));
          sum += data[(sy * width + sx) * 4 + channel]! * kernel[(ky + half) * 3 + (kx + half)]!;
        }
      }
      output[y * width + x] = sum / divisor;
    }
  }
  return output;
}

export function sharpen(input: EffectInput, params: SharpenParams): void {
  const amount = params.amount ?? 1;
  if (amount === 0) return;
  const radiusScale = Math.max(0.25, Math.min(4, params.radius ?? 1));
  const data = getData(input);
  const width = input.width;
  const height = input.height;
  const divisor = 4 * radiusScale;

  for (let channel = 0; channel < 4; channel += 1) {
    const laplacian = convolveChannel(data, width, height, channel, LAPLACIAN_KERNEL, divisor);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const index = pixel * 4 + channel;
      data[index] = data[index]! + amount * laplacian[pixel]!;
    }
  }
  putData(input, data);
}

export const sharpenEffect: EffectProcessor = {
  name: "sharpen",
  apply: (input, params) => {
    sharpen(input, {
      amount: params.amount as number | undefined,
      radius: params.radius as number | undefined,
    });
  },
};

registerEffect(sharpenEffect);
