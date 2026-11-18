import type { EffectProcessor } from "./engine.js";
import { getData, putData, type EffectInput } from "./engine.js";
import { deriveSeed, random, type SeededRandom } from "../core/random/index.js";

export interface GlitchParams {
  intensity?: number;
  sliceCount?: number;
  blockSize?: number;
  chromaSplit?: number;
  rgbShuffle?: boolean;
  seedOffset?: number;
}

interface SliceOp {
  readonly y: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly corrupt: boolean;
  readonly corruptType: "noise" | "copy" | "stretch";
  readonly corruptFromY: number;
  readonly shuffle: boolean;
}

function buildSliceOps(rng: SeededRandom, input: EffectInput, params: ResolvedGlitchParams): readonly SliceOp[] {
  const sliceHeight = Math.max(1, Math.floor(input.height / params.sliceCount));
  const ops: SliceOp[] = [];
  for (let y = 0; y < input.height; y += sliceHeight) {
    const roll = rng.next();
    const offsetX = roll < 0.3 * params.intensity ? Math.round((rng.next() * 2 - 1) * params.intensity * 30) : 0;
    const offsetY = roll < 0.1 * params.intensity ? Math.round((rng.next() * 2 - 1) * params.intensity * 10) : 0;
    const corrupt = roll > 1 - 0.15 * params.intensity;
    const corruptType: SliceOp["corruptType"] = corrupt
      ? (["noise", "copy", "stretch"] as const)[Math.floor(rng.next() * 3)]!
      : "noise";
    const corruptFromY = Math.floor(rng.next() * input.height);
    const shuffle = params.rgbShuffle && roll > 1 - 0.05 * params.intensity;
    ops.push({ y, height: sliceHeight, offsetX, offsetY, corrupt, corruptType, corruptFromY, shuffle });
  }
  return ops;
}

interface ResolvedGlitchParams {
  readonly intensity: number;
  readonly sliceCount: number;
  readonly blockSize: number;
  readonly chromaSplit: number;
  readonly rgbShuffle: boolean;
}

export function glitch(input: EffectInput, params: GlitchParams): void {
  const resolved: ResolvedGlitchParams = {
    intensity: Math.min(1, Math.max(0, params.intensity ?? 0.5)),
    sliceCount: Math.max(1, Math.min(100, Math.round(params.sliceCount ?? 20))),
    blockSize: Math.max(4, Math.min(256, Math.round(params.blockSize ?? 64))),
    chromaSplit: Math.min(1, Math.max(0, params.chromaSplit ?? 0.3)),
    rgbShuffle: params.rgbShuffle ?? true,
  };
  if (resolved.intensity === 0) return;
  const rng: SeededRandom = random(deriveSeed(input.seed, ["effect", "glitch", params.seedOffset ?? 0]));
  const data = getData(input);
  const width = input.width;
  const height = input.height;
  const working = new Uint8ClampedArray(data);

  applySliceDisplacement(working, data, width, height, buildSliceOps(rng, input, resolved));
  applyBlockCorruption(rng, working, width, height, resolved);
  if (resolved.chromaSplit > 0) applyChromaSplit(working, width, height, resolved.chromaSplit);
  putData(input, working);
}

function applySliceDisplacement(
  working: Uint8ClampedArray,
  source: Uint8ClampedArray,
  width: number,
  height: number,
  ops: readonly SliceOp[],
): void {
  for (const op of ops) {
    for (let row = 0; row < op.height && op.y + row < height; row += 1) {
      const srcY = Math.max(0, Math.min(height - 1, op.y + row + op.offsetY));
      for (let x = 0; x < width; x += 1) {
        const srcX = Math.max(0, Math.min(width - 1, x - op.offsetX));
        copyPixel(source, srcX, srcY, working, x, op.y + row, width);
      }
    }
    if (op.shuffle) applyChannelShuffle(working, width, op.y, Math.min(op.height, height - op.y));
  }
}

function applyChannelShuffle(data: Uint8ClampedArray, width: number, yStart: number, rows: number): void {
  for (let row = 0; row < rows; row += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = ((yStart + row) * width + x) * 4;
      const r = data[index]!;
      const g = data[index + 1]!;
      const b = data[index + 2]!;
      data[index] = g;
      data[index + 1] = b;
      data[index + 2] = r;
    }
  }
}

function applyBlockCorruption(rng: SeededRandom, data: Uint8ClampedArray, width: number, height: number, params: ResolvedGlitchParams): void {
  const blockCount = Math.round(params.intensity * 6);
  for (let block = 0; block < blockCount; block += 1) {
    const size = Math.round(params.blockSize * (0.3 + rng.next() * 0.7));
    const x0 = Math.floor(rng.next() * width);
    const y0 = Math.floor(rng.next() * height);
    const type = (["noise", "copy", "stretch"] as const)[Math.floor(rng.next() * 3)]!;
    const fromY = Math.floor(rng.next() * height);
    for (let y = y0; y < Math.min(height, y0 + size); y += 1) {
      for (let x = x0; x < Math.min(width, x0 + size); x += 1) {
        const index = (y * width + x) * 4;
        if (type === "noise") {
          data[index] = rng.next() * 255;
          data[index + 1] = rng.next() * 255;
          data[index + 2] = rng.next() * 255;
        } else if (type === "copy") {
          const srcY = Math.max(0, Math.min(height - 1, fromY + (y - y0)));
          const srcIndex = (srcY * width + x) * 4;
          for (let c = 0; c < 4; c += 1) data[index + c] = data[srcIndex + c]!;
        } else {
          const srcY = Math.max(0, Math.min(height - 1, y0));
          const srcIndex = (srcY * width + x) * 4;
          for (let c = 0; c < 4; c += 1) data[index + c] = data[srcIndex + c]!;
        }
      }
    }
  }
}

function applyChromaSplit(data: Uint8ClampedArray, width: number, height: number, amount: number): void {
  const shift = Math.max(1, Math.round(amount * 6));
  const copy = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const rIndex = (y * width + Math.max(0, Math.min(width - 1, x - shift))) * 4;
      const bIndex = (y * width + Math.max(0, Math.min(width - 1, x + shift))) * 4;
      data[index] = copy[rIndex]!;
      data[index + 2] = copy[bIndex + 2]!;
    }
  }
}

function copyPixel(source: Uint8ClampedArray, srcX: number, srcY: number, dest: Uint8ClampedArray, destX: number, destY: number, width: number): void {
  const srcIndex = (srcY * width + srcX) * 4;
  const destIndex = (destY * width + destX) * 4;
  for (let c = 0; c < 4; c += 1) {
    dest[destIndex + c] = source[srcIndex + c]!;
  }
}

export const glitchEffect: EffectProcessor = {
  name: "glitch",
  apply: (input, params) => {
    glitch(input, {
      intensity: params.intensity as number | undefined,
      sliceCount: params.sliceCount as number | undefined,
      blockSize: params.blockSize as number | undefined,
      chromaSplit: params.chromaSplit as number | undefined,
      rgbShuffle: params.rgbShuffle as boolean | undefined,
      seedOffset: params.seedOffset as number | undefined,
    });
  },
};

