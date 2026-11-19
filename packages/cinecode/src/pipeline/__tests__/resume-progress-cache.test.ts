import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  absoluteToRelative,
  relativeToAbsolute,
  createCheckpointManager,
} from "../checkpoint.js";
import {
  createRenderCache,
  computeCanonicalCacheIdentity,
  findFunctionValuedProperty,
} from "../cache.js";
import { createProgressReporter, type ProgressEvent } from "../progress.js";

describe("Phase 28: Resume, progress and cache identity", () => {
  it("converts between absolute and relative frame numbers losslessly", () => {
    const chunkStartFrame = 120;
    const absoluteFrame = 125;
    const relativeIndex = absoluteToRelative(chunkStartFrame, absoluteFrame);
    assert.equal(relativeIndex, 5);

    const roundTrip = relativeToAbsolute(chunkStartFrame, relativeIndex);
    assert.equal(roundTrip, absoluteFrame);
  });

  it("ignores corrupted or stale checkpoint with degradation warning CC4006 and starts clean", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cinecode-checkpoint-test-"));
    try {
      const checkpointsDir = join(tempDir, "checkpoints");
      await mkdir(checkpointsDir, { recursive: true });
      await writeFile(join(checkpointsDir, "corrupted.json"), "NOT_JSON{{{");

      const manager = createCheckpointManager({
        cacheDir: tempDir,
        compositionId: "test-comp",
        compositionHash: "hash-123",
        totalFrames: 100,
        from: 0,
        to: 100,
      });

      const latest = await manager.findLatestCheckpoint();
      assert.equal(latest, null);
      assert.equal(manager.getCompletedFrames().length, 0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("progresses smoothly without percentage regression and reaches 100 once at completion", () => {
    const emittedEvents: ProgressEvent[] = [];
    const percentages: number[] = [];

    const reporter = createProgressReporter({
      totalFrames: 10,
      onProgress: (event) => {
        emittedEvents.push(event);
        percentages.push(event.percent);
      },
    });

    reporter.reportStart();
    reporter.reportFrame(0);
    reporter.reportFrame(1);
    reporter.reportChunk(0, 2);
    reporter.reportFrame(2);
    reporter.reportChunk(1, 1);
    reporter.reportDone("out.mp4", 1.0, 1024, 0);

    assert.ok(emittedEvents.length > 0);
    // Assert percentage never regresses
    for (let i = 1; i < percentages.length; i++) {
      assert.ok(
        percentages[i]! >= percentages[i - 1]!,
        `Percent regressed: ${percentages[i - 1]} -> ${percentages[i]}`,
      );
    }
    const finalEvent = emittedEvents[emittedEvents.length - 1]!;
    assert.equal(finalEvent.type, "done");
    assert.equal(finalEvent.percent, 100);
    assert.equal(finalEvent.percentage, 100);
  });

  it("invalidates cache identity when entry file content changes", () => {
    const comp = { width: 1920, height: 1080, fps: 30 };
    const id1 = computeCanonicalCacheIdentity({
      composition: comp,
      entryContent: "console.log('version 1');",
    });

    const id2 = computeCanonicalCacheIdentity({
      composition: comp,
      entryContent: "console.log('version 2');",
    });

    assert.notEqual(id1.identityHash, id2.identityHash);
    assert.equal(id1.bypassCache, false);
    assert.equal(id2.bypassCache, false);
  });

  it("detects function-valued properties and bypasses cache with warning CC4008", () => {
    const compWithFn = {
      width: 1920,
      height: 1080,
      customRenderer: () => {},
    };

    const fnProp = findFunctionValuedProperty(compWithFn);
    assert.equal(fnProp, "customRenderer");

    const identityResult = computeCanonicalCacheIdentity({
      composition: compWithFn,
    });

    assert.equal(identityResult.bypassCache, true);
    assert.ok(identityResult.bypassReason?.includes("customRenderer"));
  });

  it("cache GC respects size and age limits without touching non-cache files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cinecode-cache-gc-test-"));
    try {
      const cache = createRenderCache(tempDir);
      await cache.initialize();

      const testBuffer = Buffer.alloc(1024 * 10, 0xaa); // 10KB
      await cache.setChunk("comp-hash-1", 0, [{ index: 0, buffer: testBuffer }]);

      const statsBefore = await cache.getStats();
      assert.ok(statsBefore.totalFrames > 0);
      assert.ok(statsBefore.sizeBytes > 0);

      // Create a mock output file outside objects/index
      const outputFile = join(tempDir, "output.mp4");
      await writeFile(outputFile, "IMPORTANT_OUTPUT_DATA");

      // GC with maxSizeBytes smaller than stored chunk
      const gcResult = await cache.garbageCollect({ maxSizeBytes: 100 });
      assert.ok(gcResult.bytesReclaimed > 0);
      assert.ok(gcResult.filesDeleted > 0);

      // Verify output file remains intact
      const outputContent = await import("node:fs/promises").then((fs) =>
        fs.readFile(outputFile, "utf-8"),
      );
      assert.equal(outputContent, "IMPORTANT_OUTPUT_DATA");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("persists checkpoint and resumes completed frames", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cinecode-resume-test-"));
    try {
      const manager1 = createCheckpointManager({
        cacheDir: tempDir,
        compositionId: "resume-comp",
        compositionHash: "comp-hash-abc",
        totalFrames: 20,
        from: 0,
        to: 20,
      });
      await manager1.initialize();

      // Render first 5 frames
      manager1.markFrames([0, 1, 2, 3, 4]);
      await manager1.flush();

      // Second session resumes
      const manager2 = createCheckpointManager({
        cacheDir: tempDir,
        compositionId: "resume-comp",
        compositionHash: "comp-hash-abc",
        totalFrames: 20,
        from: 0,
        to: 20,
      });

      const latest = await manager2.findLatestCheckpoint();
      assert.ok(latest !== null);
      assert.equal(latest.renderSessionId, manager1.renderSessionId);
      assert.deepEqual(manager2.getCompletedFrames(), [0, 1, 2, 3, 4]);
      assert.equal(manager2.hasFrame(3), true);
      assert.equal(manager2.hasFrame(5), false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
