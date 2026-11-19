import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import ffmpegStatic from "@ffmpeg-installer/ffmpeg";
import { createMediaCache } from "../cache.js";
import {
  createSharedDecodeService,
  type SharedDecodeService,
} from "../decode-service.js";
import type { Composition } from "../../core/types/index.js";

function createTestVideo(outputPath: string, durationSec: number = 2, fps: number = 30): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegStatic.path,
      [
        "-y",
        "-f", "lavfi",
        "-i", `testsrc=duration=${durationSec}:size=64x64:rate=${fps}`,
        "-pix_fmt", "yuv420p",
        outputPath,
      ],
      { windowsHide: true },
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed with code ${code}`));
    });
    child.on("error", reject);
  });
}

describe("SharedDecodeService (Phase 27)", () => {
  const testDir = join(tmpdir(), `cinecode-decode-test-${Date.now()}`);
  const videoPath = join(testDir, "test_source.mp4");
  const corruptPath = join(testDir, "corrupt.mp4");
  let mediaCache: ReturnType<typeof createMediaCache>;

  before(async () => {
    mkdirSync(testDir, { recursive: true });
    await createTestVideo(videoPath, 2, 30); // 60 frames total, 64x64
    writeFileSync(corruptPath, Buffer.from("NOT_A_VALID_VIDEO_FILE_DATA_CORRUPT"));
    mediaCache = createMediaCache(join(testDir, "cache"));
    await mediaCache.initialize();
  });

  after(() => {
    if (existsSync(testDir)) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("decodes each range once and shares results across concurrent requests", async () => {
    let decodePasses = 0;
    const tempDir = join(testDir, "tmp-share");
    const service = createSharedDecodeService({
      mediaCache,
      tempDir,
      memoryBudgetBytes: 10 * 1024 * 1024,
      diskBudgetBytes: 50 * 1024 * 1024,
      prefetchAhead: 8,
      onDecode: () => {
        decodePasses++;
      },
    });

    try {
      // Simulate two workers requesting overlapping frame sets concurrently
      const [worker1Frames, worker2Frames] = await Promise.all([
        service.requestFrames(videoPath, [0, 1, 2, 3, 4, 5, 6, 7]),
        service.requestFrames(videoPath, [4, 5, 6, 7, 8, 9, 10]),
      ]);

      assert.strictEqual(worker1Frames.size, 8);
      assert.strictEqual(worker2Frames.size, 7);

      // Verify pixel content matches between workers for shared frame 5
      const frame5FromWorker1 = worker1Frames.get(5)!;
      const frame5FromWorker2 = worker2Frames.get(5)!;
      assert.strictEqual(Buffer.compare(frame5FromWorker1.buffer, frame5FromWorker2.buffer), 0);

      const stats = service.getStats();
      assert.strictEqual(stats.decodeCount, 1, `Expected exactly 1 decode pass, got ${stats.decodeCount}`);
      assert.strictEqual(decodePasses, 1);
    } finally {
      await service.dispose();
    }
  });

  it("preserves bit-for-bit determinism between memory and disk spill paths", async () => {
    const frameBytes = 64 * 64 * 4; // 16,384 bytes
    const tempDir = join(testDir, "tmp-spill");

    // Memory budget holds only 1 frame; second frame forces spill of first to disk
    const service = createSharedDecodeService({
      mediaCache,
      tempDir,
      memoryBudgetBytes: frameBytes + 1024,
      diskBudgetBytes: 50 * 1024 * 1024,
      prefetchAhead: 0,
    });

    try {
      // Decode frame 0 into memory
      const frame0Memory = await service.requestFrame(videoPath, 0);
      assert.strictEqual(frame0Memory.buffer.length, frameBytes);

      // Decode frame 1, which causes frame 0 to spill to disk
      await service.requestFrame(videoPath, 1);

      const statsAfterSpill = service.getStats();
      assert.ok(statsAfterSpill.spillCount >= 1, "Expected at least 1 spill to disk");

      // Retrieve frame 0 again - this time served from disk spill
      const frame0Disk = await service.requestFrame(videoPath, 0);
      assert.strictEqual(frame0Disk.buffer.length, frameBytes);

      // Assert bit-for-bit identical raw pixels
      assert.strictEqual(
        Buffer.compare(frame0Memory.buffer, frame0Disk.buffer),
        0,
        "Memory frame and disk frame must be bit-for-bit identical",
      );

      const statsFinal = service.getStats();
      assert.ok(statsFinal.diskHits >= 1, "Expected at least 1 disk hit");
    } finally {
      await service.dispose();
    }
  });

  it("enforces disk budget with LRU eviction", async () => {
    const frameBytes = 64 * 64 * 4;
    const tempDir = join(testDir, "tmp-lru");

    // Memory holds 1 frame, disk holds 2 frames
    const service = createSharedDecodeService({
      mediaCache,
      tempDir,
      memoryBudgetBytes: frameBytes + 512,
      diskBudgetBytes: frameBytes * 2 + 512,
      prefetchAhead: 0,
    });

    try {
      // Request frame 0, 1, 2, 3 sequentially
      await service.requestFrame(videoPath, 0);
      await service.requestFrame(videoPath, 1);
      await service.requestFrame(videoPath, 2);
      await service.requestFrame(videoPath, 3);

      const stats = service.getStats();
      assert.ok(stats.spillCount >= 2, "Expected multiple spills to disk");
      assert.ok(stats.evictionCount >= 1, "Expected older spilled files to be evicted from disk");
    } finally {
      await service.dispose();
    }
  });

  it("reports explicit failure with affected clips on corrupted media", async () => {
    const tempDir = join(testDir, "tmp-corrupt");
    const mockComposition = {
      width: 64,
      height: 64,
      fps: 30,
      duration: 2,
      rootTimeline: {
        tracks: [
          {
            id: "video-track-1",
            name: "video-track-1",
            kind: "visual",
            clips: [
              {
                id: "clip-broken-1",
                type: "video",
                src: corruptPath,
                start: 0,
                duration: 2,
              } as any,
            ],
          } as any,
        ],
      },
    } as unknown as Composition;

    const service = createSharedDecodeService({
      mediaCache,
      composition: mockComposition,
      tempDir,
    });

    try {
      await assert.rejects(
        async () => {
          await service.requestFrame(corruptPath, 0);
        },
        (error: unknown) => {
          assert.ok(error instanceof Error);
          const err = error as any;
          assert.strictEqual(err.code, "CC4001");
          assert.ok(
            err.message.includes("video-track-1") || err.message.includes("clip-broken-1") || err.details?.includes("corrupt"),
            `Expected error details to include source or affected clip, got: ${err.message}`,
          );
          return true;
        },
      );
    } finally {
      await service.dispose();
    }
  });

  it("cleans up disk temporary directory on dispose", async () => {
    const tempDir = join(testDir, "tmp-cleanup");
    const service = createSharedDecodeService({
      mediaCache,
      tempDir,
      memoryBudgetBytes: 1024, // forces immediate spill
    });

    await service.requestFrame(videoPath, 0);
    assert.ok(existsSync(tempDir), "Temp dir should exist during operation");

    await service.dispose();
    assert.strictEqual(existsSync(tempDir), false, "Temp dir should be completely deleted after dispose");
  });

  it("aborts in-flight decoders cleanly on cancel", async () => {
    const tempDir = join(testDir, "tmp-cancel");
    const service = createSharedDecodeService({
      mediaCache,
      tempDir,
    });

    const pending = service.requestRange(videoPath, 0, 30);
    await service.cancel();

    await assert.rejects(
      pending,
      (err: unknown) => {
        const error = err as any;
        assert.ok(error?.code === "CC4003" || error?.message?.includes("cancel"));
        return true;
      },
    );

    await service.dispose();
  });
});
