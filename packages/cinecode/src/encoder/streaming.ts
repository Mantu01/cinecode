import { spawn } from "node:child_process";
import { Transform, type TransformCallback } from "node:stream";
import { mkdir, rm } from "node:fs/promises";
import { resolveBinary } from "../binary/resolver.js";
import type { RenderFormat } from "../core/types/config.js";
import type { VideoEncoding } from "../core/quality.js";
import { frameInputPixFmt, outputPlanFor } from "../core/output-plan.js";
import { buildVideoEncoderArgs, type EncoderOptions, type EncoderResult } from "./index.js";

export interface FrameRingBufferOptions {
  readonly frameBytes: number;
  readonly capacity?: number;
}

export interface FrameRingBufferStats {
  readonly frameBytes: number;
  readonly capacity: number;
  readonly available: number;
  readonly inUse: number;
}

export class FrameRingBuffer {
  private readonly frameBytes: number;
  private readonly capacity: number;
  private readonly freeBuffers: Buffer[] = [];
  private readonly inUse = new Set<Buffer>();
  private capacityShadow = 0;

  constructor(options: FrameRingBufferOptions) {
    if (options.frameBytes <= 0) {
      throw new RangeError(`[CC2201] frameBytes must be positive, got ${options.frameBytes}`);
    }
    this.frameBytes = options.frameBytes;
    this.capacity = Math.max(1, options.capacity ?? 16);
    for (let i = 0; i < this.capacity; i += 1) {
      this.freeBuffers.push(Buffer.allocUnsafe(this.frameBytes));
    }
  }

  acquire(): Buffer {
    const buffer = this.freeBuffers.pop();
    if (buffer) {
      this.inUse.add(buffer);
      return buffer;
    }
    const overflow = Buffer.allocUnsafe(this.frameBytes);
    this.capacityShadow += 1;
    this.inUse.add(overflow);
    return overflow;
  }

  release(buffer: Buffer): void {
    if (!this.inUse.delete(buffer)) return;
    this.freeBuffers.push(buffer);
  }

  get size(): number {
    return this.freeBuffers.length;
  }

  get bufferLength(): number {
    return this.frameBytes;
  }

  getStats(): FrameRingBufferStats {
    return {
      frameBytes: this.frameBytes,
      capacity: this.capacity + this.capacityShadow,
      available: this.freeBuffers.length,
      inUse: this.inUse.size,
    };
  }

  dispose(): void {
    this.freeBuffers.length = 0;
    this.inUse.clear();
  }
}

export interface StreamingEncoderOptions {
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly outputPath: string;
  readonly tempDir: string;
  readonly encoding: VideoEncoding;
  readonly format?: RenderFormat;
  readonly alpha?: boolean;
  readonly overwrite?: boolean;
  readonly highWaterMark?: number;
  readonly fragmented?: boolean;
  readonly bitrateKbps?: number;
}

export class StreamingEncoder {
  private readonly options: StreamingEncoderOptions;
  private readonly highWaterMark: number;
  private process: ReturnType<typeof spawn> | null = null;
  private stdin: NodeJS.WritableStream | null = null;
  private stderr = "";
  private stdinError = "";
  private frameCount = 0;
  private pendingFrames = 0;
  private paused = false;
  private closed = false;
  private failure: Error | null = null;
  private readonly waiters: Array<() => void> = [];
  private readonly completion: Promise<EncoderResult>;
  private resolveCompletion!: (result: EncoderResult) => void;

