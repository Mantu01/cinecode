import { Canvas, loadImage } from "@napi-rs/canvas";

export interface FrameScore {
  readonly score: number;
  readonly sharpness: number;
  readonly contrast: number;
  readonly exposure: number;
  readonly colorVariety: number;
  readonly motion: number;
}

const ANALYSIS_WIDTH = 320;

interface Metrics {
  readonly luminance: Float32Array;
  readonly width: number;
  readonly height: number;
}

async function analyzeFrame(frame: Buffer): Promise<Metrics> {
  const image = await loadImage(frame);
  const scale = Math.min(1, ANALYSIS_WIDTH / image.width);
  const width = Math.max(2, Math.round(image.width * scale));
  const height = Math.max(2, Math.round(image.height * scale));
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const luminance = new Float32Array(width * height);
  for (let i = 0; i < luminance.length; i += 1) {
    luminance[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  }
  return { luminance, width, height };
}

function laplacianVariance(metrics: Metrics): number {
  const { luminance, width, height } = metrics;
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value =
        -4 * luminance[index]! +
        luminance[index - 1]! +
        luminance[index + 1]! +
        luminance[index - width]! +
        luminance[index + width]!;
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

function contrastStdDev(metrics: Metrics): number {
  const values = metrics.luminance;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function colorVariety(metrics: Metrics): number {
  const { luminance, width, height } = metrics;
  const buckets = new Set<number>();
  for (let i = 0; i < luminance.length; i += 4) {
    const x = i % width;
    const y = Math.floor(i / width);
    const sample = luminance[y * width + x] ?? 0;
    buckets.add(Math.min(15, Math.floor((sample / 255) * 16)));
  }
  return buckets.size / 16;
}

function exposurePenalty(mean: number): number {
  const target = 128;
  return Math.max(0, 1 - Math.abs(mean - target) / target);
}

export async function scoreFrame(
  frame: Buffer,
  previous?: Buffer,
): Promise<FrameScore> {
  const metrics = await analyzeFrame(frame);
  const sharpnessRaw = laplacianVariance(metrics);
  const sharpness = Math.min(1, Math.sqrt(Math.max(0, sharpnessRaw)) / 40);
  const contrast = Math.min(1, contrastStdDev(metrics) / 80);
  const mean = metrics.luminance.reduce((total, value) => total + value, 0) / metrics.luminance.length;
  const exposure = exposurePenalty(mean);
  const variety = colorVariety(metrics);

  let motion = 0;
  if (previous) {
    const other = await analyzeFrame(previous);
    const length = Math.min(metrics.luminance.length, other.luminance.length);
    let difference = 0;
    for (let i = 0; i < length; i += 1) {
      difference += Math.abs(metrics.luminance[i]! - other.luminance[i]!);
    }
    motion = Math.min(1, difference / length / 40);
  }
  const motionPenalty = previous ? Math.max(0, 1 - Math.abs(motion - 0.25)) : 1;

  const score = Math.max(0, Math.min(1,
    0.3 * sharpness +
    0.25 * contrast +
    0.2 * exposure +
    0.15 * variety +
    0.1 * motionPenalty,
  ));

  return { score, sharpness, contrast, exposure, colorVariety: variety, motion };
}
