import { Canvas, loadImage } from "@napi-rs/canvas";

export type DownscaleFormat = "png" | "jpg" | "webp";

export async function downscaleFrame(
  frame: Buffer,
  width: number,
  height: number,
  format: DownscaleFormat = "png",
  quality = 90,
): Promise<Buffer> {
  const image = await loadImage(frame);
  if (image.width === width && image.height === height && format === "png") return frame;
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  if (format === "jpg") return canvas.encode("jpeg", quality);
  if (format === "webp") return canvas.encode("webp", quality);
  return canvas.encode("png");
}

export async function downscaleFrames(
  frames: readonly Buffer[],
  width: number,
  height: number,
  format: DownscaleFormat = "png",
): Promise<Buffer[]> {
  const output: Buffer[] = [];
  for (const frame of frames) output.push(await downscaleFrame(frame, width, height, format));
  return output;
}
