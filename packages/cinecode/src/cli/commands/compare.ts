import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Canvas, ImageData } from "@napi-rs/canvas";
import type { Composition } from "../../core/types/index.js";
import { UsageError } from "../shared/usage-error.js";
import { runReport } from "../output/run-report.js";
import { selectComposition } from "../resolve/composition-loader.js";
import { createProjectResolver } from "../resolve/project-resolver.js";
import { createChunks, createWorkerManager, type WorkerResult } from "../../pipeline/workers.js";

export interface FrameComparison {
  readonly frame: number;
  readonly differingPixels: number;
  readonly averageDifference: number;
}

export interface ComparisonResult {
  readonly frames: readonly FrameComparison[];
  readonly averageDifference: number;
  readonly maxDifference: number;
  readonly worstFrames: readonly number[];
}

interface RenderedComposition {
  readonly frames: Map<number, Buffer>;
  readonly cacheDir: string;
}

async function renderFrames(
  composition: Composition,
  frameCount: number,
  seed: number,
  cacheDir: string,
  concurrency: number,
): Promise<RenderedComposition> {
  const manager = createWorkerManager({
    concurrency: Math.max(1, Math.min(concurrency, frameCount)),
    composition,
    seed,
    cacheDir,
  });
  try {
    const chunks = createChunks(frameCount, Math.max(1, Math.ceil(frameCount / Math.max(1, concurrency))));
    const results = await manager.processChunks(chunks);
    const frames = new Map<number, Buffer>();
    for (const result of results as WorkerResult[]) {
      for (const frame of result.frames) frames.set(frame.index, Buffer.from(frame.buffer));
    }
    return { frames, cacheDir };
  } finally {
    await manager.terminate();
  }
}

function pixelStats(leftBuffer: Buffer, rightBuffer: Buffer, width: number, height: number): { differing: number; average: number } {
  const left = new Uint8ClampedArray(leftBuffer.buffer, leftBuffer.byteOffset, leftBuffer.byteLength);
  const right = new Uint8ClampedArray(rightBuffer.buffer, rightBuffer.byteOffset, rightBuffer.byteLength);
  let differing = 0;
  let total = 0;
  for (let index = 0; index < left.length; index += 4) {
    const delta = (
      Math.abs(left[index]! - right[index]!)
      + Math.abs(left[index + 1]! - right[index + 1]!)
      + Math.abs(left[index + 2]! - right[index + 2]!)
      + Math.abs(left[index + 3]! - right[index + 3]!)
    ) / 4;
    total += delta;
    if (delta > 3) differing += 1;
  }
  return { differing, average: total / ((width * height) || 1) };
}

function frameCanvas(buffer: Buffer, width: number, height: number): Canvas {
  const canvas = new Canvas(width, height);
  canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(buffer.buffer, buffer.byteOffset, buffer.byteLength), width, height), 0, 0);
  return canvas;
}

export async function compareCompositions(
  pathA: string,
  pathB: string,
  options: {
    frames?: number;
    seed?: number;
    diffOutput?: string;
    root?: string;
    config?: string;
    compositionA?: string;
    compositionB?: string;
    concurrency?: number;
  },
): Promise<ComparisonResult> {
  const resA = await createProjectResolver({ root: options.root, config: options.config, file: pathA }).resolve();
  const resB = await createProjectResolver({ root: options.root, config: options.config, file: pathB }).resolve();
  const compositionA = selectComposition([...resA.compositions], options.compositionA);
  const compositionB = selectComposition([...resB.compositions], options.compositionB);
  const frameCount = Math.max(1, options.frames ?? 10);
  const seed = options.seed ?? 42;
  const concurrency = options.concurrency ?? 4;

  const [left, right] = await Promise.all([
    renderFrames(compositionA, frameCount, seed, resA.context.roots.cache, concurrency),
    renderFrames(compositionB, frameCount, seed, resB.context.roots.cache, concurrency),
  ]);

  const frames: FrameComparison[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const leftBuffer = left.frames.get(frame);
    const rightBuffer = right.frames.get(frame);
    if (!leftBuffer || !rightBuffer) throw new UsageError(`Frame ${frame} was not produced by both compositions.`);
    const stats = pixelStats(leftBuffer, rightBuffer, compositionA.width, compositionA.height);
    frames.push({ frame, differingPixels: stats.differing, averageDifference: stats.average });
  }

  if (options.diffOutput) {
    const worst = frames.reduce((max, entry) => (entry.averageDifference > max.averageDifference ? entry : max));
    const leftBuffer = left.frames.get(worst.frame)!;
    const rightBuffer = right.frames.get(worst.frame)!;
    const leftCanvas = frameCanvas(leftBuffer, compositionA.width, compositionA.height);
    const rightCanvas = frameCanvas(rightBuffer, compositionB.width, compositionB.height);
    const canvas = new Canvas(leftCanvas.width + rightCanvas.width, Math.max(leftCanvas.height, rightCanvas.height));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(leftCanvas, 0, 0);
    ctx.drawImage(rightCanvas, leftCanvas.width, 0);
    await mkdir(dirname(options.diffOutput), { recursive: true });
    await writeFile(options.diffOutput, await canvas.encode("png"));
  }

  const average = frames.reduce((sum, entry) => sum + entry.averageDifference, 0) / frames.length;
  const max = frames.reduce((value, entry) => Math.max(value, entry.averageDifference), 0);
  const worstFrames = [...frames].sort((leftEntry, rightEntry) => rightEntry.averageDifference - leftEntry.averageDifference).slice(0, 5).map((entry) => entry.frame);
  return { frames, averageDifference: average, maxDifference: max, worstFrames };
}

export async function compareCommand(
  a: string,
  b: string,
  options: { frames?: number; seed?: number; diff?: string; compositionA?: string; compositionB?: string; root?: string; config?: string; failOnDifference?: boolean; concurrency?: number } = {},
): Promise<void> {
  const result = await compareCompositions(a, b, {
    frames: options.frames ?? 10,
    seed: options.seed ?? 42,
    diffOutput: options.diff,
    root: options.root,
    config: options.config,
    compositionA: options.compositionA,
    compositionB: options.compositionB,
    concurrency: options.concurrency,
  });
  if (!runReport.isMachine()) {
    runReport.diagnostic(`Frames compared: ${result.frames.length}`);
    runReport.diagnostic(`Average diff:    ${result.averageDifference.toFixed(4)} (0-255)`);
    runReport.diagnostic(`Max diff:        ${result.maxDifference.toFixed(4)}`);
    runReport.diagnostic(`Worst frames:    ${result.worstFrames.join(", ")}`);
  }
  runReport.result({
    frames: result.frames,
    averageDifference: result.averageDifference,
    maxDifference: result.maxDifference,
    worstFrames: result.worstFrames,
    identical: result.maxDifference === 0,
  });
  if (options.diff) runReport.artifact({ kind: "diff", path: options.diff, units: 1, unit: "image" });
  if (options.failOnDifference === true && result.maxDifference > 0) {
    throw new UsageError(`Compositions differ (max pixel difference ${result.maxDifference.toFixed(2)}).`);
  }
}

