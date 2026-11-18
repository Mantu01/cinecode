import type { AudioBuffer } from "../types.js";
import type { AudioProcessorExtension } from "../../extensions/registry.js";
import { reverbEffect, type ReverbParams } from "./effect.js";
import { chamber, hall, plate, roomSmall, spring } from "./synthesize.js";

export const PRESET_IRS: Readonly<Record<string, () => Float32Array>> = {
  "room-small": () => roomSmall(0.8, 48000),
  hall: () => hall(2.5, 48000),
  plate: () => plate(1.8, 48000),
  chamber: () => chamber(2.2, 48000),
  spring: () => spring(1.2, 48000),
};

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
