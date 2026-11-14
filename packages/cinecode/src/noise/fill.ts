import type { Canvas } from "@napi-rs/canvas";
import type { NoiseClip } from "../core/types/clips.js";
import { generateNoiseTexture, type NoiseTextureParams } from "./generator.js";

export type NoiseFillParams = Omit<NoiseClip["params"], never> & { time?: number };

export function makeNoiseFill(params: NoiseFillParams, width: number, height: number, time: number = 0): Canvas {
  const textureParams: NoiseTextureParams = { ...params, time };
  return generateNoiseTexture(width, height, textureParams);
}
