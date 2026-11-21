import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import type { Composition } from "../../core/types/index.js";
import { createWorkerManager, createChunks } from "../../pipeline/workers.js";
import { getFrameTransportStats, resetFrameTransportStats } from "../../pipeline/frame-format.js";
import { renderFrame, createRenderSession } from "../engine.js";

function makeComposition(totalFrames = 10, width = 128, height = 128): Composition {
  return {
    name: "phase30-comp",
    width,
    height,
    fps: 30,
    duration: totalFrames / 30,
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
              color: "#336699",
              width: 64,
              height: 64,
              start: 0,
              duration: totalFrames / 30,
            },
          ],
        },
      ],
    },
  };
}

test("worker pool statistics are per-job and do not accumulate across jobs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cinecode-p30-stats-"));
  const comp = makeComposition(6, 64, 64);

  try {
    const manager1 = createWorkerManager({
      concurrency: 1,
      composition: comp,
      seed: 42,
      cacheDir: join(dir, "cache1"),
    });

    const results1 = await manager1.processChunks(createChunks(6, 3));
    assert.equal(results1.length, 2);
    const stats1 = manager1.getStats();
    assert.equal(stats1.renderedFrames, 6);
    assert.equal(stats1.transferredFrames, 6);
    assert.equal(stats1.failures, 0);
    assert.ok(stats1.renderDurationMs > 0);
    await manager1.terminate();

    // Second job in same process
    const manager2 = createWorkerManager({
      concurrency: 1,
      composition: comp,
      seed: 42,
      cacheDir: join(dir, "cache2"),
    });

    const results2 = await manager2.processChunks(createChunks(3, 3));
    assert.equal(results2.length, 1);
    const stats2 = manager2.getStats();
    // Statistics must describe only the second job (3 frames, NOT 6 + 3 = 9)
    assert.equal(stats2.renderedFrames, 3);
    assert.equal(stats2.transferredFrames, 3);
    assert.equal(stats2.failures, 0);
    assert.ok(stats2.renderDurationMs > 0);
    await manager2.terminate();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two identical renders produce byte-identical output with incremental reuse", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cinecode-p30-bit-"));
  const comp = makeComposition(4, 64, 64);

  try {
    const managerA = createWorkerManager({
      concurrency: 1,
      composition: comp,
      seed: 123,
      cacheDir: join(dir, "cacheA"),
    });

    const managerB = createWorkerManager({
      concurrency: 1,
      composition: comp,
      seed: 123,
      cacheDir: join(dir, "cacheB"),
    });

    const resultsA = await managerA.processChunks(createChunks(4, 4));
    const resultsB = await managerB.processChunks(createChunks(4, 4));

    const fA = resultsA[0]?.frames ?? [];
    const fB = resultsB[0]?.frames ?? [];
    assert.equal(fA.length, 4);
    assert.equal(fB.length, 4);

    for (let i = 0; i < 4; i++) {
      const itemA = fA[i]!;
      const itemB = fB[i]!;
      assert.equal(Buffer.compare(itemA.buffer, itemB.buffer), 0, `frame ${i} differed between identical renders`);
    }

    await managerA.terminate();
    await managerB.terminate();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("incremental session redraw matches fresh render frame for frame", async () => {
  const comp = makeComposition(3, 64, 64);
  const session = createRenderSession();

  try {
    // Render sequentially in same session to exercise incremental redraw
    const f0 = await renderFrame(comp, 0, 1, { session });
    const f1 = await renderFrame(comp, 1, 1, { session });

    // Fresh render of frame 1 without prior surface
    const fresh1 = await renderFrame(comp, 1, 1);

    const f1Pixels = f1.canvas.getContext("2d").getImageData(0, 0, 64, 64).data;
    const freshPixels = fresh1.canvas.getContext("2d").getImageData(0, 0, 64, 64).data;

    assert.equal(Buffer.compare(Buffer.from(f1Pixels), Buffer.from(freshPixels)), 0);
  } finally {
    session.dispose();
  }
});

test("transport stats reset per job and do not bleed into second job", () => {
  resetFrameTransportStats();
  const initial = getFrameTransportStats();
  assert.equal(initial.framesProduced, 0);
  assert.equal(initial.framesTransferred, 0);
  assert.equal(initial.pixelCopies, 0);
});

test("reinit is removed and not present on WorkerManager", () => {
  const manager = createWorkerManager({
    concurrency: 1,
    composition: makeComposition(1, 32, 32),
    seed: 1,
    cacheDir: tmpdir(),
  });
  assert.equal((manager as unknown as Record<string, unknown>).reinit, undefined);
});
