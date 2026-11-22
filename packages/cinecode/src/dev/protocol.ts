// Versioned preview protocol definitions and binary frame transport
export const PROTOCOL_VERSION = 1;

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
  // Bytes 17-19 reserved (zeros)
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

// Client message types
export type ClientMessageType =
  | "hello"
  | "select"
  | "seek"
  | "play"
  | "pause"
  | "view:set"
  | "view:reset"
  | "ping"
  | "status:request";

// Server message types
export type ServerMessageType =
  | "welcome"
  | "validation"
  | "progress"
  | "error"
  | "pong"
  | "status"
  | "view:ack";

export interface ServerStatusMessage {
  readonly type: "status";
  readonly version: number;
  readonly ready: boolean;
  readonly cachedFrames: number;
  readonly scale: number;
  readonly reducedEffects: boolean;
}
