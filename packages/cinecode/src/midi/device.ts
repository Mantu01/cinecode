import type { MidiInputInfo, MidiMessage } from "./message.js";

export type MidiEventHandler = (message: MidiMessage) => void;

interface MidiBackendPort {
  readonly name?: string;
  readonly manufacturer?: string;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  close?: () => void;
  open?: () => void;
  send?: (bytes: number[]) => void;
}

interface MidiBackend {
  readonly inputs?: readonly MidiBackendPort[];
  readonly outputs?: readonly MidiBackendPort[];
  getInputs?: () => readonly MidiBackendPort[];
  getOutputs?: () => readonly MidiBackendPort[];
  openInput?: (name: string) => MidiBackendPort | undefined;
  openOutput?: (name: string) => MidiBackendPort | undefined;
}

export class MidiDeviceManager {
  private readonly inputs = new Map<string, MidiBackendPort>();
  private readonly handlers = new Map<MidiMessage["type"], Set<MidiEventHandler>>();
  private backend: MidiBackend | null = null;
  private backendLoaded = false;

  async initialize(): Promise<boolean> {
    if (this.backendLoaded) return this.backend !== null;
    this.backendLoaded = true;
    try {
      const module = await import("midi" as string) as { default?: MidiBackend } & MidiBackend;
      this.backend = module.default ?? module;
      return true;
    } catch {
      this.backend = null;
      return false;
    }
  }

  get available(): boolean {
    return this.backend !== null;
  }

  getInputs(): readonly MidiInputInfo[] {
    if (!this.backend) return [];
    const ports = this.backend.getInputs?.() ?? this.backend.inputs ?? [];
    return ports.map((port) => ({
      name: port.name ?? "unknown",
      manufacturer: port.manufacturer,
      connected: this.inputs.has(port.name ?? "unknown"),
    }));
  }

  async open(portName: string): Promise<void> {
    if (!this.backend) await this.initialize();
    if (!this.backend) throw new Error("No MIDI backend available. Install an optional backend such as `midi` to enable controller input.");
    const ports = this.backend.getInputs?.() ?? this.backend.inputs ?? [];
    const port = portName === "*"
      ? ports[0]
      : ports.find((candidate) => candidate.name === portName);
    if (!port) throw new Error(`MIDI input not found: ${portName}`);
    const name = port.name ?? portName;
    this.inputs.set(name, port);
    port.on?.("noteon", (channel: unknown, note: unknown, velocity: unknown) => this.emit({ type: "noteon", channel: Number(channel) + 1, note: Number(note), velocity: Number(velocity), port: name }));
    port.on?.("noteoff", (channel: unknown, note: unknown) => this.emit({ type: "noteoff", channel: Number(channel) + 1, note: Number(note), port: name }));
    port.on?.("cc", (channel: unknown, controller: unknown, value: unknown) => this.emit({ type: "cc", channel: Number(channel) + 1, controller: Number(controller), value: Number(value), port: name }));
    port.on?.("pitchbend", (channel: unknown, value: unknown) => this.emit({ type: "pitchbend", channel: Number(channel) + 1, value: Number(value), port: name }));
    port.on?.("aftertouch", (channel: unknown, value: unknown) => this.emit({ type: "aftertouch", channel: Number(channel) + 1, value: Number(value), port: name }));
  }

  close(portName: string): void {
    const port = this.inputs.get(portName);
    port?.close?.();
    this.inputs.delete(portName);
  }

  on(event: MidiMessage["type"], handler: MidiEventHandler): void {
    const set = this.handlers.get(event) ?? new Set<MidiEventHandler>();
    set.add(handler);
    this.handlers.set(event, set);
  }

  off(event: MidiMessage["type"], handler: MidiEventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  removeAllListeners(): void {
    this.handlers.clear();
  }

  inject(message: MidiMessage): void {
    this.emit(message);
  }

  send(outputName: string, bytes: readonly number[]): void {
    this.backend?.openOutput?.(outputName)?.send?.([...bytes]);
  }

  private emit(message: MidiMessage): void {
    for (const handler of this.handlers.get(message.type) ?? []) handler(message);
  }
}
