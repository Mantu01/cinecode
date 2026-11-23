import { createCanvas } from "@napi-rs/canvas";
import { stat, mkdir, writeFile, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  encodeAnimatedGif,
  encodeAnimatedPng,
  encodeStillImage,
  frameFileName,
  type AnimatedGifOptions,
  type StillImageFormat,
} from "../encoder/outputs.js";
import { withAtomicOutput } from "../encoder/output.js";
import { PdfDocumentBuilder } from "../pdf/index.js";
import { appendVectorPage, isVectorOnly } from "../pdf/vector.js";
import type { Composition } from "../core/types/index.js";
import type { EncoderResult } from "../encoder/index.js";
import type { OutputPlan, RenderFormat } from "../core/output-plan.js";

export interface FrameSink {
  addFrame(buffer: Buffer, index?: number): Promise<void>;
  finish(): Promise<EncoderResult>;
  cancel?(): Promise<void>;
}

export class AsyncQueue<T> {
  private queue: T[] = [];
  private waiters: ((val: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.queue.push(item);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters) waiter({ value: undefined as unknown as T, done: true });
    this.waiters = [];
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.queue.length > 0) return Promise.resolve({ value: this.queue.shift()!, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as unknown as T, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

export function rgbaToPng(buffer: Buffer, width: number, height: number): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(width, height);
  imgData.data.set(new Uint8ClampedArray(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  ctx.putImageData(imgData, 0, 0);
  return canvas.toBuffer("image/png");
}

export class AnimationSink implements FrameSink {
  private readonly queue = new AsyncQueue<Buffer>();
  private readonly encodePromise: Promise<{ success: boolean; outputPath: string; error?: string; frames: number; width: number; height: number; fps?: number }>;
  private readonly width: number;
  private readonly height: number;
  private readonly fps: number;
  private readonly outputPath: string;
  private readonly stagedPath: string;
  private readonly overwrite: boolean;
  private frameCount = 0;

  constructor(options: {
    format: "gif" | "apng";
    outputPath: string;
    width: number;
    height: number;
    fps: number;
    overwrite: boolean;
    gif?: Pick<AnimatedGifOptions, "quality" | "dither" | "maxFrames" | "loops">;
  }) {
    this.width = options.width;
    this.height = options.height;
    this.fps = options.fps;
    this.outputPath = options.outputPath;
    this.overwrite = options.overwrite;
    const extension = options.outputPath.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
    this.stagedPath = `${options.outputPath}.${process.pid}.tmp${extension}`;
    if (options.format === "gif") {
      this.encodePromise = encodeAnimatedGif(this.queue, this.stagedPath, {
        fps: options.fps,
        overwrite: true,
        quality: options.gif?.quality,
        dither: options.gif?.dither,
        maxFrames: options.gif?.maxFrames,
        loops: options.gif?.loops,
      });
    } else {
      this.encodePromise = encodeAnimatedPng(this.queue, this.stagedPath, {
        fps: options.fps,
        overwrite: true,
        maxFrames: options.gif?.maxFrames,
      });
    }
  }

  async addFrame(buffer: Buffer): Promise<void> {
    const pngBuf = rgbaToPng(buffer, this.width, this.height);
    this.queue.push(pngBuf);
    this.frameCount++;
  }

  async finish(): Promise<EncoderResult> {
    this.queue.close();
    const res = await this.encodePromise;
    if (!res.success) {
      await rm(this.stagedPath, { force: true }).catch(() => undefined);
      return { success: false, outputPath: this.outputPath, duration: 0, fileSize: 0, error: res.error };
    }
    const existing = await stat(this.outputPath).catch(() => null);
    if (existing && !this.overwrite) {
      await rm(this.stagedPath, { force: true }).catch(() => undefined);
      return { success: false, outputPath: this.outputPath, duration: 0, fileSize: 0, error: "Output exists (use overwrite)" };
    }
    if (existing) await rm(this.outputPath, { force: true });
    await rename(this.stagedPath, this.outputPath);
    const fileSize = (await stat(this.outputPath).catch(() => null))?.size ?? 0;
    return {
      success: true,
      outputPath: this.outputPath,
      duration: this.frameCount / Math.max(1, this.fps),
      fileSize,
    };
  }

  async cancel(): Promise<void> {
    this.queue.close();
    await this.encodePromise.catch(() => undefined);
    await rm(this.stagedPath, { force: true }).catch(() => undefined);
  }
}

export class SequenceSink implements FrameSink {
  private readonly outputDir: string;
  private readonly stagedDir: string;
  private readonly pattern: string;
  private readonly width: number;
  private readonly height: number;
  private readonly fps: number;
  private readonly overwrite: boolean;
  private frameCount = 0;
  private totalBytes = 0;

  constructor(options: {
    outputDir: string;
    width: number;
    height: number;
    fps: number;
    overwrite: boolean;
    format?: string;
  }) {
    this.outputDir = options.outputDir;
    this.stagedDir = `${options.outputDir}.${process.pid}.tmp`;
    this.width = options.width;
    this.height = options.height;
    this.fps = options.fps;
    this.overwrite = options.overwrite;
    const format = options.format ?? "png";
    const ext = format === "jpg" ? "jpg" : format === "webp" ? "webp" : "png";
    this.pattern = `frame-%05d.${ext}`;
  }

  async addFrame(buffer: Buffer, index?: number): Promise<void> {
    await mkdir(this.stagedDir, { recursive: true });
    const frameIndex = index ?? this.frameCount;
    const filename = frameFileName(this.pattern, frameIndex);
    const pngBuf = rgbaToPng(buffer, this.width, this.height);
    await writeFile(join(this.stagedDir, filename), pngBuf);
    this.frameCount++;
    this.totalBytes += pngBuf.length;
  }

  async finish(): Promise<EncoderResult> {
    const existing = await stat(this.outputDir).catch(() => null);
    if (existing && !this.overwrite) {
      await rm(this.stagedDir, { recursive: true, force: true }).catch(() => undefined);
      return { success: false, outputPath: this.outputDir, duration: 0, fileSize: 0, error: "Frame sequence already exists (use overwrite)" };
    }
    if (existing) await rm(this.outputDir, { recursive: true, force: true });
    await rename(this.stagedDir, this.outputDir);
    return {
      success: true,
      outputPath: this.outputDir,
      duration: this.frameCount / Math.max(1, this.fps),
      fileSize: this.totalBytes,
    };
  }

  async cancel(): Promise<void> {
    await rm(this.stagedDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export class DocumentSink implements FrameSink {
  private readonly outputPath: string;
  private readonly width: number;
  private readonly height: number;
  private readonly fps: number;
  private readonly vectorComposition?: Composition;
  private readonly builderPromise: Promise<PdfDocumentBuilder>;
  private readonly overwrite: boolean;
  private frameCount = 0;

  constructor(options: {
    outputPath: string;
    width: number;
    height: number;
    fps: number;
    title?: string;
    overwrite: boolean;
    vectorComposition?: Composition;
  }) {
    this.outputPath = options.outputPath;
    this.width = options.width;
    this.height = options.height;
    this.fps = options.fps;
    this.overwrite = options.overwrite;
    this.vectorComposition = options.vectorComposition;
    this.builderPromise = PdfDocumentBuilder.create({
      width: options.width,
      height: options.height,
      title: options.title,
    });
  }

  async addFrame(buffer: Buffer, index?: number): Promise<void> {
    const builder = await this.builderPromise;
    const frameIdx = index ?? this.frameCount;
    if (this.vectorComposition && isVectorOnly(this.vectorComposition)) {
      await appendVectorPage(builder.document, this.vectorComposition, frameIdx, {
        width: this.width,
        height: this.height,
      });
    } else {
      const pngBuf = rgbaToPng(buffer, this.width, this.height);
      await builder.addPngFrame(pngBuf);
    }
    this.frameCount++;
  }

  async finish(): Promise<EncoderResult> {
    if (!this.overwrite && (await stat(this.outputPath).catch(() => null))) {
      return { success: false, outputPath: this.outputPath, duration: 0, fileSize: 0, error: "Output exists (use overwrite)" };
    }
    const builder = await this.builderPromise;
    const built = await builder.finish();
    await withAtomicOutput(this.outputPath, async (staged) => {
      await writeFile(staged, built.buffer);
    });
    return {
      success: true,
      outputPath: this.outputPath,
      duration: this.frameCount / Math.max(1, this.fps),
      fileSize: built.buffer.length,
    };
  }
}

export class StillSink implements FrameSink {
  private readonly outputPath: string;
  private readonly format: StillImageFormat;
  private readonly width: number;
  private readonly height: number;
  private readonly overwrite: boolean;
  private readonly alpha: boolean;
  private readonly quality?: number;
  private readonly stagedPath: string;
  private firstFrameBuffer: Buffer | null = null;

  constructor(options: {
    outputPath: string;
    format: StillImageFormat;
    width: number;
    height: number;
    overwrite: boolean;
    alpha?: boolean;
    quality?: number;
  }) {
    this.outputPath = options.outputPath;
    this.format = options.format;
    this.width = options.width;
    this.height = options.height;
    this.overwrite = options.overwrite;
    this.alpha = options.alpha ?? false;
    this.quality = options.quality;
    this.stagedPath = `${options.outputPath}.${process.pid}.tmp.${options.format}`;
  }

  async addFrame(buffer: Buffer): Promise<void> {
    if (!this.firstFrameBuffer) {
      this.firstFrameBuffer = buffer;
    }
  }

  async finish(): Promise<EncoderResult> {
    if (!this.firstFrameBuffer) {
      return { success: false, outputPath: this.outputPath, duration: 0, fileSize: 0, error: "No frames supplied" };
    }
    const existing = await stat(this.outputPath).catch(() => null);
    if (existing && !this.overwrite) {
      return { success: false, outputPath: this.outputPath, duration: 0, fileSize: 0, error: "Output exists (use overwrite)" };
    }
    const pngBuf = rgbaToPng(this.firstFrameBuffer, this.width, this.height);
    const result = await encodeStillImage(pngBuf, this.stagedPath, this.format, {
      overwrite: true,
      alpha: this.alpha,
      quality: this.quality,
    });
    if (!result.success) {
      await rm(this.stagedPath, { force: true }).catch(() => undefined);
      return { success: false, outputPath: this.outputPath, duration: 0, fileSize: 0, error: result.error };
    }
    if (existing) await rm(this.outputPath, { force: true });
    await rename(this.stagedPath, this.outputPath);
    const fileSize = (await stat(this.outputPath).catch(() => null))?.size ?? 0;
    return {
      success: true,
      outputPath: this.outputPath,
      duration: 0,
      fileSize,
    };
  }

  async cancel(): Promise<void> {
    await rm(this.stagedPath, { force: true }).catch(() => undefined);
  }
}

export function createStrategySink(options: {
  plan: OutputPlan;
  format: RenderFormat;
  outputPath: string;
  composition: Composition;
  overwrite: boolean;
  gifQuality?: number;
  gifDither?: AnimatedGifOptions["dither"];
  gifMaxFrames?: number;
}): FrameSink | null {
  const { plan, format, outputPath, composition, overwrite } = options;
  if (plan.strategy === "animation") {
    return new AnimationSink({
      format: format === "apng" ? "apng" : "gif",
      outputPath,
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      overwrite,
      gif: {
        quality: options.gifQuality,
        dither: options.gifDither,
        maxFrames: options.gifMaxFrames,
      },
    });
  }
  if (plan.strategy === "sequence") {
    return new SequenceSink({
      outputDir: outputPath,
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      overwrite,
      format,
    });
  }
  if (plan.strategy === "document") {
    return new DocumentSink({
      outputPath,
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      title: composition.name,
      overwrite,
      vectorComposition: composition,
    });
  }
  if (plan.strategy === "still") {
    return new StillSink({
      outputPath,
      format: format === "jpg" ? "jpg" : format === "webp" ? "webp" : "png",
      width: composition.width,
      height: composition.height,
      overwrite,
      alpha: plan.alpha,
    });
  }
  return null;
}
