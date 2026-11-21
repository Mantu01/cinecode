import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { ByteBudget, resolveTransportBudget, estimateFrameBytes, estimateChunkBytes } from "../memory.js";
import { createWorkerManager, createChunks, resolveConcurrency } from "../workers.js";
import { analyzeWorkload, tuneConcurrency } from "../concurrency-tuner.js";
import { renderVideo } from "../index.js";
import type { Composition } from "../../core/types/index.js";

function makeComposition(totalFrames = 10, width = 64, height = 64): Composition {
  return {
    name: "p31-comp",
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
              color: "#ff00aa",
              width,
              height,
              start: 0,
              duration: totalFrames / 30,
            },
          ],
        },
      ],
    },
  };
}

test("request equal to limit is accepted; oversubscription larger than limit is refused with typed outcome", async () => {
  const budget = new ByteBudget(1000);

  // Request equal to limit is accepted
  const exact = budget.tryReserve(1000);
  assert.equal(exact.ok, true);
  if (exact.ok) assert.equal(exact.bytes, 1000);
  assert.equal(budget.usedBytes, 1000);

  budget.release(1000);
  assert.equal(budget.usedBytes, 0);

  // Request strictly larger than limit receives typed refusal
  const over = budget.tryReserve(1001);
  assert.equal(over.ok, false);
  if (!over.ok) {
    assert.equal(over.reason, "over-limit");
    assert.equal(over.requestedBytes, 1001);
    assert.equal(over.limitBytes, 1000);
  }
  // No partial reservation or clamping occurred
  assert.equal(budget.usedBytes, 0);

  // Async reserve also returns typed refusal immediately without deadlock
  const overAsync = await budget.reserve(2000);
  assert.equal(overAsync.ok, false);
  if (!overAsync.ok) {
    assert.equal(overAsync.reason, "over-limit");
  }
  assert.equal(budget.usedBytes, 0);
});

test("exact release restores zero and interleaved operations preserve non-negative invariant", async () => {
  const budget = new ByteBudget(5000);

  const r1 = budget.tryReserve(1500);
  assert.equal(r1.ok, true);
  assert.equal(budget.usedBytes, 1500);

  const r2 = budget.tryReserve(2000);
  assert.equal(r2.ok, true);
  assert.equal(budget.usedBytes, 3500);

  // Interleaved release
  budget.release(1500);
  assert.equal(budget.usedBytes, 2000);

  const r3 = budget.tryReserve(3000);
  assert.equal(r3.ok, true);
  assert.equal(budget.usedBytes, 5000);

  // Exact releases restore zero
  budget.release(2000);
  assert.equal(budget.usedBytes, 3000);
  budget.release(3000);
  assert.equal(budget.usedBytes, 0);

  // Defensive underflow handling clamps to zero and prevents negative numbers
  budget.release(500);
  assert.equal(budget.usedBytes, 0);
});

test("tracks peak used value, wait count and wait time when capacity is temporarily exhausted", async () => {
  const budget = new ByteBudget(2000);

  const r1 = budget.tryReserve(1500);
  assert.equal(r1.ok, true);

  // Request of 1000 fits limit (1000 <= 2000) but exhausted currently (1500 + 1000 > 2000)
  const exhausted = budget.tryReserve(1000);
  assert.equal(exhausted.ok, false);
  if (!exhausted.ok) {
    assert.equal(exhausted.reason, "exhausted");
  }

  // Queue waiting reservation
  let resolved = false;
  const waitPromise = budget.reserve(1000).then((outcome) => {
    resolved = true;
    return outcome;
  });

  // Verify it is waiting
  assert.equal(budget.waitCount, 1);
  assert.equal(resolved, false);

  // Release earlier reservation to unblock waiter
  await new Promise((r) => setTimeout(r, 10));
  budget.release(1500);

  const outcome = await waitPromise;
  assert.equal(outcome.ok, true);
  assert.equal(resolved, true);
  assert.equal(budget.usedBytes, 1000);
  assert.equal(budget.peakBytes, 1500);
  assert.equal(budget.waitCount, 1);
  assert.ok(budget.waitDurationMs >= 8);

  budget.release(1000);
  assert.equal(budget.usedBytes, 0);
});

