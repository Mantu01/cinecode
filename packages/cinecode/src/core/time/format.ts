import { type FrameConversion } from "./convert.js";

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function formatTimecode(frameCount: number, conversion: FrameConversion): string {
  const nominalFps = Math.max(1, Math.round(conversion.fpsFloat));
  const safeFrame = Math.max(0, Math.round(frameCount));
  const framesWithinSecond = safeFrame % nominalFps;
  const totalSeconds = Math.floor(safeFrame / nominalFps);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secondsField = totalSeconds % 60;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secondsField, 2)}:${pad(framesWithinSecond, 2)}`;
}

export function formatSeconds(duration: number): string {
  return `${duration.toFixed(3)}s`;
}
