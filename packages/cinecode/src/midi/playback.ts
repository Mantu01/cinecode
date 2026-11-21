import { readFile } from "node:fs/promises";
import type { Keyframe } from "../core/keyframes/types.js";
import type { MidiMessage, MidiMessageType } from "./message.js";
import { resolveMidiMapping, type MidiMapping } from "./map.js";
import type { MidiDeviceManager } from "./device.js";
import { recordDegradation } from "../errors/degradations.js";

export interface ParsedMidiEvent {
  readonly tick: number;
  readonly timeSeconds: number;
  readonly type: MidiMessageType;
  readonly channel: number;
  readonly note?: number;
  readonly velocity?: number;
  readonly controller?: number;
  readonly value?: number;
}

export interface ParsedMidiFile {
  readonly format: number;
  readonly ticksPerQuarter: number;
  readonly durationSeconds: number;
  readonly initialTempoBpm: number;
  readonly events: readonly ParsedMidiEvent[];
}

class MidiReader {
  private offset = 0;
  constructor(private readonly buffer: Buffer) {}

  get remaining(): number {
    return this.buffer.length - this.offset;
  }

  readUInt8(): number {
    const value = this.buffer[this.offset] ?? 0;
    this.offset += 1;
    return value;
  }

  readUInt16(): number {
    return (this.readUInt8() << 8) | this.readUInt8();
  }

  readUInt32(): number {
    return ((this.readUInt8() << 24) | (this.readUInt8() << 16) | (this.readUInt8() << 8) | this.readUInt8()) >>> 0;
  }

