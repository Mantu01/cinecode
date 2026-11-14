import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../encoder/output.js";

export interface EncoderCheckpointState {
  readonly framesEncoded: number;
  readonly lastFrame: number;
  readonly outputPath?: string;
}

export interface AudioCheckpointState {
  readonly mixed: boolean;
  readonly sampleRate: number;
  readonly channels: number;
  readonly checksum?: string;
}

export interface RenderCheckpoint {
  readonly version: 2;
  readonly renderSessionId: string;
  readonly compositionId: string;
  readonly compositionHash: string;
  readonly totalFrames: number;
  readonly renderedFrames: readonly number[];
  readonly renderedFrameBitmask: string;
  readonly frameHashes: Readonly<Record<string, string>>;
  readonly activeEncoderState: EncoderCheckpointState | null;
  readonly audioMixState: AudioCheckpointState | null;
  readonly timestamp: number;
}

export interface CheckpointManagerOptions {
  readonly cacheDir: string;
  readonly compositionId: string;
  readonly compositionHash: string;
  readonly totalFrames: number;
  readonly renderSessionId?: string;
  readonly checkpointInterval?: number;
}

const CHECKPOINT_INTERVAL_DEFAULT = 100;

export function encodeFrameBitmask(frames: Iterable<number>): string {
  const indexes = [...frames].sort((left, right) => left - right);
  const highest = indexes[indexes.length - 1] ?? -1;
  const bytes = new Uint8Array(Math.floor(highest / 8) + 1);
  for (const index of indexes) {
    if (index < 0) continue;
    const byteIndex = Math.floor(index / 8);
    bytes[byteIndex] = (bytes[byteIndex] ?? 0) | (1 << (index % 8));
  }
  return Buffer.from(bytes).toString("base64");
}

export function decodeFrameBitmask(bitmask: string): number[] {
  const frames: number[] = [];
  if (!bitmask) return frames;
  const bytes = Buffer.from(bitmask, "base64");
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
    const value = bytes[byteIndex] ?? 0;
    if (value === 0) continue;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((value & (1 << bit)) !== 0) frames.push(byteIndex * 8 + bit);
    }
  }
  return frames;
}

export class CheckpointManager {
  private readonly checkpointsDir: string;
  private readonly chunksDir: string;
  private readonly compositionId: string;
  private readonly compositionHash: string;
  private readonly totalFrames: number;
  private readonly checkpointInterval: number;
  private sessionId: string;
  private rendered = new Set<number>();
  private hashes = new Map<number, string>();
  private encoderState: EncoderCheckpointState | null = null;
  private audioState: AudioCheckpointState | null = null;
  private framesSinceFlush = 0;
  private loadedFromDisk = false;

  constructor(options: CheckpointManagerOptions) {
    this.checkpointsDir = join(options.cacheDir, "checkpoints");
    this.chunksDir = join(options.cacheDir, "chunks");
    this.compositionId = options.compositionId;
    this.compositionHash = options.compositionHash;
    this.totalFrames = options.totalFrames;
    this.checkpointInterval = Math.max(1, options.checkpointInterval ?? CHECKPOINT_INTERVAL_DEFAULT);
    this.sessionId = options.renderSessionId ?? `${options.compositionHash}-${Date.now().toString(36)}`;
  }

  get checkpointPath(): string {
    return join(this.checkpointsDir, `${this.sessionId}.json`);
  }

  get chunkDirectory(): string {
    return join(this.chunksDir, this.sessionId);
  }

  get renderSessionId(): string {
    return this.sessionId;
  }

  async initialize(): Promise<void> {
    await mkdir(this.checkpointsDir, { recursive: true });
    await mkdir(this.chunkDirectory, { recursive: true });
  }

  async load(): Promise<RenderCheckpoint | null> {
    try {
      const raw = await readFile(this.checkpointPath, "utf-8");
      const checkpoint = JSON.parse(raw) as RenderCheckpoint;
      this.hydrate(checkpoint);
      return checkpoint;
    } catch {
      return null;
    }
  }

