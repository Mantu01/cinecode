import { Command } from "commander";
import { createError, ErrorCode } from "../errors/codes.js";
import { runReport } from "./run-report.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Canvas } from "@napi-rs/canvas";
import type { Composition } from "../core/types/index.js";
import { renderStill } from "../renderer/engine.js";
import { clearTempCanvasPool } from "../effects/engine.js";
import { selectComposition } from "./composition-loader.js";
import { createProjectResolver } from "./project-resolver.js";

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

async function renderPair(a: Composition, b: Composition, frame: number, seed: number): Promise<ComparisonResult["frames"][number]> {
  clearTempCanvasPool();
  const left = await renderStill(a, frame, seed);
  clearTempCanvasPool();
  const right = await renderStill(b, frame, seed);
  const width = Math.min(left.width, right.width);
  const height = Math.min(left.height, right.height);
  const leftData = left.getContext("2d").getImageData(0, 0, width, height).data;
  const rightData = right.getContext("2d").getImageData(0, 0, width, height).data;
  let differing = 0;
  let total = 0;
  for (let i = 0; i < leftData.length; i += 4) {
    const dr = Math.abs(leftData[i]! - rightData[i]!);
    const dg = Math.abs(leftData[i + 1]! - rightData[i + 1]!);
    const db = Math.abs(leftData[i + 2]! - rightData[i + 2]!);
    const da = Math.abs(leftData[i + 3]! - rightData[i + 3]!);
    const delta = (dr + dg + db + da) / 4;
    total += delta;
    if (delta > 3) differing += 1;
  }
  const pixels = (width * height) || 1;
  return { frame, differingPixels: differing, averageDifference: total / pixels };
}

export async function compareCompositions(
  pathA: string,
  pathB: string,
  options: { frames?: number; seed?: number; diffOutput?: string; root?: string; config?: string; compositionA?: string; compositionB?: string },
): Promise<ComparisonResult> {
  const resA = await createProjectResolver({ root: options.root, config: options.config, file: pathA }).resolve();
  const resB = await createProjectResolver({ root: options.root, config: options.config, file: pathB }).resolve();
  const compositionA = selectComposition([...resA.compositions], options.compositionA);
  const compositionB = selectComposition([...resB.compositions], options.compositionB);
  const frameCount = Math.max(1, options.frames ?? 60);
  const seed = options.seed ?? 42;
  const frames: FrameComparison[] = [];

  for (let index = 0; index < frameCount; index += 1) {
    frames.push(await renderPair(compositionA, compositionB, index, seed));
  }

  if (options.diffOutput) {
    const worst = frames.reduce((max, entry) => (entry.averageDifference > max.averageDifference ? entry : max));
    const left = await renderStill(compositionA, worst.frame, seed);
    const right = await renderStill(compositionB, worst.frame, seed);
    const canvas = new Canvas(left.width * 2, left.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(left, 0, 0);
    ctx.drawImage(right, left.width, 0);
    await mkdir(dirname(options.diffOutput), { recursive: true });
    await writeFile(options.diffOutput, await canvas.encode("png"));
  }

  const average = frames.reduce((sum, entry) => sum + entry.averageDifference, 0) / frames.length;
  let max = 0;
  for (const entry of frames) {
    if (entry.averageDifference > max) max = entry.averageDifference;
  }
  const worstFrames = [...frames].sort((a, b) => b.averageDifference - a.averageDifference).slice(0, 5).map((entry) => entry.frame);
  return { frames, averageDifference: average, maxDifference: max, worstFrames };
}

export function createCompareCommand(): Command {
  return new Command("compare")
    .description("Render two compositions and report per-frame pixel differences")
    .argument("<a>", "First composition file")
    .argument("<b>", "Second composition file")
    .option("-n, --frames <number>", "Frames to compare", (value) => parseInt(value, 10), 60)
    .option("--seed <number>", "Deterministic seed", (value) => parseInt(value, 10))
    .option("--diff <path>", "Write a side-by-side diff image of the worst frame")
    .option("--composition-a <name>", "Composition name in first file")
    .option("--composition-b <name>", "Composition name in second file")
    .action(async (a: string, b: string, options: { frames: number; seed?: number; diff?: string; compositionA?: string; compositionB?: string; root?: string; config?: string }, command: Command) => {
      const merged = { ...command.optsWithGlobals(), ...options };
      const result = await compareCompositions(a, b, {
        frames: merged.frames,
        seed: merged.seed ?? 42,
        diffOutput: merged.diff,
        root: merged.root,
        config: merged.config,
        compositionA: merged.compositionA,
        compositionB: merged.compositionB,
      });
      console.log(`Frames compared: ${result.frames.length}`);
      console.log(`Average diff:    ${result.averageDifference.toFixed(4)} (0-255)`);
      console.log(`Max diff:        ${result.maxDifference.toFixed(4)}`);
      console.log(`Worst frames:    ${result.worstFrames.join(", ")}`);
      runReport.result({
        frames: result.frames,
        averageDifference: result.averageDifference,
        maxDifference: result.maxDifference,
        worstFrames: result.worstFrames,
      });
      if (options.diff) runReport.artifact({ kind: "diff", path: options.diff, units: 1, unit: "image" });
      if (result.maxDifference > 2) {
        throw createError(ErrorCode.CC9002, { reason: `max pixel difference ${result.maxDifference.toFixed(2)} exceeds 2.00` });
      }
    });
}
