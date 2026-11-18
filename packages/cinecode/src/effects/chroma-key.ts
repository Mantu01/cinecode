import type { EffectProcessor } from "./engine.js";
import { getData, putData, type EffectInput } from "./engine.js";
import { parseColor } from "../renderer/color/parse.js";
import { rgbToHsv, hueDifference } from "./hsv.js";

export interface ChromaKeyParams {
  keyColor?: string;
  similarity?: number;
  spillSuppress?: number;
  softness?: number;
}

export function chromaKey(input: EffectInput, params: ChromaKeyParams): void {
  const data = getData(input);
  let keyRgba;
  try {
    keyRgba = parseColor(params.keyColor ?? "#00ff00");
  } catch {
    keyRgba = parseColor("#00ff00");
  }
  const [keyHue] = rgbToHsv(keyRgba.r, keyRgba.g, keyRgba.b);
  const similarity = clamp01(params.similarity ?? 0.35);
  const softness = clamp01(params.softness ?? 0.05);
  const spill = clamp01(params.spillSuppress ?? 0.1);
  const inner = similarity * 180;
  const outer = Math.min(180, inner + softness * 180);

  for (let i = 0; i < data.length; i += 4) {
    const [hue, saturation] = rgbToHsv(data[i]!, data[i + 1]!, data[i + 2]!);
    if (saturation < 0.08) continue;
    const hueDistance = hueDifference(hue, keyHue);
    if (hueDistance <= inner) {
      data[i + 3] = 0;
      continue;
    }
    if (hueDistance > outer) {
      if (spill > 0) {
        suppressSpill(data, i, hue, keyHue, spill);
      }
      continue;
    }
    const feather = (hueDistance - inner) / Math.max(1e-6, outer - inner);
    const alphaFactor = feather * feather * (3 - 2 * feather);
    data[i + 3] = Math.round(data[i + 3]! * alphaFactor);
    if (spill > 0) {
      suppressSpill(data, i, hue, keyHue, spill * (1 - alphaFactor));
    }
  }
  putData(input, data);
}

function suppressSpill(data: Uint8ClampedArray, index: number, hue: number, keyHue: number, amount: number): void {
  const proximity = 1 - hueDifference(hue, keyHue) / 180;
  const strength = clamp01(proximity) * amount;
  if (strength <= 0) return;
  const average = (data[index]! + data[index + 1]! + data[index + 2]!) / 3;
  for (let c = 0; c < 3; c += 1) {
    const channel = data[index + c]!;
    data[index + c] = Math.round(channel + (average - channel) * strength);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export const chromaKeyEffect: EffectProcessor = {
  name: "chroma-key",
  apply: (input, params) => {
    chromaKey(input, {
      keyColor: params.keyColor as string | undefined,
      similarity: params.similarity as number | undefined,
      spillSuppress: params.spillSuppress as number | undefined,
      softness: params.softness as number | undefined,
    });
  },
};

