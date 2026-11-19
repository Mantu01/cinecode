import assert from "node:assert/strict";
import { test } from "node:test";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Composition } from "../../core/types/index.js";
import { createRenderJob, createChunks, createWorkerManager } from "../index.js";

function composition(frames: number, width = 1920, height = 1080): Composition {
  return {
    name: "cancel",
    width,
    height,
    fps: 30,
    duration: frames / 30,
    background: "#101820",
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
              width,
              height,
              start: 0,
              duration: frames / 30,
            },
          ],
        },
      ],
    },
  };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

test("cancel mid-render is prompt, idempotent and leaves no artifact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cinecode-cancel-"));
  try {
    const outputPath = join(dir, "out.mp4");
    const job = createRenderJob({
      composition: composition(300),
      outputPath,
      cacheDir: join(dir, "cache"),
      seed: 1,
      concurrency: 4,
      chunkSize: 8,
      quality: "preview",
      format: "mp4",
      overwrite: true,
      fresh: true,
      noCache: true,
      silent: true,
    });
    await new Promise<void>((resolve) => {
      const done = (): void => {
        job.off("progress", done);
        resolve();
      };
      job.on("progress", done);
    });

    const started = Date.now();
    await job.cancel();
    assert.ok(Date.now() - started < 5000, "cancel took too long");
    await job.cancel();
    await assert.rejects(job.promise, (error: { code?: string }) => error.code === "CC4003");
    assert.equal(await exists(outputPath), false, "cancelled render left a final artifact");

    const leftovers = (await readdir(dir)).filter((name) => name.endsWith(".tmp") || name.endsWith(".rgba"));
    assert.deepEqual(leftovers, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a terminated worker pool settles in-flight chunks as cancelled", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cinecode-pool-"));
  const manager = createWorkerManager({
    concurrency: 2,
    composition: composition(16, 1920, 1080),
    seed: 1,
    cacheDir: join(dir, "cache"),
  });
  try {
    const pending = manager.processChunks(createChunks(16, 8));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await manager.terminate();
    await assert.rejects(pending, (error: { code?: string }) => error.code === "CC4003");
  } finally {
    await manager.terminate();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a reused warm worker matches a fresh worker frame for frame", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cinecode-warm-"));
  const compA = composition(2, 64, 64);
  const compB: Composition = {
    ...composition(2, 64, 64),
    name: "compB",
    rootTimeline: {
      tracks: [
        {
          name: "visual",
          kind: "visual",
          clips: [{ type: "solid", color: "#ff0000", width: 64, height: 64, start: 0, duration: 2 / 30 }],
        },
      ],
    },
  };

  const freshManager = createWorkerManager({
    concurrency: 1,
    composition: compA,
    seed: 42,
    cacheDir: join(dir, "cache-fresh"),
  });
  const warmManager = createWorkerManager({
    concurrency: 1,
    composition: compB,
    seed: 42,
    cacheDir: join(dir, "cache-warm"),
  });

  try {
    const freshResults = await freshManager.processChunks(createChunks(2, 2));
    await warmManager.processChunks(createChunks(2, 2));

    await warmManager.reinit({
      concurrency: 1,
      composition: compA,
      seed: 42,
      cacheDir: join(dir, "cache-warm"),
    });
    const reusedResults = await warmManager.processChunks(createChunks(2, 2));

    assert.equal(freshResults.length, reusedResults.length);
    assert.equal(freshResults[0]?.frames.length, reusedResults[0]?.frames.length);
    for (let i = 0; i < freshResults[0]!.frames.length; i++) {
      const freshBuf = freshResults[0]!.frames[i]!.buffer;
      const reusedBuf = reusedResults[0]!.frames[i]!.buffer;
      assert.equal(Buffer.compare(freshBuf, reusedBuf), 0, `frame ${i} differed between fresh and reused warm worker`);
    }
  } finally {
    await freshManager.terminate();
    await warmManager.terminate();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a worker that crashes mid-chunk produces a coded error and a clean teardown", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cinecode-crash-"));
  const comp = composition(4, 64, 64);
  const manager = createWorkerManager({
    concurrency: 1,
    composition: comp,
    seed: 1,
    cacheDir: join(dir, "cache"),
    crashOnFrame: 1,
  });
  try {
    await assert.rejects(
      manager.processChunks(createChunks(4, 4)),
      (error: { code?: string }) => error.code === "CC4001",
    );
  } finally {
    await manager.terminate();
    assert.equal(manager.isTerminated(), true);
    await rm(dir, { recursive: true, force: true });
  }
});
