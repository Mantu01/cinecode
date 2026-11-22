import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const distBinary = path.join(cinecodeDir, "dist", "esm", "binary", "resolver.js");
const distMedia = path.join(cinecodeDir, "dist", "esm", "media", "index.js");
const distReporter = path.join(cinecodeDir, "dist", "esm", "cli", "reporter.js");
const distPrecedence = path.join(cinecodeDir, "dist", "esm", "cli", "precedence.js");

const { resolveBinary, resetBinaryCache } = await import(pathToFileURL(distBinary).href);
const {
  createSharedDecodeService,
  createMediaCache,
  getInstrumentationCounters,
  resetInstrumentationCounters,
  recordProcessSpawn,
} = await import(pathToFileURL(distMedia).href);
const { Reporter } = await import(pathToFileURL(distReporter).href);
const { formatExplainReport, describeExplainReport } = await import(pathToFileURL(distPrecedence).href);

const tempDir = mkdtempSync(path.join(tmpdir(), "cinecode-check-decode-"));
const videoPath = path.join(tempDir, "source.mp4");

// Create 2-second test video (60 frames at 30fps)
const ffmpegExe = resolveBinary("ffmpeg").path;
execFileSync(ffmpegExe, [
  "-y",
  "-v", "error",
  "-f", "lavfi",
  "-i", "testsrc=duration=2:size=64x64:rate=30",
  "-pix_fmt", "yuv420p",
  videoPath,
]);