  readString(length: number): string {
    const value = this.buffer.toString("latin1", this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  skip(length: number): void {
    this.offset += length;
  }

  readVariableLength(): number {
    let value = 0;
    for (let index = 0; index < 4; index += 1) {
      const byte = this.readUInt8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    return value;
  }

  get position(): number {
    return this.offset;
  }

  set position(value: number) {
    this.offset = value;
  }
}

interface RawEvent {
  readonly tick: number;
  readonly type: MidiMessageType;
  readonly channel: number;
  readonly data1: number;
  readonly data2: number;
}

interface TempoChange {
  readonly tick: number;
  readonly microsecondsPerQuarter: number;
}

export function parseMidiFile(source: Buffer | Uint8Array): ParsedMidiFile {
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const reader = new MidiReader(buffer);
  if (reader.readString(4) !== "MThd") throw new Error("CC5501: Not a MIDI file (missing MThd header)");
  const headerLength = reader.readUInt32();
  const headerEnd = reader.position + headerLength;
  const format = reader.readUInt16();
  const trackCount = reader.readUInt16();
  const division = reader.readUInt16();
  reader.position = headerEnd;

  const ticksPerQuarter = division & 0x8000 ? 960 : Math.max(1, division);
  const rawEvents: RawEvent[] = [];
  const tempoChanges: TempoChange[] = [];
  let trackIndex = 0;

  while (reader.remaining >= 8 && trackIndex < trackCount) {
    const chunkType = reader.readString(4);
    const chunkLength = reader.readUInt32();
    const chunkEnd = reader.position + chunkLength;
    trackIndex += 1;
    if (chunkType !== "MTrk") {
      reader.position = chunkEnd;
      continue;
    }

    let tick = 0;
    let runningStatus = 0;
    while (reader.position < chunkEnd) {
      tick += reader.readVariableLength();
      const statusByte = buffer[reader.position] ?? 0;
      if (statusByte === 0xff) {
        reader.readUInt8();
        const metaType = reader.readUInt8();
        const length = reader.readVariableLength();
        if (metaType === 0x51 && length === 3) {
          const microsecondsPerQuarter = (reader.readUInt8() << 16) | (reader.readUInt8() << 8) | reader.readUInt8();
          tempoChanges.push({ tick, microsecondsPerQuarter });
        } else if (metaType === 0x2f) {
          reader.skip(length);
          break;
        } else {
          reader.skip(length);
        }
        continue;
      }
      if (statusByte === 0xf0 || statusByte === 0xf7) {
        reader.readUInt8();
        const length = reader.readVariableLength();
        reader.skip(length);
        continue;
      }

      let status = statusByte;
      if (status & 0x80) {
        reader.readUInt8();
        runningStatus = status;
      } else {
        status = runningStatus;
      }
      if (status === 0) continue;

      const command = status & 0xf0;
      const channel = (status & 0x0f) + 1;
      const data1 = reader.readUInt8();
      const needsSecondByte = command !== 0xc0 && command !== 0xd0;
      const data2 = needsSecondByte ? reader.readUInt8() : 0;

      switch (command) {
        case 0x80:
          rawEvents.push({ tick, type: "noteoff", channel, data1, data2 });
          break;
        case 0x90:
          rawEvents.push({ tick, type: data2 === 0 ? "noteoff" : "noteon", channel, data1, data2 });
          break;
        case 0xa0:
          rawEvents.push({ tick, type: "aftertouch", channel, data1, data2 });
          break;
        case 0xb0:
          rawEvents.push({ tick, type: "cc", channel, data1, data2 });
          break;
        case 0xd0:
          rawEvents.push({ tick, type: "aftertouch", channel, data1, data2: data1 });
          break;
        case 0xe0: {
          const value = ((data2 << 7) | data1) - 8192;
          rawEvents.push({ tick, type: "pitchbend", channel, data1: value & 0x7f, data2: value });
          break;
        }
        default:
          break;
      }
    }
    reader.position = chunkEnd;
  }

  tempoChanges.sort((left, right) => left.tick - right.tick);
  const defaultTempo = 500000;
  const initialTempo = tempoChanges.find((change) => change.tick === 0)?.microsecondsPerQuarter ?? defaultTempo;

  const tickToSeconds = (tick: number): number => {
    let seconds = 0;
    let previousTick = 0;
    let tempo = defaultTempo;
    for (const change of tempoChanges) {
      if (change.tick >= tick) break;
      seconds += ((change.tick - previousTick) / ticksPerQuarter) * (tempo / 1_000_000);
      previousTick = change.tick;
      tempo = change.microsecondsPerQuarter;
    }
    seconds += ((tick - previousTick) / ticksPerQuarter) * (tempo / 1_000_000);
    return seconds;
  };

  const events: ParsedMidiEvent[] = rawEvents
    .sort((left, right) => left.tick - right.tick)
    .map((event) => ({
      tick: event.tick,
      timeSeconds: tickToSeconds(event.tick),
      type: event.type,
      channel: event.channel,
      note: event.type === "cc" ? undefined : event.type === "pitchbend" ? undefined : event.data1,
      velocity: event.type === "noteon" || event.type === "noteoff" ? event.data2 : undefined,
      controller: event.type === "cc" ? event.data1 : undefined,
      value: event.type === "pitchbend" ? event.data2 : event.type === "cc" ? event.data2 : event.type === "aftertouch" ? event.data2 : undefined,
    }));

  const durationSeconds = events.reduce((maximum, event) => Math.max(maximum, event.timeSeconds), 0);
  return {
    format,
    ticksPerQuarter,
    durationSeconds,
    initialTempoBpm: 60_000_000 / initialTempo,
    events,
  };
}

export async function loadMidiFile(path: string): Promise<ParsedMidiFile> {
  return parseMidiFile(await readFile(path));
}

export interface MidiTransportSync {
  getCurrentFrameTime(): number;
  getFps(): number;
}

const DRIFT_WARN_MS = 5;
const DRIFT_WINDOW_SECONDS = 10;
const DEFAULT_SYNC_FPS = 30;

function toMidiMessage(event: ParsedMidiEvent, port?: string): MidiMessage {
  return {
    type: event.type,
    channel: event.channel,
    note: event.note,
    velocity: event.velocity,
    controller: event.controller,
    value: event.value,
    port,
    timestamp: event.timeSeconds,
  };
}

export interface MidiKeyframeOptions {
  readonly triggerHoldSeconds?: number;
  readonly interpolation?: "linear" | "hold" | "step";
}

export function midiEventsToKeyframes(
  events: readonly ParsedMidiEvent[],
  mappings: readonly MidiMapping[],
  options: MidiKeyframeOptions = {},
): Readonly<Record<string, readonly Keyframe[]>> {
  const holdSeconds = Math.max(0.01, options.triggerHoldSeconds ?? 0.1);
  const result: Record<string, Keyframe[]> = {};
  const append = (target: string, keyframe: Keyframe): void => {
    const list = result[target] ?? [];
    list.push(keyframe);
    result[target] = list;
  };

  for (const event of events) {
    const message = toMidiMessage(event);
    const resolved = resolveMidiMapping(message, mappings);
    if (!resolved) continue;
    const interpolation = options.interpolation ?? (resolved.mode === "continuous" ? "linear" : "hold");
    if (resolved.mode === "trigger") {
      append(resolved.target, { at: event.timeSeconds, value: resolved.value, interpolation: "hold" });
      append(resolved.target, { at: event.timeSeconds + holdSeconds, value: 0, interpolation: "hold" });
    } else if (resolved.mode === "toggle" && message.type === "noteon") {
      append(resolved.target, { at: event.timeSeconds, value: 1, interpolation: "step" });
      append(resolved.target, { at: event.timeSeconds + holdSeconds, value: 0, interpolation: "step" });
    } else {
      append(resolved.target, { at: event.timeSeconds, value: resolved.value, interpolation });
    }
  }

  for (const target of Object.keys(result)) {
    result[target] = result[target]!.sort((left, right) => Number(left.at) - Number(right.at));
  }
  return result;
}

export class MidiPlayback {
  private readonly file: ParsedMidiFile;
  private readonly transport: MidiTransportSync | undefined;
  private cursor = 0;
  private syncCursor = 0;
  private driftAccumMs = 0;
  private driftWindowStart = -1;

  constructor(file: ParsedMidiFile, transport?: MidiTransportSync) {
    this.file = file;
    this.transport = transport;
  }

  get durationSeconds(): number {
    return this.file.durationSeconds;
  }

  get events(): readonly ParsedMidiEvent[] {
    return this.file.events;
  }

  reset(): void {
    this.cursor = 0;
    this.syncCursor = 0;
    this.driftAccumMs = 0;
    this.driftWindowStart = -1;
  }

  eventsUntil(timeSeconds: number): readonly ParsedMidiEvent[] {
    const emitted: ParsedMidiEvent[] = [];
    while (this.cursor < this.file.events.length) {
      const event = this.file.events[this.cursor]!;
      if (event.timeSeconds > timeSeconds) break;
      emitted.push(event);
      this.cursor += 1;
    }
    return emitted;
  }

  eventsBetween(startSeconds: number, endSeconds: number): readonly ParsedMidiEvent[] {
    return this.file.events.filter((event) => event.timeSeconds >= startSeconds && event.timeSeconds <= endSeconds);
  }

  /**
   * Advances playback to the transport's current frame time. Events snap to the
   * nearest frame boundary with a 1-frame lookahead so scheduling never
   * underruns; warns when accumulated quantization drift exceeds 5ms in a
   * 10-second window.
   */
  syncFrame(currentFrameTime?: number): readonly ParsedMidiEvent[] {
    if (!this.transport && currentFrameTime === undefined) return [];
    const fps = this.transport ? Math.max(1, this.transport.getFps()) : DEFAULT_SYNC_FPS;
    const raw = currentFrameTime ?? this.transport!.getCurrentFrameTime();
    const snapped = Math.round(raw * fps) / fps;
    const lookahead = 1 / fps;
    const emitted: ParsedMidiEvent[] = [];
    while (this.syncCursor < this.file.events.length) {
      const event = this.file.events[this.syncCursor]!;
      if (event.timeSeconds > snapped + lookahead) break;
      emitted.push(event);
      this.syncCursor += 1;
    }
    this.trackDrift(raw, snapped);
    return emitted;
  }

  private trackDrift(raw: number, snapped: number): void {
    if (this.driftWindowStart < 0) this.driftWindowStart = raw;
    if (Math.abs(raw - this.driftWindowStart) >= DRIFT_WINDOW_SECONDS) {
      if (this.driftAccumMs > DRIFT_WARN_MS) {
        recordDegradation({
          code: "CC5001",
          what: "MIDI transport drift",
          reason: `MIDI transport drift ${this.driftAccumMs.toFixed(2)}ms exceeded ${DRIFT_WARN_MS}ms over ${DRIFT_WINDOW_SECONDS}s`,
          instead: "snapped timestamp used",
        });
      }
      this.driftWindowStart = raw;
      this.driftAccumMs = 0;
    }
    this.driftAccumMs += Math.abs(raw - snapped) * 1000;
  }

  toKeyframes(
    mappings: readonly MidiMapping[],
    options: MidiKeyframeOptions = {},
  ): Readonly<Record<string, readonly Keyframe[]>> {
    return midiEventsToKeyframes(this.file.events, mappings, options);
  }

  dispatchToManager(
    manager: MidiDeviceManager,
    outputName: string,
    timeSeconds: number,
  ): readonly ParsedMidiEvent[] {
    const events = this.eventsUntil(timeSeconds);
    for (const event of events) {
      const status = event.type === "noteon"
        ? 0x90
        : event.type === "noteoff"
          ? 0x80
          : event.type === "cc"
            ? 0xb0
            : event.type === "pitchbend"
              ? 0xe0
              : 0xd0;
      const channel = Math.max(0, Math.min(15, event.channel - 1));
      const data1 = event.type === "cc"
        ? event.controller ?? 0
        : event.type === "pitchbend"
          ? ((event.value ?? 0) + 8192) & 0x7f
          : event.note ?? 0;
      const data2 = event.type === "pitchbend"
        ? (((event.value ?? 0) + 8192) >> 7) & 0x7f
        : event.type === "cc"
          ? event.value ?? 0
          : event.velocity ?? event.value ?? 0;
      manager.send(outputName, [status | channel, data1, data2]);
    }
    return events;
  }
}
