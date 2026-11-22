/**
 * Single source of truth for all Cinecode configuration and runtime defaults.
 * Covers: project roots & entry, video geometry & fps, image defaults,
 * render defaults, audio defaults, dev host/port/hmr, and binary paths.
 */

export const DEFAULT_PROJECT = {
  entry: "./main.ts",
  sourceDir: "./src",
  mediaDir: "./media",
  outputDir: "./output",
  cacheDir: ".cinecode/cache",
} as const;

export const DEFAULT_VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
  background: "#000000",
} as const;

export const DEFAULT_IMAGES = {
  defaultFormat: "png" as const,
  quality: 90,
  scaleFactor: 1,
} as const;

export const DEFAULT_DEV = {
  port: 3000,
  host: "127.0.0.1", // Loopback everywhere
  open: false,
  hmr: true,
} as const;

export const DEFAULT_AUDIO = {
  sampleRate: 48000,
  channels: 2 as const,
  masterVolume: 1,
} as const;

export const DEFAULT_COLOR_MANAGEMENT = {
  enabled: false,
  workingColorSpace: "srgb" as const,
  outputColorSpace: "srgb" as const,
} as const;

export const DEFAULT_CHUNK_SIZE = 50;
export const DEFAULT_MEMORY_BUDGET = "1GB";

/**
 * Adaptive chunk size rule:
 * Scales with composition length and worker pool size,
 * bounded between 10 and 100 frames to prevent worker starvation and memory blowup.
 */
export function calculateAdaptiveChunkSize(totalFrames: number, workerCount: number): number {
  if (workerCount <= 0 || totalFrames <= 0) return DEFAULT_CHUNK_SIZE;
  const targetChunksPerWorker = 4;
  const rawSize = Math.floor(totalFrames / (workerCount * targetChunksPerWorker));
  return Math.min(100, Math.max(10, rawSize));
}

export const DEFAULT_RENDER = {
  fps: 30,
  resolution: "1920x1080",
  format: "mp4" as const,
  quality: "medium" as const,
  codec: "h264" as const,
  preset: "slow" as const,
  hardwareAcceleration: "off" as const,
  concurrency: "auto" as const,
  chunkSize: DEFAULT_CHUNK_SIZE,
  memoryBudgetMb: 1024,
  colorManagement: DEFAULT_COLOR_MANAGEMENT,
} as const;

export const DEFAULT_BINARIES = {
  ffmpegPath: undefined as string | undefined,
  ffprobePath: undefined as string | undefined,
} as const;

export const DEFAULTS = {
  project: DEFAULT_PROJECT,
  video: DEFAULT_VIDEO,
  images: DEFAULT_IMAGES,
  dev: DEFAULT_DEV,
  audio: DEFAULT_AUDIO,
  render: DEFAULT_RENDER,
  binaries: DEFAULT_BINARIES,
  memoryBudget: DEFAULT_MEMORY_BUDGET,
  concurrency: "auto" as const,
  overwrite: false,
  gitignore: true,
  autoDiscoverPlugins: true,
  ignorePatterns: [] as readonly string[],
} as const;
