import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface ChunkState {
  readonly index: number;
  readonly completed: boolean;
  readonly frameCount: number;
}

export interface ResumeState {
  readonly version: 1;
  readonly compositionHash: string;
  readonly totalFrames: number;
  readonly chunkSize: number;
  readonly totalChunks: number;
  readonly chunks: readonly ChunkState[];
  readonly startTime: number;
  readonly lastUpdate: number;
}

const RESUME_FILE = "resume.json";

export class ResumeManager {
  private readonly cacheDir: string;
  private state: ResumeState | null = null;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  async initialize(totalFrames: number, chunkSize: number, compositionHash: string): Promise<void> {
    const totalChunks = Math.ceil(totalFrames / chunkSize);
    const chunks: ChunkState[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const startFrame = i * chunkSize;
      const endFrame = Math.min(startFrame + chunkSize, totalFrames);
      chunks.push({
        index: i,
        completed: false,
        frameCount: endFrame - startFrame,
      });
    }

    this.state = {
      version: 1,
      compositionHash,
      totalFrames,
      chunkSize,
      totalChunks,
      chunks,
      startTime: Date.now(),
      lastUpdate: Date.now(),
    };

    await this.save();
  }

  async load(): Promise<ResumeState | null> {
    const resumePath = join(this.cacheDir, RESUME_FILE);
    try {
      const content = await readFile(resumePath, "utf-8");
      this.state = JSON.parse(content);
      return this.state;
    } catch {
      return null;
    }
  }

  async save(): Promise<void> {
    if (!this.state) return;
    const resumePath = join(this.cacheDir, RESUME_FILE);
    await mkdir(this.cacheDir, { recursive: true });
    this.state = { ...this.state, lastUpdate: Date.now() };
    await writeFile(resumePath, JSON.stringify(this.state));
  }

  getState(): ResumeState | null {
    return this.state;
  }

  markChunkCompleted(chunkIndex: number): void {
    if (!this.state) return;
    const chunks = [...this.state.chunks];
    const existing = chunks[chunkIndex];
    if (existing) {
      chunks[chunkIndex] = { ...existing, completed: true };
      this.state = { ...this.state, chunks, lastUpdate: Date.now() };
    }
  }

  getNextPendingChunk(): number | null {
    if (!this.state) return null;
    for (const chunk of this.state.chunks) {
      if (!chunk.completed) return chunk.index;
    }
    return null;
  }

  getCompletedChunks(): number {
    if (!this.state) return 0;
    return this.state.chunks.filter(c => c.completed).length;
  }

  getTotalChunks(): number {
    return this.state?.totalChunks ?? 0;
  }

  getProgress(): number {
    if (!this.state) return 0;
    const completed = this.state.chunks.filter(c => c.completed).length;
    return completed / this.state.totalChunks;
  }

  async clear(): Promise<void> {
    const resumePath = join(this.cacheDir, RESUME_FILE);
    await rm(resumePath, { force: true });
    this.state = null;
  }

  canResume(compositionHash: string, totalFrames: number, chunkSize: number): boolean {
    if (!this.state) return false;
    if (this.state.compositionHash !== compositionHash) return false;
    if (this.state.totalFrames !== totalFrames) return false;
    if (this.state.chunkSize !== chunkSize) return false;
    return true;
  }
}

export function createResumeManager(cacheDir: string): ResumeManager {
  return new ResumeManager(cacheDir);
}