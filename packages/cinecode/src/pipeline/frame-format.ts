import { Buffer } from "node:buffer";
import { createError, ErrorCode } from "../errors/index.js";

/**
 * Canonical frame buffer, used by every producer and consumer of rendered
 * pixels.
 *
 * - channel order: R, G, B, A — 8 bits per channel
 * - alpha: straight (un-premultiplied), 0 = transparent, 255 = opaque
 * - stride: `width * 4` bytes, no row padding, top row first
 * - ownership: one dedicated ArrayBuffer per frame, so it can be transferred
 *   across the worker boundary instead of copied
 *
 * The encoder boundary is the only place this format is interpreted: ffmpeg
 * receives it as `rawvideo`/`rgba`.
 */
export const FRAME_CHANNELS = 4;
export const FRAME_PIX_FMT = "rgba";

export function frameBytes(width: number, height: number): number {
  return Math.max(1, width) * Math.max(1, height) * FRAME_CHANNELS;
}

export interface FrameTransportStats {
  /** Frames boxed into the canonical format. */
  readonly framesProduced: number;
  /** Frames handed to another thread by buffer transfer (no pixel copy). */
  readonly framesTransferred: number;
  /** Full-frame pixel copies performed while boxing or receiving frames. */
  readonly pixelCopies: number;
  /** Frames that arrived as a copy instead of a transfer. */
  readonly copiedFrames: number;
}

const stats: {
  framesProduced: number;
  framesTransferred: number;
  pixelCopies: number;
  copiedFrames: number;
} = { framesProduced: 0, framesTransferred: 0, pixelCopies: 0, copiedFrames: 0 };

export function getFrameTransportStats(): FrameTransportStats {
  return { ...stats };
}

export function resetFrameTransportStats(): void {
  stats.framesProduced = 0;
  stats.framesTransferred = 0;
  stats.pixelCopies = 0;
  stats.copiedFrames = 0;
}

/**
 * Copies canvas pixels into a canonical frame buffer.
 *
 * Canvas pixels come from a native buffer that cannot be transferred across
 * the worker boundary (`postMessage` rejects it with `DataCloneError`), so the
 * read is copied once into an owned, transferable ArrayBuffer. That copy is the
 * only one on the worker side; the buffer is then moved, not cloned.
 */
export function frameFromPixels(pixels: Uint8ClampedArray | Uint8Array): Buffer {
  const buffer = Buffer.from(new ArrayBuffer(pixels.byteLength));
  Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength).copy(buffer);
  stats.framesProduced += 1;
  stats.pixelCopies += 1;
  return buffer;
}

/** Allocates a canonical frame buffer with its own transferable ArrayBuffer. */
export function allocateFrame(width: number, height: number): Buffer {
  const buffer = Buffer.from(new ArrayBuffer(frameBytes(width, height)));
  stats.framesProduced += 1;
  return buffer;
}

/** Marks an outgoing frame; the returned ArrayBuffer is moved, not copied. */
export function frameTransfer(buffer: Buffer): { view: Uint8Array; transfer: ArrayBuffer } {
  stats.framesTransferred += 1;
  return {
    view: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    transfer: buffer.buffer as ArrayBuffer,
  };
}

/** Rebuilds a received frame as a Buffer over the transferred ArrayBuffer. */
export function frameFromTransfer(view: ArrayBufferView, transferred: boolean): Buffer {
  if (!transferred) {
    stats.pixelCopies += 1;
    stats.copiedFrames += 1;
    return Buffer.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

export function assertFrameBuffer(buffer: Buffer, width: number, height: number): void {
  const expected = frameBytes(width, height);
  if (buffer.byteLength !== expected) {
    throw createError(ErrorCode.CC2205, { expected, actual: buffer.byteLength });
  }
}
