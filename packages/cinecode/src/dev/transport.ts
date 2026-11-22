import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface WsClient {
  readonly id: number;
  readonly ip: string;
  send(payload: unknown): void;
  sendBinary(buffer: Buffer): void;
  close(): void;
}

interface ClientState {
  id: number;
  ip: string;
  socket: Duplex;
  closed: boolean;
  client: WsClient | null;
  messageTimestamps: number[];
  throttledUntil: number;
  receiveBuffer: Buffer;
  fragmentOpcode: number;
  fragmentPayload: Buffer;
  closeCode: number | null;
}

export type WsMessageHandler = (client: WsClient, data: unknown) => void;

// Single-user protocol transport
export class WebSocketHub {
  private readonly clients = new Map<number, ClientState>();
  private readonly ipCounts = new Map<string, number>();
  private readonly messageHandlers: WsMessageHandler[] = [];
  private nextId = 1;

  readonly maxTotalConnections = 100;
  readonly maxConnectionsPerIp = 10;
  readonly maxMessagesPerSec = 120;

  onMessage(handler: WsMessageHandler): void {
    this.messageHandlers.push(handler);
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): WsClient {
    const ip = request.socket.remoteAddress || "127.0.0.1";
    const currentIpCount = this.ipCounts.get(ip) ?? 0;

    if (this.clients.size >= this.maxTotalConnections || currentIpCount >= this.maxConnectionsPerIp) {
      socket.write("HTTP/1.1 429 Too Many Requests\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nRate limit exceeded");
      socket.destroy();
      throw new Error(`Connection rejected: rate limit exceeded for IP ${ip}`);
    }

    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      throw new Error("Missing Sec-WebSocket-Key header");
    }
    const accept = createHash("sha1").update(key + GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    if (head.length > 0) this.consume(socket, head);

    const id = this.nextId++;
    this.ipCounts.set(ip, currentIpCount + 1);

    const state: ClientState = {
      id,
      ip,
      socket,
      closed: false,
      client: null,
      messageTimestamps: [],
      throttledUntil: 0,
      receiveBuffer: Buffer.alloc(0),
      fragmentOpcode: 0,
      fragmentPayload: Buffer.alloc(0),
      closeCode: null,
    };
    this.clients.set(id, state);

    const client: WsClient = {
      id,
      ip,
      send: (payload: unknown) => this.sendTo(state, payload),
      sendBinary: (buffer: Buffer) => this.sendBinaryTo(state, buffer),
      close: () => this.closeClient(state),
    };
    state.client = client;

    socket.on("data", (chunk: Buffer) => this.consume(socket, chunk));
    socket.on("close", () => this.cleanupClient(state));
    socket.on("error", () => this.cleanupClient(state));

    return client;
  }

  broadcast(payload: unknown): void {
    for (const client of this.clients.values()) {
      this.sendTo(client, payload);
    }
  }

  broadcastBinary(buffer: Buffer): void {
    for (const client of this.clients.values()) {
      this.sendBinaryTo(client, buffer);
    }
  }

  get size(): number {
    return this.clients.size;
  }

  closeAll(): void {
    for (const client of this.clients.values()) this.closeClient(client);
    this.clients.clear();
    this.ipCounts.clear();
  }

  private sendTo(client: ClientState, payload: unknown): void {
    if (client.closed) return;
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    client.socket.write(encodeFrame(Buffer.from(text, "utf-8"), 0x1));
  }

  private sendBinaryTo(client: ClientState, buffer: Buffer): void {
    if (client.closed) return;
    client.socket.write(encodeFrame(buffer, 0x2));
  }

  private closeClient(client: ClientState): void {
    if (client.closed) return;
    client.closed = true;
    try {
      client.socket.write(Buffer.from([0x88, 0x00]));
      client.socket.end();
    } catch {
      // Note: socket might already be closed or destroyed
      void 0;
    }
    this.cleanupClient(client);
  }

  private cleanupClient(client: ClientState): void {
    this.clients.delete(client.id);
    const count = this.ipCounts.get(client.ip) ?? 1;
    if (count <= 1) this.ipCounts.delete(client.ip);
    else this.ipCounts.set(client.ip, count - 1);
  }

