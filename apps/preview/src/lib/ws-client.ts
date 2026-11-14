import type { ServerMessage, PreviewErrorMessage } from "./types.js";

export interface CompositionMetadata {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: number;
  readonly trackCount: number;
  readonly clipCount: number;
}

type MessageHandler = (msg: ServerMessage) => void;

export class PreviewWebSocket {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly url: string;
  private readonly handlers: Set<MessageHandler> = new Set();
  private readonly onConnect?: () => void;
  private readonly onDisconnect?: (reason: string) => void;
  private readonly maxReconnectDelay = 30_000;

  constructor(
    url: string,
    options?: { onConnect?: () => void; onDisconnect?: (reason: string) => void },
  ) {
    this.url = url;
    this.onConnect = options?.onConnect;
    this.onDisconnect = options?.onDisconnect;
  }

  on(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  connect(): void {
    this.close();
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.onConnect?.();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        for (const handler of this.handlers) handler(msg);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.ws = null;
      this.onDisconnect?.(event.reason ?? "connection closed");
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose fires after this; don't double-handle
    };
  }

  requestPreview(startFrame: number, endFrame: number): void {
    this.ws?.send(JSON.stringify({ type: "preview:request", startFrame, endFrame }));
  }

  requestMetadata(): void {
    this.ws?.send(JSON.stringify({ type: "metadata:request" }));
  }

  scrub(frame: number): void {
    this.ws?.send(JSON.stringify({ type: "scrub", frame }));
  }

  pause(): void {
    this.ws?.send(JSON.stringify({ type: "pause" }));
  }

  play(startFrame?: number): void {
    this.ws?.send(JSON.stringify({ type: "play", startFrame }));
  }

  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const jitter = new Uint32Array(1);
    crypto.getRandomValues(jitter);
    const exponent = Math.floor(((jitter[0] ?? 0) / 2 ** 32) * 5);
    const delay = Math.min(1000 * 2 ** exponent, this.maxReconnectDelay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
