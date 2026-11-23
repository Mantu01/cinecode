// Versioned preview protocol definitions and binary frame transport
export const PROTOCOL_VERSION = 1;

export const PROTOCOL_ERROR = "CC1014";
export const PROTOCOL_READ_ONLY = "CC1014";

export const FRAME_MAGIC = Buffer.from([0x43, 0x43, 0x46, 0x52]); // "CCFR"
export const FRAME_HEADER_SIZE = 20;

export const FRAME_FORMAT_PNG = 0x01;
export const FRAME_FORMAT_JPEG = 0x02;
export const FRAME_FORMAT_RAW = 0x03;

export interface DecodedFrame {
  readonly magic: string;
  readonly frameIndex: number;
  readonly width: number;
  readonly height: number;
  readonly format: number;
  readonly payload: Buffer;
}

export function encodeFrameBinary(
  frameIndex: number,
  width: number,
  height: number,
  format: number,
  payload: Buffer,
): Buffer {
  const header = Buffer.alloc(FRAME_HEADER_SIZE);
  header.set(FRAME_MAGIC, 0);
  header.writeUInt32BE(frameIndex, 4);
  header.writeUInt32BE(width, 8);
  header.writeUInt32BE(height, 12);
  header.writeUInt8(format, 16);
  return Buffer.concat([header, payload]);
}

export function decodeFrameBinary(buffer: Buffer): DecodedFrame {
  if (buffer.length < FRAME_HEADER_SIZE) {
    throw new Error(`Buffer smaller than header size (${buffer.length} < ${FRAME_HEADER_SIZE})`);
  }
  const magic = buffer.subarray(0, 4).toString("ascii");
  if (magic !== "CCFR") {
    throw new Error(`Invalid frame magic: ${magic}`);
  }
  const frameIndex = buffer.readUInt32BE(4);
  const width = buffer.readUInt32BE(8);
  const height = buffer.readUInt32BE(12);
  const format = buffer.readUInt8(16);
  const payload = buffer.subarray(FRAME_HEADER_SIZE);
  return { magic, frameIndex, width, height, format, payload };
}

// Read-only allowlist: selection, view zoom/reset, camera orbit/zoom, read-only queries
export const READ_ONLY_ALLOWLIST = [
  "hello",
  "ping",
  "status:request",
  "select",
  "view:set",
  "view:reset",
  "camera:orbit",
  "camera:zoom",
] as const;

export type ClientMessageType = (typeof READ_ONLY_ALLOWLIST)[number];

// Dev adds watcher-driven reload messages only; the client allowlist is identical
export const MODE_ALLOWLISTS: Readonly<Record<"dev" | "preview", readonly ClientMessageType[]>> = {
  dev: READ_ONLY_ALLOWLIST,
  preview: READ_ONLY_ALLOWLIST,
};

export const FORBIDDEN_CLIENT_TYPES = [
  "play",
  "pause",
  "seek",
  "preview:frame",
  "preview:layers",
  "layer:update",
  "layer:reorder",
  "clip:update",
  "camera:pan",
  "view:state",
] as const;

export interface ClientMessage {
  readonly type: ClientMessageType;
  readonly [field: string]: unknown;
}

type FieldKind = "string" | "number";

interface MessageSchema {
  readonly required: Readonly<Record<string, FieldKind>>;
  readonly optional?: Readonly<Record<string, FieldKind>>;
}

const CLIENT_SCHEMAS: Readonly<Record<ClientMessageType, MessageSchema>> = {
  hello: { required: {}, optional: { version: "number" } },
  ping: { required: {}, optional: { timestamp: "number" } },
  "status:request": { required: {} },
  select: { required: { node: "string" } },
  "view:set": { required: { zoom: "number" } },
  "view:reset": { required: {} },
  "camera:orbit": { required: { theta: "number", phi: "number" } },
  "camera:zoom": { required: { zoom: "number" } },
};

export type ClientMessageResult =
  | { readonly ok: true; readonly message: ClientMessage }
  | { readonly ok: false; readonly code: string; readonly type: string; readonly message: string };

