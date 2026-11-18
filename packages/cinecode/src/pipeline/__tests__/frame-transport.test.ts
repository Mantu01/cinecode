import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Canvas } from "@napi-rs/canvas";
import type { Composition } from "../../core/types/index.js";
import { renderVideo, FrameQueue } from "../index.js";
import type { FrameSink } from "../../encoder/two-pass.js";
import type { EncoderResult } from "../../encoder/index.js";
import {
  ByteBudget,
  estimateFrameBytes,
  resolveTransportBudget,
} from "../memory.js";
import { getFrameTransportStats, resetFrameTransportStats } from "../frame-format.js";
import { ByteBoundedCache, getRendererCacheStats } from "../../renderer/pool.js";
import { clearRendererCaches } from "../../renderer/engine.js";

const WIDTH = 64;
const HEIGHT = 48;

function composition(frames = 4): Composition {
  return {
    name: "transport",
    width: WIDTH,
    height: HEIGHT,
    fps: 10,
    duration: frames / 10,
    background: "#000000",
    audio: { sampleRate: 48000, channels: 2, masterVolume: 1 },
    rootTimeline: {
      tracks: [
        {
          name: "visual",
          kind: "visual",
          clips: [
            {
              type: "solid",
              color: "#3366ff",
              width: WIDTH,
              height: HEIGHT,
              start: 0,
              duration: frames / 10,
            },
          ],
        },
      ],
    },
  };
}

function frame(index: number): { index: number; buffer: Buffer } {
  return { index, buffer: Buffer.alloc(WIDTH * HEIGHT * 4) };
}

class RecordingSink implements FrameSink {
  readonly written: number[] = [];
  async addFrame(buffer: Buffer): Promise<void> {
    this.written.push(buffer.readUInt32LE(0));
  }
  async finish(): Promise<EncoderResult> {
    return { success: true, outputPath: "memory", duration: 0, fileSize: 0 };
  }
}

function tagged(index: number): Buffer {
  const buffer = Buffer.alloc(WIDTH * HEIGHT * 4);
  buffer.writeUInt32LE(index, 0);
  return buffer;
}

test("the byte budget never exceeds its limit under a fast producer", async () => {
  const budget = new ByteBudget(4 * 1024);
  let peak = 0;
  const reservations: Promise<void>[] = [];
  for (let index = 0; index < 10; index += 1) {
    reservations.push(
      budget.reserve(1024).then(async () => {
        peak = Math.max(peak, budget.usedBytes);
        await new Promise((resolve) => setTimeout(resolve, 2));
        budget.release(1024);
      }),
    );
  }
  await Promise.all(reservations);
  assert.ok(peak <= budget.limitBytes, `peak ${peak} over ${budget.limitBytes}`);
  assert.equal(budget.usedBytes, 0);
});

test("the frame queue preserves order and blocks on bytes, not frame count", async () => {
  const sink = new RecordingSink();
  const frameBytes = WIDTH * HEIGHT * 4;
  const budget = new ByteBudget(frameBytes * 2);
  const queue = new FrameQueue(sink, budget, frameBytes);
  let peakQueued = 0;
  const writes = Array.from({ length: 6 }, (_, index) => queue.enqueue(frame(index)));
  const watcher = setInterval(() => {
    peakQueued = Math.max(peakQueued, queue.queuedBytes);
  }, 0);
  await Promise.all(writes);
  clearInterval(watcher);
  await queue.close();
  assert.deepEqual(sink.written, [0, 0, 0, 0, 0, 0]);
  assert.ok(peakQueued <= budget.limitBytes, `queued ${peakQueued} over ${budget.limitBytes}`);
});

test("frame order survives bytes pressure with tagged buffers", async () => {
  const sink = new RecordingSink();
  const frameBytes = WIDTH * HEIGHT * 4;
  const budget = new ByteBudget(frameBytes * 2);
  const queue = new FrameQueue(sink, budget, frameBytes);
  await Promise.all(Array.from({ length: 8 }, (_, index) => queue.enqueue({ index, buffer: tagged(index) })));
  await queue.close();
  assert.deepEqual(sink.written, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("the transport budget bounds the 4K frame queue and chunk size", () => {
  const width = 3840;
  const height = 2160;
  const budget = resolveTransportBudget({
    width,
    height,
    concurrency: 4,
    chunkSize: 8,
    maxBytes: 512 * 1024 * 1024,
    availableBytes: 8 * 1024 * 1024 * 1024,
  });
  assert.equal(budget.source, "config");
  assert.ok(budget.maxQueuedFrames >= 2);
  assert.ok(budget.frameBytes === estimateFrameBytes(width, height));
  assert.ok(budget.maxQueuedFrames * budget.frameBytes <= budget.totalBytes);
  assert.ok(budget.chunkBytes <= budget.totalBytes);
  assert.match(budget.description, /frames max queued/);
});

test("worker frames arrive by transfer with no main-thread pixel copy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cinecode-transport-"));
  try {
    resetFrameTransportStats();
    const outputPath = join(dir, "out.mp4");
    await renderVideo({
      composition: composition(4),
      outputPath,
      cacheDir: join(dir, "cache"),
      seed: 1,
      concurrency: 2,
      chunkSize: 2,
      quality: "preview",
      format: "mp4",
      overwrite: true,
      fresh: true,
      noCache: true,
      silent: true,
    });
    const stats = getFrameTransportStats();
    assert.equal(stats.copiedFrames, 0, "received frames were cloned instead of transferred");
    assert.equal(stats.pixelCopies, 0, "main thread copied received pixels");
    assert.ok((await stat(outputPath)).size > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderer caches are byte-bounded, count evictions and shrink after a job", () => {
  const cache = new ByteBoundedCache<string, Canvas>(
    "test-canvases",
    1024,
    (canvas) => canvas.width * canvas.height * 4,
  );
  cache.set("a", new Canvas(32, 32));
  cache.set("b", new Canvas(32, 32));
  cache.set("c", new Canvas(32, 32));
  const limited = cache.stats();
  assert.ok(limited.evictions > 0);
  assert.ok(limited.bytes <= limited.maxBytes);
  cache.clear();

  const renderer = getRendererCacheStats();
  assert.ok(renderer.length > 0);
  assert.ok(renderer.every((entry) => entry.maxBytes > 0));
  clearRendererCaches();
  assert.ok(getRendererCacheStats().every((entry) => entry.bytes === 0));
});

test("a full render leaves every renderer cache empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cinecode-cache-shrink-"));
  try {
    await renderVideo({
      composition: composition(2),
      outputPath: join(dir, "out.mp4"),
      cacheDir: join(dir, "cache"),
      seed: 1,
      concurrency: 1,
      chunkSize: 1,
      quality: "preview",
      format: "mp4",
      overwrite: true,
      fresh: true,
      noCache: true,
      silent: true,
    });
    assert.ok(getRendererCacheStats().every((entry) => entry.bytes === 0));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