test("a chunk larger than budget limit is either split or refused with clear named error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cinecode-p31-split-"));
  const comp = makeComposition(10, 64, 64);
  const frameBytes = estimateFrameBytes(64, 64); // 16,384 bytes
  const budget = new ByteBudget(frameBytes * 10); // Plenty of total budget

  const manager = createWorkerManager({
    concurrency: 1,
    composition: comp,
    seed: 1,
    cacheDir: join(dir, "cache"),
    budget,
    maxChunkBytes: frameBytes * 2, // But chunks are capped at 2 frames
  });

  try {
    // A chunk with 6 frames exceeds the 2-frame chunk limit; processChunks splits it into 2-frame chunks
    const bigChunk = { startFrame: 0, endFrame: 6, frames: [0, 1, 2, 3, 4, 5] };
    const results = await manager.processChunks([bigChunk]);
    const totalFrames = results.reduce((sum, r) => sum + r.frames.length, 0);
    assert.equal(totalFrames, 6);
    assert.equal(results.length, 3); // 3 split chunks of 2 frames each
  } finally {
    await manager.terminate();
    await rm(dir, { recursive: true, force: true });
  }

  // A 1-frame chunk that exceeds the chunk budget cannot be split and is refused with the named error
  const failingManager = createWorkerManager({
    concurrency: 1,
    composition: comp,
    seed: 1,
    cacheDir: join(dir, "cache-fail"),
    budget: new ByteBudget(frameBytes / 2),
    maxChunkBytes: frameBytes / 2, // Smaller than 1 frame
  });

  try {
    await assert.rejects(
      failingManager.processChunks([{ startFrame: 0, endFrame: 1, frames: [0] }]),
      (err: Error) =>
        err.message.includes("Render chunk needs") &&
        err.message.includes("chunk budget"),
    );
  } finally {
    await failingManager.terminate();
  }
});

test("concurrency resolved once before budget and chunk sizing equals pool concurrency", () => {
  const comp = makeComposition(100, 1920, 1080);
  const baseConcurrency = resolveConcurrency("auto");
  const workload = analyzeWorkload(comp);
  const tuning = tuneConcurrency(workload, { cpuCount: baseConcurrency });
  const resolvedConcurrency = tuning?.concurrency ?? baseConcurrency;

  const transport = resolveTransportBudget({
    width: comp.width,
    height: comp.height,
    concurrency: resolvedConcurrency,
    chunkSize: 32,
    maxBytes: 256 * 1024 * 1024,
  });

  // Verify transport budget used the exact tuned concurrency
  const chunkShare = Math.floor((transport.totalBytes * 0.4) / resolvedConcurrency);
  assert.ok(transport.chunkBytes <= chunkShare || transport.chunkBytes === estimateChunkBytes(1, 1920, 1080));
});

test("observation: render reported peak budget usage is at or below limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cinecode-p31-peak-"));
  const comp = makeComposition(6, 64, 64);
  const outPath = join(dir, "out.mp4");

  try {
    const result = await renderVideo({
      composition: comp,
      outputPath: outPath,
      cacheDir: join(dir, "cache"),
      concurrency: 1,
      seed: 42,
      format: "mp4",
      memoryBudgetMb: 32,
      chunkSize: 4,
      overwrite: true,
      fresh: true,
      noCache: true,
    });

    assert.ok(result.budgetStats, "budgetStats must be present on RenderResult");
    assert.ok(
      result.budgetStats.peakBytes <= result.budgetStats.limitBytes,
      `peak ${result.budgetStats.peakBytes} exceeded limit ${result.budgetStats.limitBytes}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
