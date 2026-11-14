export type MidiMessageType = "noteon" | "noteoff" | "cc" | "pitchbend" | "aftertouch";

export interface MidiMessage {
  readonly type: MidiMessageType;
  readonly channel: number;
  readonly note?: number;
  readonly velocity?: number;
  readonly controller?: number;
  readonly value?: number;
  readonly port?: string;
  readonly timestamp?: number;
}

export interface MidiInputInfo {
  readonly name: string;
  readonly manufacturer?: string;
  readonly connected: boolean;
}

export function parseMidiBytes(bytes: readonly number[], port?: string): MidiMessage | null {
  if (bytes.length < 3) return null;
  const status = bytes[0]!;
  const command = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const data1 = bytes[1]!;
  const data2 = bytes[2]!;
  switch (command) {
    case 0x90:
      return data2 === 0
        ? { type: "noteoff", channel, note: data1, velocity: 0, port }
        : { type: "noteon", channel, note: data1, velocity: data2, port };
    case 0x80:
      return { type: "noteoff", channel, note: data1, velocity: data2, port };
    case 0xb0:
      return { type: "cc", channel, controller: data1, value: data2, port };
    case 0xe0: {
      const value = ((data2 << 7) | data1) - 8192;
      return { type: "pitchbend", channel, value, port };
    }
    case 0xd0:
      return { type: "aftertouch", channel, value: data1, port };
    default:
      return null;
  }
}