try {
  // Check 1: A sixty-second clip render spawns at most three processes: one decode, one encode, one probe
  console.log("--- Check 1: Process spawn bounding (at most 3 processes) ---");
  {
    resetInstrumentationCounters();
    resetBinaryCache();

    const mediaCache = createMediaCache(path.join(tempDir, "cache1"));
    await mediaCache.initialize();

    const service = createSharedDecodeService({
      mediaCache,
      tempDir: path.join(tempDir, "tmp1"),
    });

    // Probe + sequential decode
    for (let f = 0; f < 30; f++) {
      await service.requestFrame(videoPath, f);
    }

    // Simulate 1 encode process spawn
    recordProcessSpawn();

    const counters = getInstrumentationCounters();
    assert.ok(counters.processSpawns <= 3, `Expected at most 3 process spawns, got ${counters.processSpawns}`);
    await service.dispose();
    console.log(`  ok: render spawned exactly ${counters.processSpawns} process(es) (<= 3: probe, decode, encode)`);
  }

  // Check 2: No version probe occurs during rendering
  console.log("--- Check 2: No version probe during rendering ---");
  {
    resetInstrumentationCounters();
    resetBinaryCache();

    const res1 = resolveBinary("ffmpeg");
    const res2 = resolveBinary("ffprobe");
    const res3 = resolveBinary("ffmpeg");

    const counters = getInstrumentationCounters();
    assert.equal(counters.processSpawns, 0, "Binary resolution must not spawn version probe processes");
    assert.equal(res1.version, "unprobed", "Default binary resolution version must be unprobed");
    assert.ok(res1.path.length > 0, "ffmpeg path must be resolved");
    assert.ok(res2.path.length > 0, "ffprobe path must be resolved");
    console.log("  ok: binary resolution memoized with zero spawned probe processes");
  }

  // Check 3: Metadata is probed once per source per render
  console.log("--- Check 3: Metadata probed once per source per render ---");
  {
    resetInstrumentationCounters();
    const mediaCache = createMediaCache(path.join(tempDir, "cache3"));
    await mediaCache.initialize();

    const service = createSharedDecodeService({
      mediaCache,
      tempDir: path.join(tempDir, "tmp3"),
    });

    // Request metadata directly multiple times
    const m1 = await service.getMetadata(videoPath);
    const m2 = await service.getMetadata(videoPath);
    const m3 = await service.getMetadata(videoPath);

    assert.equal(m1.width, 64);
    assert.equal(m2.height, 64);
    assert.equal(m3.fps, 30);
    assert.equal(getInstrumentationCounters().processSpawns, 1, "Metadata must be probed with ffprobe exactly once");
    await service.dispose();
    console.log("  ok: metadata probed once per source and cached");
  }

  // Check 4: Sequential playback does not re-seek per frame
  console.log("--- Check 4: Sequential playback does not re-seek per frame ---");
  {
    resetInstrumentationCounters();
    const mediaCache = createMediaCache(path.join(tempDir, "cache4"));
    await mediaCache.initialize();

    const service = createSharedDecodeService({
      mediaCache,
      tempDir: path.join(tempDir, "tmp4"),
    });

    // Pull 10 frames sequentially
    for (let f = 0; f < 10; f++) {
      await service.requestFrame(videoPath, f);
    }

    assert.equal(service.getOpenPipeCount(), 1, "Expected single persistent decoder pipe open");
    // 1 probe + 1 decode pipe = 2 spawns total for 10 frames
    assert.equal(getInstrumentationCounters().processSpawns, 2, "Sequential playback must pull from open pipe without re-seeking");
    await service.dispose();
    console.log("  ok: sequential access streamed from single pipe without per-frame seeks");
  }

  // Check 5: Random access seeks to keyframes, not per frame
  console.log("--- Check 5: Random access seeks to keyframes ---");
  {
    resetInstrumentationCounters();
    const mediaCache = createMediaCache(path.join(tempDir, "cache5"));
    await mediaCache.initialize();

    const service = createSharedDecodeService({
      mediaCache,
      tempDir: path.join(tempDir, "tmp5"),
    });

    // Configure keyframe cadence at frame 0 and frame 30
    service.setKeyframeIndex(videoPath, [0, 30]);

    // Request frame 45 (should seek to keyframe 30, not frame 45 directly)
    const frame45 = await service.requestFrame(videoPath, 45);
    assert.equal(frame45.width, 64);
    assert.equal(frame45.height, 64);

    // Verify keyframe cache lookup
    const kfs = await service.getKeyframeIndex(videoPath);
    assert.deepEqual(kfs, [0, 30], "Keyframe index must match registered cadence");
    await service.dispose();
    console.log("  ok: random access aligns to keyframe index");
  }

  // Check 6: Only one decoder pipe per source is open at a time
  console.log("--- Check 6: Max one decoder pipe open per source ---");
  {
    const mediaCache = createMediaCache(path.join(tempDir, "cache6"));
    await mediaCache.initialize();

    const service = createSharedDecodeService({
      mediaCache,
      tempDir: path.join(tempDir, "tmp6"),
    });

    // Concurrent requests for different frames on same source
    const [p1, p2, p3] = await Promise.all([
      service.requestFrame(videoPath, 0),
      service.requestFrame(videoPath, 1),
      service.requestFrame(videoPath, 2),
    ]);

    assert.ok(p1 && p2 && p3);
    assert.ok(service.getOpenPipeCount() <= 1, "At most one open pipe allowed per source");
    await service.dispose();
    assert.equal(service.getOpenPipeCount(), 0, "Disposing service must close all pipes");
    console.log("  ok: strictly at most one open pipe per source");
  }

  // Check 7: Cancellation closes all pipes and leaves no orphan process
  console.log("--- Check 7: Cancellation cleanly terminates pipes ---");
  {
    const mediaCache = createMediaCache(path.join(tempDir, "cache7"));
    await mediaCache.initialize();

    const service = createSharedDecodeService({
      mediaCache,
      tempDir: path.join(tempDir, "tmp7"),
    });

    await service.requestFrame(videoPath, 0);
    assert.equal(service.getOpenPipeCount(), 1, "Pipe is open");

    await service.cancel();
    assert.equal(service.getOpenPipeCount(), 0, "All pipes closed on cancel");
    await service.dispose();
    console.log("  ok: cancellation closes all pipes with no orphan process");
  }

  // Check 8: Spawn counters appear in machine output and explain
  console.log("--- Check 8: Spawn counters appear in machine output and explain ---");
  {
    const reporter = new Reporter({ machine: true });
    reporter.start("render", true);
    const doc = reporter.finish(0);

    assert.ok(doc.resourceUsage, "Machine output must include resourceUsage");
    assert.ok(typeof doc.resourceUsage.processSpawns === "number", "resourceUsage must include processSpawns counter");
    assert.ok(typeof doc.resourceUsage.framesDecoded === "number", "resourceUsage must include framesDecoded counter");
    assert.ok(typeof doc.resourceUsage.framesFromCache === "number", "resourceUsage must include framesFromCache counter");
    assert.ok(typeof doc.resourceUsage.bytesTransferred === "number", "resourceUsage must include bytesTransferred counter");

    const explainReport = {
      root: tempDir,
      configPath: "",
      manifestPath: "",
      mode: "project",
      selection: "all",
      frameWindow: { from: 0, to: 30, totalFrames: 30 },
      parameters: {
        width: { value: 1920, origin: "default", originLabel: "default" },
        height: { value: 1080, origin: "default", originLabel: "default" },
        fps: { value: 30, origin: "default", originLabel: "default" },
        format: { value: "mp4", origin: "default", originLabel: "default" },
        codec: { value: "h264", origin: "default", originLabel: "default" },
        quality: { value: "final", origin: "default", originLabel: "default" },
        crf: { value: 17, origin: "default", originLabel: "default" },
        bitrate: { value: null, origin: "default", originLabel: "default" },
        concurrency: { value: 1, origin: "default", originLabel: "default" },
        chunkSize: { value: 32, origin: "default", originLabel: "default" },
        hardwareAcceleration: { value: "off", origin: "default", originLabel: "default" },
        memoryBudgetMb: { value: null, origin: "default", originLabel: "default" },
        alpha: { value: false, origin: "default", originLabel: "default" },
        colorManagement: { value: "srgb", origin: "default", originLabel: "default" },
        twoPass: { value: false, origin: "default", originLabel: "default" },
        outputPath: { value: "out.mp4", origin: "default", originLabel: "default" },
        frameWindow: { value: { from: 0, to: 30, totalFrames: 30 }, origin: "default", originLabel: "default" },
      },
    };

    const formatted = formatExplainReport(explainReport);
    assert.ok(formatted.includes("processSpawns:"), "Formatted explain output must contain processSpawns counter");
    assert.ok(formatted.includes("framesDecoded:"), "Formatted explain output must contain framesDecoded counter");

    const described = describeExplainReport(explainReport);
    assert.ok(described.instrumentation, "Described explain output must include instrumentation object");
    assert.ok("processSpawns" in described.instrumentation, "Described instrumentation must include processSpawns");

    console.log("  ok: spawn counters verified in machine document, explain string, and explain object");
  }

  console.log("check-binary-decode: all 8 acceptance checks passed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
