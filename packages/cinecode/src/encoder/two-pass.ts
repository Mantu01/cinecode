import { spawn } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { stat, rm } from "node:fs/promises";
import ffmpegStatic from "@ffmpeg-installer/ffmpeg";
import { buildVideoEncoderArgs, type EncoderOptions, type EncoderResult } from "./index.js";

export interface FrameSink {
  addFrame(buffer: Buffer): Promise<void>;
  finish(): Promise<EncoderResult>;
}

export class RawFrameSink implements FrameSink {
  private readonly stream: WriteStream;
  private readonly path: string;
  private closed = false;
  private bytes = 0;
  private failure: Error | null = null;

  constructor(path: string) {
    this.path = path;
    this.stream = createWriteStream(path);
    this.stream.on("error", (error) => {
      this.failure = error;
    });
  }

  get rawPath(): string {
    return this.path;
  }

  async addFrame(buffer: Buffer): Promise<void> {
    if (this.failure) throw this.failure;
    this.bytes += buffer.length;
    if (!this.stream.write(buffer)) {
      await new Promise<void>((resolve, reject) => {
        const onDrain = (): void => {
          cleanup();
          resolve();
        };
        const onError = (error: Error): void => {
          cleanup();
          reject(error);
        };
        const cleanup = (): void => {
          this.stream.off("drain", onDrain);
          this.stream.off("error", onError);
        };
        this.stream.once("drain", onDrain);
        this.stream.once("error", onError);
      });
    }
  }

  async finish(): Promise<EncoderResult> {
    if (!this.closed) {
      this.closed = true;
      await new Promise<void>((resolve, reject) => {
        this.stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
      });
    }
    if (this.failure) return { success: false, outputPath: this.path, duration: 0, fileSize: 0, error: this.failure.message };
    const info = await stat(this.path).catch(() => null);
    return { success: true, outputPath: this.path, duration: 0, fileSize: info?.size ?? this.bytes };
  }
}

export interface TwoPassOptions extends Omit<EncoderOptions, "pass" | "passLogFile"> {
  readonly rawPath: string;
  readonly bitrateKbps?: number;
  readonly onPass?: (pass: 1 | 2) => void;
}

function estimateBitrateKbps(width: number, height: number, fps: number, crf: number): number {
  const pixelsPerSecond = width * height * fps;
  const qualityFactor = Math.max(0.02, 0.12 - crf * 0.002);
  return Math.max(400, Math.round((pixelsPerSecond * qualityFactor) / 1000));
}

function runFfmpeg(args: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegStatic.path, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", () => resolve(1));
    child.on("close", (code) => {
      if (code !== 0 && stderr) process.stderr.write(stderr);
      resolve(code ?? 1);
    });
  });
}

export async function encodeTwoPass(options: TwoPassOptions): Promise<EncoderResult> {
  const passLogFile = `${options.rawPath.replace(/\.rgba$/, "")}-pass`;
  const bitrateKbps = options.bitrateKbps ?? estimateBitrateKbps(options.width, options.height, options.fps, options.crf);
  const input = [
    "-v", "error", "-y",
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-s", `${options.width}x${options.height}`,
    "-r", String(options.fps),
    "-i", options.rawPath,
  ];

  const pass1 = await runFfmpeg([
    ...input,
    ...buildVideoEncoderArgs({ ...options, pass: 1, passLogFile, bitrateKbps }),
  ]);
  if (pass1 !== 0) {
    return { success: false, outputPath: options.outputPath, duration: 0, fileSize: 0, error: `Two-pass analysis (pass 1) failed with exit code ${pass1}` };
  }

  options.onPass?.(2);
  const pass2 = await runFfmpeg([
    ...input,
    ...buildVideoEncoderArgs({ ...options, pass: 2, passLogFile, bitrateKbps }),
  ]);

  await Promise.all([
    rm(`${passLogFile}-0.log`, { force: true }),
    rm(`${passLogFile}-0.log.mbtree`, { force: true }),
  ]).catch(() => undefined);

  if (pass2 !== 0) {
    return { success: false, outputPath: options.outputPath, duration: 0, fileSize: 0, error: `Two-pass encode (pass 2) failed with exit code ${pass2}` };
  }

  const info = await stat(options.outputPath).catch(() => null);
  return { success: true, outputPath: options.outputPath, duration: 0, fileSize: info?.size ?? 0 };
}
