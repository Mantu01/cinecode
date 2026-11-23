import { Canvas } from "@napi-rs/canvas";
import type { Composition } from "../core/types/index.js";
import { frameFromPixels } from "./frame-format.js";

export type FrameErrorPolicy = "placeholder" | "repeat-previous" | "abort";

export type FrameOutcomeKind = "success" | "policy" | "abort";

export interface FrameFailure {
  readonly frame: number;
  readonly timecode: number;
  readonly message: string;
  readonly stack?: string;
  readonly clip?: string;
}

export interface FrameOutcome {
  readonly index: number;
  readonly kind: FrameOutcomeKind;
  readonly buffer?: Buffer;
  readonly failure?: FrameFailure;
}

export function colorSpecToString(color: unknown): string | undefined {
  if (typeof color === "string") return color;
  if (color && typeof color === "object" && "color" in color && typeof (color as { color: unknown }).color === "string") {
    return (color as { color: string }).color;
  }
  return undefined;
}

export const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5;

/** One read out of the canvas; straight RGBA with its own transferable buffer. */
export function frameToBuffer(canvas: Canvas): Buffer {
  const imageData = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  return frameFromPixels(imageData.data);
}

export function placeholderBuffer(
  width: number,
  height: number,
  message: string,
  background?: string,
): Buffer {
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = background || "#101418";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255, 64, 64, 0.18)";
  ctx.fillRect(0, 0, width, height);
  const fontSize = Math.max(12, Math.min(48, Math.round(width / 24)));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
  ctx.fillText("FRAME RENDER ERROR", width / 2, height / 2 - fontSize);
  ctx.font = `${Math.max(10, Math.round(fontSize * 0.5))}px sans-serif`;
  ctx.fillStyle = "rgba(255, 220, 220, 0.7)";
  const trimmed = message.length > 96 ? `${message.slice(0, 93)}...` : message;
  ctx.fillText(trimmed, width / 2, height / 2 + fontSize * 0.8);
  return frameToBuffer(canvas);
}

export function extractClipReference(errorOrMessage: unknown): string | undefined {
  if (typeof errorOrMessage === "string") {
    const match = errorOrMessage.match(/clip\s+"([^"]+)"/i);
    return match?.[1];
  }
  if (errorOrMessage && typeof errorOrMessage === "object") {
    const loc = (errorOrMessage as { location?: { clip?: string } }).location;
    if (loc?.clip) return loc.clip;
    const msg = (errorOrMessage as { message?: string }).message;
    if (typeof msg === "string") {
      const match = msg.match(/clip\s+"([^"]+)"/i);
      return match?.[1];
    }
  }
  return undefined;
}

export function isCircuitBroken(
  consecutiveFailures: number,
  maxConsecutive: number = DEFAULT_MAX_CONSECUTIVE_FAILURES,
): boolean {
  return consecutiveFailures >= maxConsecutive;
}

export function formatDiagnostics(failures: readonly FrameFailure[], total: number): string {
  const head = failures
    .slice(0, 8)
    .map(
      (failure) => `frame ${failure.frame} (${failure.timecode.toFixed(3)}s): ${failure.message}`,
    );
  return [
    `failed frames: ${failures.length}/${total}`,
    ...head,
    ...(failures.length > head.length ? [`... ${failures.length - head.length} more`] : []),
  ].join("\n");
}
