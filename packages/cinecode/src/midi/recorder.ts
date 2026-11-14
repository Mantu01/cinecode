import { writeFile } from "node:fs/promises";
import { MidiDeviceManager } from "./device.js";
import type { MidiMessage, MidiMessageType } from "./message.js";

export interface RecordedMidiEvent extends MidiMessage {
  readonly timestampMs: number;
}

export interface MidiRecordingSession {
  readonly deviceName: string;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly ticksPerQuarter: number;
  readonly tempoBpm: number;
  readonly events: readonly RecordedMidiEvent[];
}

export interface MidiRecorderOptions {
  readonly deviceName?: string;
  readonly manager?: MidiDeviceManager;
  readonly tempoBpm?: number;
  readonly ticksPerQuarter?: number;
  readonly quantizeMs?: number;
}

const RECORDED_TYPES: readonly MidiMessageType[] = ["noteon", "noteoff", "cc", "pitchbend", "aftertouch"];

export class MidiRecorder {
  private readonly manager: MidiDeviceManager;
  private readonly options: MidiRecorderOptions;
  private events: RecordedMidiEvent[] = [];
  private startedAtMs = 0;
  private recording = false;
  private attachedHandlers: (() => void)[] = [];

  constructor(options: MidiRecorderOptions = {}) {
    this.options = options;
    this.manager = options.manager ?? new MidiDeviceManager();
  }

  get isRecording(): boolean {
    return this.recording;
  }

  get recordedEvents(): readonly RecordedMidiEvent[] {
    return this.events;
  }

  get elapsedMs(): number {
    return this.recording ? performance.now() - this.startedAtMs : 0;
  }

  async start(deviceName?: string): Promise<boolean> {
    if (this.recording) return true;
    const available = await this.manager.initialize();
    if (!available) return false;
    const target = deviceName ?? this.options.deviceName ?? "*";
    await this.manager.open(target);
    this.events = [];
    this.startedAtMs = performance.now();
    this.recording = true;
    for (const type of RECORDED_TYPES) {
      const handler = (message: MidiMessage): void => this.capture(message);
      this.manager.on(type, handler);
      this.attachedHandlers.push(() => this.manager.off(type, handler));
    }
    return true;
  }

  stop(): MidiRecordingSession {
    const durationMs = this.recording ? performance.now() - this.startedAtMs : 0;
    this.recording = false;
    this.releaseHandlers();
    return {
      deviceName: this.options.deviceName ?? "*",
      startedAtMs: this.startedAtMs,
      durationMs,
      ticksPerQuarter: this.options.ticksPerQuarter ?? 480,
      tempoBpm: this.options.tempoBpm ?? 120,
      events: [...this.events],
    };
  }

  cancel(): void {
    this.recording = false;
    this.events = [];
    this.releaseHandlers();
  }

  inject(message: MidiMessage): void {
    if (!this.recording) return;
    this.capture(message);
  }

  private capture(message: MidiMessage): void {
    if (!this.recording) return;
    const rawTimestamp = performance.now() - this.startedAtMs;
    const quantize = this.options.quantizeMs ?? 0;
    const timestampMs = quantize > 0 ? Math.round(rawTimestamp / quantize) * quantize : rawTimestamp;
    this.events.push({ ...message, timestampMs });
  }

  private releaseHandlers(): void {
    for (const detach of this.attachedHandlers) detach();
    this.attachedHandlers = [];
  }
}

function variableLength(value: number): number[] {
  const bytes = [value & 0x7f];
  let remaining = value >> 7;
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>= 7;
  }
  return bytes;
}

function eventBytes(event: RecordedMidiEvent): number[] {
  const channel = Math.max(1, Math.min(16, event.channel)) - 1;
  switch (event.type) {
    case "noteon":
      return [0x90 | channel, event.note ?? 0, event.velocity ?? 100];
    case "noteoff":
      return [0x80 | channel, event.note ?? 0, event.velocity ?? 0];
    case "cc":
      return [0xb0 | channel, event.controller ?? 0, event.value ?? 0];
    case "pitchbend": {
      const value = Math.max(-8192, Math.min(8191, event.value ?? 0)) + 8192;
      return [0xe0 | channel, value & 0x7f, (value >> 7) & 0x7f];
    }
    case "aftertouch":
      return [0xd0 | channel, Math.max(0, Math.min(127, event.value ?? event.velocity ?? 0))];
    default:
      return [];
  }
}

export function encodeMidiFile(session: MidiRecordingSession): Buffer {
  const microsecondsPerQuarter = Math.round(60000000 / Math.max(1, session.tempoBpm));
  const ticksPerQuarter = Math.max(1, session.ticksPerQuarter);
  const millisecondsPerTick = (microsecondsPerQuarter / 1000) / ticksPerQuarter;
  const sorted = [...session.events].sort((left, right) => left.timestampMs - right.timestampMs);
  const track: number[] = [0x00, 0xff, 0x51, 0x03,
    (microsecondsPerQuarter >> 16) & 0xff,
    (microsecondsPerQuarter >> 8) & 0xff,
    microsecondsPerQuarter & 0xff,
  ];
  let previousTick = 0;
  for (const event of sorted) {
    const tick = Math.max(previousTick, Math.round(event.timestampMs / millisecondsPerTick));
    track.push(...variableLength(tick - previousTick), ...eventBytes(event));
    previousTick = tick;
  }
  track.push(0x00, 0xff, 0x2f, 0x00);

  const header = [
    0x4d, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    (ticksPerQuarter >> 8) & 0xff, ticksPerQuarter & 0xff,
  ];
  const chunkLength = track.length;
  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b,
    (chunkLength >> 24) & 0xff,
    (chunkLength >> 16) & 0xff,
    (chunkLength >> 8) & 0xff,
    chunkLength & 0xff,
  ];
  return Buffer.from([...header, ...trackHeader, ...track]);
}

export async function saveMidiFile(path: string, session: MidiRecordingSession): Promise<void> {
  await writeFile(path, encodeMidiFile(session));
}
