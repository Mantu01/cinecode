export interface PixelBufferPoolOptions {
  readonly width: number;
  readonly height: number;
  readonly capacity?: number;
  readonly shared?: boolean;
}

export interface PixelBufferStats {
  readonly frameBytes: number;
  readonly capacity: number;
  readonly available: number;
  readonly inUse: number;
  readonly shared: boolean;
}

export class PixelBufferPool {
  private readonly frameBytes: number;
  private readonly frameWidth: number;
  private readonly frameHeight: number;
  private readonly capacity: number;
  private readonly shared: boolean;
  private readonly free: Buffer[] = [];
  private readonly inUse = new Set<Buffer>();

  constructor(options: PixelBufferPoolOptions) {
    if (options.width <= 0 || options.height <= 0) {
      throw new RangeError(`[CC2301] Pixel buffer dimensions must be positive, got ${options.width}x${options.height}`);
    }
    this.frameWidth = options.width;
    this.frameHeight = options.height;
    this.frameBytes = options.width * options.height * 4;
    this.capacity = Math.max(1, options.capacity ?? 8);
    this.shared = options.shared === true;
    for (let i = 0; i < this.capacity; i += 1) this.free.push(this.allocate());
  }

  private allocate(): Buffer {
    if (!this.shared) return Buffer.allocUnsafe(this.frameBytes);
    const shared = new SharedArrayBuffer(this.frameBytes);
    return Buffer.from(shared);
  }

  get width(): number {
    return this.frameWidth;
  }

  get height(): number {
    return this.frameHeight;
  }

  get bufferSize(): number {
    return this.frameBytes;
  }

  acquire(): Buffer {
    const buffer = this.free.pop() ?? this.allocate();
    this.inUse.add(buffer);
    return buffer;
  }

  release(buffer: Buffer): void {
    if (!this.inUse.delete(buffer)) return;
    if (buffer.length !== this.frameBytes) return;
    this.free.push(buffer);
  }

  withBuffer<T>(fn: (buffer: Buffer) => T): T {
    const buffer = this.acquire();
    try {
      return fn(buffer);
    } finally {
      this.release(buffer);
    }
  }

  getStats(): PixelBufferStats {
    return {
      frameBytes: this.frameBytes,
      capacity: this.free.length + this.inUse.size,
      available: this.free.length,
      inUse: this.inUse.size,
      shared: this.shared,
    };
  }

  dispose(): void {
    this.free.length = 0;
    this.inUse.clear();
  }
}

export function createPixelBufferPool(options: PixelBufferPoolOptions): PixelBufferPool {
  return new PixelBufferPool(options);
}
