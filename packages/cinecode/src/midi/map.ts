import type { MidiMessage, MidiMessageType } from "./message.js";

export type MidiMappingMode = "continuous" | "toggle" | "trigger";

export interface MidiMapping {
  readonly port?: string;
  readonly messageType: MidiMessageType;
  readonly channel?: number;
  readonly noteOrController?: number;
  readonly target: string;
  readonly minInput?: number;
  readonly maxInput?: number;
  readonly minOutput?: number;
  readonly maxOutput?: number;
  readonly mode?: MidiMappingMode;
}

export interface ResolvedMidiValue {
  readonly target: string;
  readonly value: number;
  readonly mode: MidiMappingMode;
  readonly message: MidiMessage;
}

export function resolveMidiMapping(
  message: MidiMessage,
  mappings: readonly MidiMapping[],
): ResolvedMidiValue | null {
  for (const mapping of mappings) {
    if (mapping.messageType !== message.type) continue;
    if (mapping.port !== undefined && mapping.port !== message.port) continue;
    if (mapping.channel !== undefined && mapping.channel !== message.channel) continue;
    const identifier = message.type === "cc" ? message.controller : message.note;
    if (mapping.noteOrController !== undefined && identifier !== mapping.noteOrController) continue;

    const mode = mapping.mode ?? "continuous";
    if (mode === "trigger" && (message.velocity ?? 0) === 0) continue;
    if (mode === "toggle" && message.type === "noteoff") continue;

    const minInput = mapping.minInput ?? (message.type === "pitchbend" ? -8192 : 0);
    const maxInput = mapping.maxInput ?? (message.type === "pitchbend" ? 8191 : 127);
    const raw = message.type === "pitchbend"
      ? (message.value ?? 0)
      : (message.value ?? message.velocity ?? 0);
    const normalized = maxInput === minInput ? 0 : (raw - minInput) / (maxInput - minInput);
    const minOutput = mapping.minOutput ?? 0;
    const maxOutput = mapping.maxOutput ?? 1;
    const clamped = Math.max(0, Math.min(1, normalized));
    return {
      target: mapping.target,
      value: minOutput + clamped * (maxOutput - minOutput),
      mode,
      message,
    };
  }
  return null;
}

export const DEFAULT_MIDI_MAPPINGS: readonly MidiMapping[] = [
  { messageType: "cc", noteOrController: 1, target: "composition.fps", minOutput: 1, maxOutput: 120, mode: "continuous" },
  { messageType: "cc", noteOrController: 2, target: "composition.audio.masterVolume", minOutput: 0, maxOutput: 1, mode: "continuous" },
  { messageType: "noteon", noteOrController: 48, target: "preview.playing", minOutput: 0, maxOutput: 1, mode: "toggle" },
  { messageType: "pitchbend", target: "composition.camera.rotation", minInput: -8192, maxInput: 8191, minOutput: -180, maxOutput: 180, mode: "continuous" },
];