  private dispatchMessage(client: WsClient, body: Buffer): void {
    const state = this.clients.get(client.id);
    if (state) {
      const now = Date.now();
      if (now < state.throttledUntil) {
        client.send({ type: "warning", message: "Rate limit cooldown active. Messages throttled." });
        return;
      }

      state.messageTimestamps = state.messageTimestamps.filter((t) => now - t < 1000);
      state.messageTimestamps.push(now);

      if (state.messageTimestamps.length > this.maxMessagesPerSec) {
        state.throttledUntil = now + 2000;
        client.send({ type: "error", message: "Message rate limit exceeded (>120/sec). Throttled for 2 seconds." });
        return;
      }
    }

    try {
      const parsed = JSON.parse(body.toString("utf-8"));
      for (const handler of this.messageHandlers) handler(client, parsed);
    } catch {
      for (const handler of this.messageHandlers) handler(client, body);
    }
  }

  private consume(socket: Duplex, chunk: Buffer): void {
    const state = [...this.clients.values()].find((entry) => entry.socket === socket);
    if (!state || state.closed) return;
    state.receiveBuffer = Buffer.concat([state.receiveBuffer, chunk]);

    let offset = 0;
    while (offset < state.receiveBuffer.length) {
      const frame = state.receiveBuffer.subarray(offset);
      if (frame.length < 2) break;
      const first = frame[0]!;
      const second = frame[1]!;
      const final = (first & 0x80) !== 0;
      const opcode = first & 0x0F;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7F;
      let headerSize = 2;
      if (length === 126) {
        if (offset + 4 > frame.length) break;
        length = frame.readUInt16BE(offset + 2);
        headerSize = 4;
      } else if (length === 127) {
        if (offset + 10 > frame.length) break;
        length = Number(frame.readBigUInt64BE(offset + 2));
        headerSize = 10;
      }
      let payloadStart = offset + headerSize;
      let maskKeyOffset = -1;
      if (masked) {
        if (payloadStart + 4 > frame.length) break;
        maskKeyOffset = payloadStart;
        payloadStart += 4;
      }
      if (payloadStart + length > frame.length) break;
      if (length > 1024 * 1024) {
        socket.write(Buffer.from([0x88, 0x02, 0x03, 0xe9]));
        socket.end();
        state.closed = true;
        return;
      }
      const body = Buffer.from(frame.subarray(payloadStart, payloadStart + length));
      if (masked && maskKeyOffset >= 0) {
        for (let index = 0; index < body.length; index += 1) {
          body[index] = body[index]! ^ frame[maskKeyOffset + (index % 4)]!;
        }
      }
      offset = payloadStart + length;
      if (opcode === 0x8) {
        state.closeCode = body.length >= 2 ? body.readUInt16BE(0) : null;
        socket.write(Buffer.concat([Buffer.from([0x88, body.length]), body]));
        socket.end();
        return;
      }
      if (opcode === 0x9) {
        socket.write(encodeFrame(body, 0xA));
      } else if (opcode === 0x1 || opcode === 0x2) {
        if (!final) {
          state.fragmentOpcode = opcode;
          state.fragmentPayload = body;
        } else if (state.fragmentPayload.length > 0 && state.fragmentOpcode === opcode) {
          const complete = Buffer.concat([state.fragmentPayload, body]);
          state.fragmentPayload = Buffer.alloc(0);
          state.fragmentOpcode = 0;
          if (state.client) this.dispatchMessage(state.client, complete);
        } else if (state.client) {
          this.dispatchMessage(state.client, body);
        }
      } else if (opcode === 0x0 && state.fragmentPayload.length > 0) {
        state.fragmentPayload = Buffer.concat([state.fragmentPayload, body]);
        if (final) {
          const complete = state.fragmentPayload;
          state.fragmentPayload = Buffer.alloc(0);
          const fragmentOpcode = state.fragmentOpcode;
          state.fragmentOpcode = 0;
          if (state.client && fragmentOpcode === 0x1) this.dispatchMessage(state.client, complete);
        }
      }
    }
    state.receiveBuffer = state.receiveBuffer.subarray(offset);
  }
}

function encodeFrame(payload: Buffer, opcode: number): Buffer {
  const length = payload.length;
  const first = 0x80 | opcode;
  if (length < 126) {
    return Buffer.concat([Buffer.from([first, length]), payload]);
  }
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = first;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = first;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}
