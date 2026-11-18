import { stat, writeFile } from "node:fs/promises";
import { createError, ErrorCode } from "../errors/index.js";
import type { OutputPlan, RenderFormat } from "../core/output-plan.js";
import {
  encodeAnimatedGif,
  encodeAnimatedPng,
  encodeStillImage,
  frameFileName,
  writeFrameSequence,
  type AnimatedGifOptions,
  type FrameSource,
  type StillImageFormat,
} from "../encoder/outputs.js";
import { withAtomicOutput } from "../encoder/output.js";
import { PdfDocumentBuilder } from "../pdf/index.js";

export interface ImageOutputOptions {
  readonly format: RenderFormat;
  readonly plan: OutputPlan;
  readonly outputPath: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly overwrite: boolean;
  readonly frames: FrameSource;
  readonly gif?: Pick<AnimatedGifOptions, "quality" | "dither" | "maxFrames" | "loops">;
  readonly still?: { readonly quality?: number };
  readonly title?: string;
}

export interface ImageOutputResult {
  readonly outputPath: string;
  readonly fileSize: number;
  readonly frames: number;
  readonly pages: number;
  readonly width: number;
  readonly height: number;
}

function fail(details: string, outputPath: string): never {
  throw createError(ErrorCode.CC4002, { details }, { location: { file: outputPath } });
}

async function firstFrame(frames: FrameSource): Promise<Buffer | undefined> {
  for await (const frame of frames as AsyncIterable<Buffer>) return frame;
  return undefined;
}

/** Writes one non-streamed output (GIF, APNG, PNG sequence, PDF, still). */
export async function writeImageOutput(options: ImageOutputOptions): Promise<ImageOutputResult> {
  const { format, outputPath, frames, width, height, fps, overwrite } = options;

  if (format === "gif") {
    const result = await encodeAnimatedGif(frames, outputPath, {
      fps,
      overwrite,
      quality: options.gif?.quality,
      dither: options.gif?.dither,
      maxFrames: options.gif?.maxFrames,
      loops: options.gif?.loops,
    });
    if (!result.success) fail(result.error ?? "GIF output failed", outputPath);
    return { outputPath, fileSize: result.fileSize, frames: result.frames, pages: 0, width: result.width, height: result.height };
  }

  if (format === "apng") {
    const result = await encodeAnimatedPng(frames, outputPath, { fps, overwrite, maxFrames: options.gif?.maxFrames });
    if (!result.success) fail(result.error ?? "APNG output failed", outputPath);
    const fileSize = (await stat(outputPath).catch(() => null))?.size ?? 0;
    return { outputPath, fileSize, frames: result.frames, pages: 0, width: result.width, height: result.height };
  }

  if (format === "png") {
    const result = await writeFrameSequence(frames, outputPath, { overwrite });
    if (!result.success) fail(result.error ?? "PNG sequence output failed", outputPath);
    let fileSize = 0;
    for (let index = 0; index < result.frames; index += 1) {
      const name = frameFileName(result.pattern, index);
      fileSize += (await stat(`${result.directory}/${name}`).catch(() => null))?.size ?? 0;
    }
    return { outputPath, fileSize, frames: result.frames, pages: 0, width: result.width, height: result.height };
  }

  if (format === "pdf") {
    const builder = await PdfDocumentBuilder.create({ width, height, title: options.title });
    for await (const frame of frames as AsyncIterable<Buffer>) await builder.addPngFrame(frame);
    const built = await builder.finish();
    await withAtomicOutput(outputPath, async (staged) => {
      await writeFile(staged, built.buffer);
    });
    return {
      outputPath,
      fileSize: built.buffer.length,
      frames: built.pages,
      pages: built.pages,
      width,
      height,
    };
  }

  const frame = await firstFrame(frames);
  if (!frame) fail("No frames supplied", outputPath);
  const result = await encodeStillImage(frame, outputPath, format as StillImageFormat, {
    overwrite,
    alpha: options.plan.alpha,
    quality: options.still?.quality,
  });
  if (!result.success) fail(result.error ?? `${format} still output failed`, outputPath);
  const fileSize = (await stat(outputPath).catch(() => null))?.size ?? 0;
  return { outputPath, fileSize, frames: 1, pages: 0, width, height };
}