function matchesKind(value: unknown, kind: FieldKind): boolean {
  if (kind === "string") return typeof value === "string" && value.length > 0;
  return typeof value === "number" && Number.isFinite(value);
}

export function parseClientMessage(value: unknown): ClientMessageResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, code: PROTOCOL_ERROR, type: "", message: "Malformed payload: expected a JSON object." };
  }
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || type.length === 0) {
    return { ok: false, code: PROTOCOL_ERROR, type: "", message: "Malformed payload: missing message type." };
  }
  if ((FORBIDDEN_CLIENT_TYPES as readonly string[]).includes(type)) {
    return {
      ok: false,
      code: PROTOCOL_READ_ONLY,
      type,
      message: `Read-only preview rejects '${type}': transport, scrubbing, and layer changes are forbidden.`,
    };
  }
  if (!(READ_ONLY_ALLOWLIST as readonly string[]).includes(type)) {
    return { ok: false, code: PROTOCOL_ERROR, type, message: `Unknown message type '${type}'.` };
  }
  const messageType = type as ClientMessageType;
  const schema = CLIENT_SCHEMAS[messageType];
  const allowed = new Set(["type", ...Object.keys(schema.required), ...Object.keys(schema.optional ?? {})]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      return { ok: false, code: PROTOCOL_ERROR, type, message: `Unknown field '${key}' on '${type}'.` };
    }
  }
  for (const [field, kind] of Object.entries(schema.required)) {
    if (!matchesKind(record[field], kind)) {
      return { ok: false, code: PROTOCOL_ERROR, type, message: `Malformed payload: '${field}' must be a finite ${kind}.` };
    }
  }
  for (const [field, kind] of Object.entries(schema.optional ?? {})) {
    if (record[field] !== undefined && !matchesKind(record[field], kind)) {
      return { ok: false, code: PROTOCOL_ERROR, type, message: `Malformed payload: '${field}' must be a finite ${kind}.` };
    }
  }
  return { ok: true, message: record as ClientMessage };
}

export interface PreviewCameraWire {
  readonly orbit?: { readonly theta: number; readonly phi: number };
  readonly zoom?: number;
}

export type ServerMessageType =
  | "welcome"
  | "validation"
  | "progress"
  | "error"
  | "pong"
  | "status"
  | "frame"
  | "preview:unavailable"
  | "view:ack"
  | "update"
  | "warning";

export interface ServerStatusMessage {
  readonly type: "status";
  readonly version: number;
  readonly ready: boolean;
  readonly cachedFrames: number;
  readonly scale: number;
  readonly reducedEffects: boolean;
}

export interface ServerFrameMessage {
  readonly type: "frame";
  readonly version: number;
  readonly node: string;
  readonly frame: number;
  readonly generation: number;
  readonly camera: PreviewCameraWire | null;
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  readonly cached: boolean;
}

export interface ServerUnavailableMessage {
  readonly type: "preview:unavailable";
  readonly version: number;
  readonly node: string;
  readonly kind: string;
  readonly reason: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const SERVER_REQUIRED: Readonly<Record<ServerMessageType, readonly string[]>> = {
  welcome: ["version", "nodes"],
  validation: ["version", "report"],
  progress: ["current", "total"],
  error: ["message"],
  pong: ["version", "timestamp"],
  status: ["version", "ready", "cachedFrames", "scale", "reducedEffects"],
  frame: ["version", "node", "frame", "generation", "camera", "scale", "width", "height", "cached"],
  "preview:unavailable": ["version", "node", "kind", "reason"],
  "view:ack": ["version", "state"],
  update: ["node", "url", "at"],
  warning: ["message"],
};

export function validateServerMessage(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["server message must be an object"];
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || !(type in SERVER_REQUIRED)) return [`unknown server message type '${String(type)}'`];
  return SERVER_REQUIRED[type as ServerMessageType]
    .filter((field) => record[field] === undefined)
    .map((field) => `${type} is missing '${field}'`);
}
