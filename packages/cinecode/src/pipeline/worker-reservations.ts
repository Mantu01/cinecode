import type { ByteBudget } from "./memory.js";
import { formatBytes } from "./memory.js";
import type { ChunkIdentity, FrameChunk } from "./chunk-identity.js";
import { assertChunkFits, chunkBytes, chunkLimit } from "./worker-chunks.js";

export interface ReservationHost {
  readonly budget: () => ByteBudget | undefined;
  readonly maxChunkBytes: () => number | undefined;
  readonly onTight: () => void;
  readonly notifyBudget: () => void;
}

export class ChunkReservations {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly host: ReservationHost,
    private readonly frameWidth: number,
    private readonly frameHeight: number,
  ) {}

  estimate(chunk: FrameChunk): number {
    return chunkBytes(chunk, this.frameWidth, this.frameHeight);
  }

  assertFits(bytes: number): void {
    assertChunkFits(bytes, chunkLimit(this.host.maxChunkBytes(), this.host.budget()));
  }

  tryReserve(chunk: FrameChunk): number | null {
    const bytes = this.estimate(chunk);
    this.assertFits(bytes);
    const budget = this.host.budget();
    if (!budget) return 0;
    const reservation = budget.tryReserve(bytes);
    if (!reservation.ok) {
      if (reservation.reason === "over-limit") {
        throw new Error(
          `Render chunk needs ${formatBytes(bytes)} of frames, over the ${formatBytes(budget.limitBytes)} chunk budget. Reduce the chunk size or raise the render memory budget.`,
        );
      }
      return null;
    }
    this.host.onTight();
    return bytes;
  }

  async reserve(chunk: FrameChunk): Promise<number> {
    const bytes = this.estimate(chunk);
    const budget = this.host.budget();
    if (!budget) return 0;
    this.assertFits(bytes);
    const reservation = await budget.reserve(bytes);
    if (!reservation.ok) {
      throw new Error(
        `Render chunk needs ${formatBytes(bytes)} of frames, over the ${formatBytes(budget.limitBytes)} chunk budget. Reduce the chunk size or raise the render memory budget.`,
      );
    }
    this.host.onTight();
    return bytes;
  }

  track(id: string, bytes: number): void {
    if (bytes > 0) this.entries.set(id, bytes);
  }

  release(target: ChunkIdentity | string | number): void {
    const id = typeof target === "object" ? target.id : String(target);
    let active = this.entries.get(id);
    if (active === undefined && typeof target === "number") {
      for (const [key, value] of this.entries.entries()) {
        if (key.startsWith(`chunk-${target}.`) || key === String(target)) {
          active = value;
          this.entries.delete(key);
          break;
        }
      }
    } else {
      this.entries.delete(id);
    }
    if (active) {
      this.host.budget()?.release(active);
      this.host.notifyBudget();
    }
  }

  drop(identity: ChunkIdentity, bytes: number): void {
    this.entries.delete(identity.id);
    if (bytes > 0) this.host.budget()?.release(bytes);
  }

  total(): number {
    let reserved = 0;
    for (const bytes of this.entries.values()) reserved += bytes;
    return reserved;
  }

  releaseAll(): void {
    for (const bytes of this.entries.values()) {
      if (bytes > 0) this.host.budget()?.release(bytes);
    }
    this.entries.clear();
  }
}
