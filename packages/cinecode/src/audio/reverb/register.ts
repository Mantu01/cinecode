import type { AudioBuffer } from "../types.js";
import { registerAudioProcessor, type AudioProcessorExtension } from "../../extensions/index.js";
import { reverbEffect, type ReverbParams } from "./effect.js";

export function processReverb(
  buffer: AudioBuffer,
  params: Readonly<Record<string, unknown>>,
): AudioBuffer {
  return reverbEffect(buffer, params as ReverbParams);
}

export const reverbProcessor: AudioProcessorExtension = {
  name: "reverb",
  process: (buffer, params) => processReverb(buffer, params),
};

registerAudioProcessor(reverbProcessor);