  async findLatestCheckpoint(): Promise<RenderCheckpoint | null> {
    const files = await readdir(this.checkpointsDir).catch(() => []);
    let latest: RenderCheckpoint | null = null;
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(this.checkpointsDir, file), "utf-8");
        const checkpoint = JSON.parse(raw) as RenderCheckpoint;
        if (checkpoint.compositionHash !== this.compositionHash) continue;
        if (checkpoint.totalFrames !== this.totalFrames) continue;
        if (latest === null || checkpoint.timestamp > latest.timestamp) latest = checkpoint;
      } catch {
        continue;
      }
    }
    if (latest) {
      this.sessionId = latest.renderSessionId;
      this.hydrate(latest);
    }
    return latest;
  }

  private hydrate(checkpoint: RenderCheckpoint): void {
    this.rendered = new Set(checkpoint.renderedFrames ?? decodeFrameBitmask(checkpoint.renderedFrameBitmask));
    this.hashes = new Map(Object.entries(checkpoint.frameHashes ?? {}).map(([key, value]) => [Number(key), value]));
    this.encoderState = checkpoint.activeEncoderState ?? null;
    this.audioState = checkpoint.audioMixState ?? null;
    this.framesSinceFlush = 0;
    this.loadedFromDisk = true;
  }

  markFrame(frameIndex: number, hash?: string): void {
    this.rendered.add(frameIndex);
    if (hash !== undefined) this.hashes.set(frameIndex, hash);
    this.framesSinceFlush += 1;
  }

  markFrames(frames: readonly number[]): void {
    for (const frame of frames) this.rendered.add(frame);
    this.framesSinceFlush += frames.length;
  }

  shouldFlush(): boolean {
    return this.framesSinceFlush >= this.checkpointInterval;
  }

  setEncoderState(state: EncoderCheckpointState | null): void {
    this.encoderState = state;
  }

  setAudioMixState(state: AudioCheckpointState | null): void {
    this.audioState = state;
  }

  getCompletedFrames(): readonly number[] {
    return [...this.rendered].sort((left, right) => left - right);
  }

  hasFrame(frameIndex: number): boolean {
    return this.rendered.has(frameIndex);
  }

  isComplete(): boolean {
    return this.totalFrames > 0 && this.rendered.size >= this.totalFrames;
  }

  getProgress(): number {
    if (this.totalFrames <= 0) return 1;
    return Math.min(1, this.rendered.size / this.totalFrames);
  }

  getLoadedFromDisk(): boolean {
    return this.loadedFromDisk;
  }

  toJSON(): RenderCheckpoint {
    const renderedFrames = this.getCompletedFrames();
    return {
      version: 2,
      renderSessionId: this.sessionId,
      compositionId: this.compositionId,
      compositionHash: this.compositionHash,
      totalFrames: this.totalFrames,
      renderedFrames,
      renderedFrameBitmask: encodeFrameBitmask(renderedFrames),
      frameHashes: Object.fromEntries([...this.hashes.entries()].map(([key, value]) => [String(key), value])),
      activeEncoderState: this.encoderState,
      audioMixState: this.audioState,
      timestamp: Date.now(),
    };
  }

  async flush(): Promise<void> {
    await mkdir(this.checkpointsDir, { recursive: true });
    await writeFileAtomic(this.checkpointPath, JSON.stringify(this.toJSON()));
    this.framesSinceFlush = 0;
  }

  async flushIfNeeded(): Promise<boolean> {
    if (!this.shouldFlush()) return false;
    await this.flush();
    return true;
  }

  async saveChunk(chunkIndex: number, frames: readonly { readonly index: number; readonly buffer: Buffer }[]): Promise<string> {
    await mkdir(this.chunkDirectory, { recursive: true });
    const path = join(this.chunkDirectory, `${chunkIndex}.raw`);
    const manifest = join(this.chunkDirectory, `${chunkIndex}.json`);
    const combined = Buffer.concat(frames.map((frame) => frame.buffer));
    await writeFileAtomic(path, combined);
    await writeFileAtomic(manifest, JSON.stringify({
      chunkIndex,
      frames: frames.map((frame) => ({ index: frame.index, length: frame.buffer.length })),
    }));
    return path;
  }

  async clear(): Promise<void> {
    await rm(this.checkpointPath, { force: true }).catch(() => undefined);
    await rm(this.chunkDirectory, { recursive: true, force: true }).catch(() => undefined);
  }

  async clearAllCheckpoints(): Promise<void> {
    await rm(this.checkpointsDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function createCheckpointManager(options: CheckpointManagerOptions): CheckpointManager {
  return new CheckpointManager(options);
}