  constructor(options: StreamingEncoderOptions) {
    this.options = options;
    this.highWaterMark = Math.max(1, options.highWaterMark ?? 16);
    this.completion = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });
  }

  get bufferedFrames(): number {
    return this.pendingFrames;
  }

  get capacity(): number {
    return this.highWaterMark;
  }

  get frameTotal(): number {
    return this.frameCount;
  }

  get writable(): boolean {
    return !this.paused && this.failure === null && !this.closed;
  }

  private buildArgs(): string[] {
    const format = this.options.format;
    const alpha = this.options.alpha === true || outputPlanFor(format).defaultAlpha === true;
    const encoderOptions: EncoderOptions = {
      fps: this.options.fps,
      width: this.options.width,
      height: this.options.height,
      crf: this.options.encoding.crf,
      preset: this.options.encoding.preset,
      pixFmt: this.options.encoding.pixFmt,
      codec: this.options.encoding.codec,
      backend: this.options.encoding.backend,
      format,
      alpha,
      outputPath: this.options.outputPath,
      tempDir: this.options.tempDir,
      overwrite: this.options.overwrite ?? true,
      fragmented: this.options.fragmented !== false,
      bitrateKbps: this.options.bitrateKbps,
    };
    return [
      "-v", "error",
      "-y",
      "-f", "rawvideo",
      "-pix_fmt", frameInputPixFmt(alpha),
      "-s", `${this.options.width}x${this.options.height}`,
      "-r", String(this.options.fps),
      "-i", "-",
      ...buildVideoEncoderArgs(encoderOptions),
    ];
  }

  async start(): Promise<void> {
    await mkdir(this.options.tempDir, { recursive: true });
    const child = spawn(resolveBinary("ffmpeg").path, this.buildArgs(), {
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"],
    });
    this.process = child;
    const stdin = child.stdin;
    if (!stdin) {
      throw new Error("[CC2202] Failed to open ffmpeg stdin for streaming encode");
    }
    this.stdin = stdin;
    stdin.on("error", (error) => {
      this.stdinError = error.message;
    });
    child.stderr?.on("data", (chunk) => {
      this.stderr += chunk.toString();
    });
    child.on("error", (error) => {
      this.fail(new Error(`Failed to spawn ffmpeg: ${error.message}`));
    });
    child.on("close", (code) => {
      this.closed = true;
      if (code !== 0) {
        const error = `[CC2203] Streaming encode failed: ${this.stderr.trim() || this.stdinError || `exit code ${code}`}`;
        this.resolveCompletion({
          success: false,
          outputPath: this.options.outputPath,
          duration: this.frameCount / this.options.fps,
          fileSize: 0,
          error,
        });
        this.fail(new Error(error));
        return;
      }
      this.resolveCompletion({
        success: true,
        outputPath: this.options.outputPath,
        duration: this.frameCount / this.options.fps,
        fileSize: 0,
      });
      this.flushWaiters();
    });
  }

  private fail(error: Error): void {
    if (!this.failure) this.failure = error;
    this.flushWaiters();
  }

  private flushWaiters(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.();
    }
  }

  private async awaitDrain(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      this.stdin?.once("drain", () => resolve());
    });
  }

  async writeFrame(buffer: Buffer): Promise<void> {
    if (this.failure) throw this.failure;
    if (this.closed || !this.stdin) throw new Error("[CC2204] Streaming encoder is not accepting frames");
    const expected = this.options.width * this.options.height * 4;
    if (buffer.length !== expected) {
      throw new RangeError(`[CC2205] Frame buffer must be ${expected} bytes, got ${buffer.length}`);
    }
    while (this.pendingFrames >= this.highWaterMark) {
      this.paused = true;
      await this.awaitDrain();
      if (this.failure) throw this.failure;
      if (this.closed) throw new Error("[CC2204] Streaming encoder closed while waiting for drain");
    }
    this.paused = false;
    this.pendingFrames += 1;
    await new Promise<void>((resolve, reject) => {
      this.stdin!.write(buffer, (error) => {
        this.pendingFrames = Math.max(0, this.pendingFrames - 1);
        if (this.waiters.length > 0) this.flushWaiters();
        if (error) {
          reject(new Error(`[CC2206] ffmpeg stdin write failed: ${error.message}`));
          return;
        }
        this.frameCount += 1;
        resolve();
      });
    });
  }

  async addFrame(buffer: Buffer): Promise<void> {
    return this.writeFrame(buffer);
  }

  async finish(): Promise<EncoderResult> {
    if (this.stdin && !this.closed) {
      this.stdin.end();
    }
    return this.completion;
  }

  async cancel(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill("SIGINT");
      await new Promise<void>((resolve) => {
        this.process!.once("close", () => resolve());
        setTimeout(resolve, 1000);
      });
    }
    this.closed = true;
    this.failure ??= new Error("Streaming encode cancelled");
    this.flushWaiters();
    await rm(this.options.outputPath, { force: true });
  }
}

export function createStreamingEncoder(options: StreamingEncoderOptions): StreamingEncoder {
  return new StreamingEncoder(options);
}

export function createFrameStream(encoder: StreamingEncoder): Transform {
  return new Transform({
    highWaterMark: encoder.capacity,
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      encoder
        .writeFrame(chunk)
        .then(() => callback())
        .catch((error: unknown) => callback(error instanceof Error ? error : new Error(String(error))));
    },
  });
}

export function streamingFrameBuffer(width: number, height: number, capacity = 16): FrameRingBuffer {
  return new FrameRingBuffer({ frameBytes: width * height * 4, capacity });
}
