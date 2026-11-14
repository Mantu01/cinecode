import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface WsClient {
  readonly id: number;
  readonly ip: string;
  room?: string;
  user?: {
    id: string;
    name: string;
    color: string;
    isHost?: boolean;
  };
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
}

export type WsMessageHandler = (client: WsClient, data: unknown) => void;

export interface RoomPresenceUser {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  playhead?: number;
  cursor?: { x: number; y: number };
}

export class WebSocketHub {
  private readonly clients = new Map<number, ClientState>();
  private readonly ipCounts = new Map<string, number>();
  private readonly rooms = new Map<string, Set<number>>();
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
    };
    this.clients.set(id, state);

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const initialRoom = url.searchParams.get("room") || "default";
    const initialUserName = url.searchParams.get("user") || `User ${id}`;

    const client: WsClient = {
      id,
      ip,
      room: initialRoom,
      user: {
        id: `u_${id}`,
        name: initialUserName,
        color: this.assignColor(id),
        isHost: id === 1,
      },
      send: (payload: unknown) => this.sendTo(state, payload),
      sendBinary: (buffer: Buffer) => this.sendBinaryTo(state, buffer),
      close: () => this.closeClient(state),
    };
    state.client = client;

    this.joinRoom(client, initialRoom);

    socket.on("data", (chunk: Buffer) => this.consume(socket, chunk));
    socket.on("close", () => this.cleanupClient(state));
    socket.on("error", () => this.cleanupClient(state));

    return client;
  }

  joinRoom(client: WsClient, roomName: string): void {
    if (client.room && this.rooms.has(client.room)) {
      this.rooms.get(client.room)?.delete(client.id);
      this.broadcastToRoom(client.room, {
        type: "room:user_left",
        userId: client.user?.id,
      }, client.id);
    }

    client.room = roomName;
    if (!this.rooms.has(roomName)) {
      this.rooms.set(roomName, new Set());
    }
    this.rooms.get(roomName)?.add(client.id);

    this.broadcastToRoom(roomName, {
      type: "room:user_joined",
      user: client.user,
      presence: this.getRoomPresence(roomName),
    });
  }

  getRoomPresence(roomName: string): RoomPresenceUser[] {
    const clientIds = this.rooms.get(roomName);
    if (!clientIds) return [];
    const list: RoomPresenceUser[] = [];
    for (const id of clientIds) {
      const state = this.clients.get(id);
      if (state?.client?.user) {
        list.push({
          id: state.client.user.id,
          name: state.client.user.name,
          color: state.client.user.color,
          isHost: !!state.client.user.isHost,
        });
      }
    }
    return list;
  }

  broadcast(payload: unknown): void {
    for (const client of this.clients.values()) {
      this.sendTo(client, payload);
    }
  }

  broadcastToRoom(roomName: string, payload: unknown, excludeClientId?: number): void {
    const clientIds = this.rooms.get(roomName);
    if (!clientIds) return;
    for (const id of clientIds) {
      if (excludeClientId && id === excludeClientId) continue;
      const client = this.clients.get(id);
      if (client) this.sendTo(client, payload);
    }
  }

  get size(): number {
    return this.clients.size;
  }

  closeAll(): void {
    for (const client of this.clients.values()) this.closeClient(client);
    this.clients.clear();
    this.ipCounts.clear();
    this.rooms.clear();
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
      void 0;
    }
    this.cleanupClient(client);
  }

  private cleanupClient(client: ClientState): void {
    this.clients.delete(client.id);
    const count = this.ipCounts.get(client.ip) ?? 1;
    if (count <= 1) this.ipCounts.delete(client.ip);
    else this.ipCounts.set(client.ip, count - 1);

    if (client.client?.room && this.rooms.has(client.client.room)) {
      this.rooms.get(client.client.room)?.delete(client.id);
      this.broadcastToRoom(client.client.room, {
        type: "room:user_left",
        userId: client.client.user?.id,
      });
    }
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

    let data: any = body.toString("utf-8");
    try {
      data = JSON.parse(body.toString("utf-8"));
    } catch {
      void 0;
    }

    if (data && typeof data === "object") {
      if (data.type === "room:join" && typeof data.room === "string") {
        this.joinRoom(client, data.room);
        return;
      }
      if (data.type === "room:sync_host" && client.room) {
        this.broadcastToRoom(client.room, {
          type: "room:host_update",
          hostUserId: client.user?.id,
          playhead: data.playhead,
          selection: data.selection,
        }, client.id);
      }
      if (data.type === "room:cursor" && client.room) {
        this.broadcastToRoom(client.room, {
          type: "room:cursor_update",
          userId: client.user?.id,
          userName: client.user?.name,
          color: client.user?.color,
          cursor: data.cursor,
          playhead: data.playhead,
        }, client.id);
      }
    }

    for (const handler of this.messageHandlers) handler(client, data);
  }

  private consume(socket: Duplex, chunk: Buffer): void {
    let offset = 0;
    while (offset + 2 <= chunk.length) {
      const opcode = chunk[offset]! & 0x0f;
      const masked = (chunk[offset + 1]! & 0x80) !== 0;
      let length = chunk[offset + 1]! & 0x7f;
      let headerSize = 2;
      if (length === 126) {
        if (offset + 4 > chunk.length) return;
        length = chunk.readUInt16BE(offset + 2);
        headerSize = 4;
      } else if (length === 127) {
        if (offset + 10 > chunk.length) return;
        length = Number(chunk.readBigUInt64BE(offset + 2));
        headerSize = 10;
      }
      let payloadStart = offset + headerSize;
      let maskKeyOffset = -1;
      if (masked) {
        if (payloadStart + 4 > chunk.length) return;
        maskKeyOffset = payloadStart;
        payloadStart += 4;
      }
      if (payloadStart + length > chunk.length) return;
      offset = payloadStart + length;

      if (opcode === 0x8) {
        socket.write(Buffer.from([0x88, 0x00]));
        socket.end();
        return;
      }
      if (opcode === 0x9) {
        socket.write(Buffer.from([0x8a, 0x00]));
      }
      if (opcode === 0x1 && this.messageHandlers.length > 0) {
        const client = [...this.clients.values()].find((state) => state.socket === socket)?.client ?? null;
        if (client) {
          const body = Buffer.from(chunk.subarray(payloadStart, payloadStart + length));
          if (masked && maskKeyOffset >= 0) {
            for (let i = 0; i < body.length; i += 1) {
              body[i] = body[i]! ^ chunk[maskKeyOffset + (i % 4)]!;
            }
          }
          this.dispatchMessage(client, body);
        }
      }
    }
  }

  private assignColor(id: number): string {
    const colors = ["#48bb78", "#4299e1", "#ed8936", "#9f7aea", "#ed64a6", "#38b2ac", "#ecc94b"];
    return colors[id % colors.length]!;
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
