export interface CanvasFrameEvent {
  readonly frameIndex: number;
  readonly imageData: string;
  readonly timestamp: number;
}

export interface CanvasStateEvent {
  readonly playing: boolean;
  readonly currentTime: number;
  readonly duration: number;
}

export interface CanvasErrorEvent {
  readonly code: string;
  readonly message: string;
}

export interface CanvasEvents {
  frame: CanvasFrameEvent;
  state: CanvasStateEvent;
  error: CanvasErrorEvent;
}

export type CanvasClientOptions = Record<string, unknown>;

interface WireMessage {
  id: string;
  type: string;
  payload: unknown;
}

export class CanvasClient {
  readonly url: string;
  private socket: WebSocket | undefined;
  private readonly handlers = new Map<keyof CanvasEvents, Set<(data: never) => void>>();
  private readonly pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  private nextId = 0;

  constructor(url: string) {
    this.url = url;
  }

  connect(): Promise<void> {
    if (typeof WebSocket === "undefined") {
      return Promise.reject(new Error("WebSocket is unavailable in this runtime"));
    }
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error(`Canvas connection failed: ${this.url}`)), { once: true });
      socket.addEventListener("message", (event) => this.receive(event.data));
    });
  }

  on<E extends keyof CanvasEvents>(event: E, callback: (data: CanvasEvents[E]) => void): void {
    const list = this.handlers.get(event) ?? new Set();
    list.add(callback as (data: never) => void);
    this.handlers.set(event, list);
  }

  render(options: CanvasClientOptions = {}): Promise<void> {
    return this.command("render", { options });
  }

  pause(): Promise<void> {
    return this.command("pause", {});
  }

  seek(frameIndex: number): Promise<void> {
    return this.command("seek", { frameIndex });
  }

  export(format: string): Promise<void> {
    return this.command("export", { format });
  }

  dispose(): void {
    this.socket?.close();
    this.socket = undefined;
    this.pending.clear();
  }

  private command(type: string, payload: unknown): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Canvas client is not connected"));
    }
    const id = `msg-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, type, payload }));
    });
  }

  private receive(raw: unknown): void {
    if (typeof raw !== "string") return;
    let message: WireMessage;
    try {
      message = JSON.parse(raw) as WireMessage;
    } catch {
      return;
    }
    const handler = this.pending.get(message.id);
    if (handler) {
      this.pending.delete(message.id);
      handler.resolve();
      return;
    }
    const listeners = this.handlers.get(message.type as keyof CanvasEvents);
    if (!listeners) return;
    for (const listener of listeners) {
      (listener as (data: unknown) => void)(message.payload);
    }
  }
}
