import type { MidiDeviceManager } from "./device.js";
import type { MidiMessage } from "./message.js";
import {
  DEFAULT_MIDI_MAPPINGS,
  resolveMidiMapping,
  type MidiMapping,
  type ResolvedMidiValue,
} from "./map.js";

export interface MidiAnimationOptions {
  readonly mappings?: readonly MidiMapping[];
  readonly onUpdate?: (update: ResolvedMidiValue) => void;
}

export class MidiAnimationEngine {
  private readonly device: MidiDeviceManager;
  private readonly mappings: readonly MidiMapping[];
  private readonly onUpdate: ((update: ResolvedMidiValue) => void) | undefined;
  private readonly values = new Map<string, number>();
  private readonly toggles = new Map<string, boolean>();
  private attached = false;

  constructor(device: MidiDeviceManager, options: MidiAnimationOptions = {}) {
    this.device = device;
    this.mappings = options.mappings ?? DEFAULT_MIDI_MAPPINGS;
    this.onUpdate = options.onUpdate;
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    for (const type of ["noteon", "noteoff", "cc", "pitchbend"] as const) {
      this.device.on(type, (message) => this.handle(message));
    }
  }

  detach(): void {
    this.attached = false;
    this.device.removeAllListeners();
  }

  getValue(target: string): number | undefined {
    return this.values.get(target);
  }

  private handle(message: MidiMessage): void {
    const resolved = resolveMidiMapping(message, this.mappings);
    if (!resolved) return;

    let value = resolved.value;
    if (resolved.mode === "toggle") {
      const next = !(this.toggles.get(resolved.target) ?? false);
      this.toggles.set(resolved.target, next);
      value = next ? 1 : 0;
    } else if (resolved.mode === "trigger") {
      value = 1;
    }

    this.values.set(resolved.target, value);
    this.onUpdate?.({ ...resolved, value });
  }
}

export function applyMidiUpdate(target: Record<string, unknown>, path: string, value: number): void {
  const segments = path.split(".").filter(Boolean);
  if (segments.length === 0) return;
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index]!;
    const next = cursor[key];
    if (next === null || typeof next !== "object" || Array.isArray(next)) return;
    cursor = next as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]!] = value;
}
