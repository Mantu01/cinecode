import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createResourcePlan,
  GlobalCacheService,
  buildContractCacheKey,
  resolveTransportBudget,
  ByteBudget,
  CINECODE_VERSION,
} from "../packages/cinecode/dist/esm/index.js";
import { ErrorCode } from "../packages/cinecode/dist/esm/errors/index.js";

console.log("[Phase 27 Acceptance Check]");

// Check 1: One resource plan drives workers, chunk size, queue and cache partitions
{
  const plan = createResourcePlan({
    width: 1920,
    height: 1080,
    concurrency: 4,
    chunkSize: 10,
    memoryBudgetMb: 512,
  });

  assert.equal(plan.totalBudget, 512 * 1024 * 1024, "Total budget must match configured megabytes");
  assert.equal(plan.source, "config", "Source must be config when explicit");
  assert.equal(plan.rawFrameBytes, 1920 * 1080 * 4, "Raw frame bytes must be RGBA 4bpp");
  assert.equal(plan.frameBytes, Math.ceil(1920 * 1080 * 4 * 1.25), "Frame bytes must include 25% encoder overhead");
  assert.ok(plan.workerCount >= 1 && plan.workerCount <= 4, "Worker count must be valid");
  assert.ok(plan.chunkSize >= 1, "Chunk size must be positive");
  assert.ok(plan.queueDepth >= 2, "Queue depth must be at least 2");
  assert.ok(plan.previewShare > 0, "Preview share must be positive");
  assert.ok(plan.partitions.frames > 0, "Frames partition must be positive");
  assert.ok(plan.partitions.images > 0, "Images partition must be positive");
  assert.ok(plan.partitions.text > 0, "Text partition must be positive");
  assert.ok(plan.partitions.media > 0, "Media partition must be positive");

  // Sum of partitions plus pipeline reservations must stay within totalBudget
  const totalPartitionBytes =
    plan.partitions.frames + plan.partitions.images + plan.partitions.text + plan.partitions.media;
  assert.ok(totalPartitionBytes < plan.totalBudget, "Cache partitions must fit within total budget");
  console.log("✓ Check 1: Unified resource plan drives workers, chunk size, queue and cache partitions");
}

// Check 2: Single frame refusal before allocation
{
  let caught = null;
  try {
    // 8K frame requires ~165 MB with overhead, budget set to 10 MB
    createResourcePlan({
      width: 7680,
      height: 4320,
      memoryBudgetMb: 10,
    });
  } catch (err) {
    caught = err;
  }

  assert.ok(caught !== null, "Must refuse to start when single frame exceeds budget");
  assert.equal(caught.code, ErrorCode.CC7005, `Error code must be CC7005, got ${caught?.code}`);
  assert.ok(caught.message.includes("exceeds total memory budget"), "Message must explain refusal");
  assert.ok(caught.fixHint && caught.fixHint.includes("--memory-budget"), "Fix hint must suggest resolution");
  console.log("✓ Check 2: Single frame exceeding budget refused with CC7005 and resolution hint");
}

// Check 3: Sizing worker pool by memory first
{
  // Small memory budget on a high-core simulated machine
  const plan = createResourcePlan({
    width: 3840,
    height: 2160,
    concurrency: 32,
    memoryBudgetMb: 128, // 128 MB budget, frame is ~41 MB
    cpuCount: 32,
  });

  // 128 MB * 0.5 = 64 MB for workers; 41 MB * 2 = 82 MB per worker => exactly 1 worker
  assert.equal(plan.workerCount, 1, "Worker count must be throttled by memory, not oversubscribed by CPU count");
  console.log("✓ Check 3: Worker pool sized by memory first before CPU count");
}

// Check 4: ByteBudget and transport integration
{
  const transport = resolveTransportBudget({
    width: 1280,
    height: 720,
    concurrency: 2,
    chunkSize: 5,
    maxBytes: 256 * 1024 * 1024,
  });

  assert.ok(transport.plan, "Transport budget must include resource plan");
  assert.equal(transport.totalBytes, 256 * 1024 * 1024, "Total bytes must match budget");
  const byteBudget = new ByteBudget(transport.totalBytes);
  const reserve1 = byteBudget.tryReserve(50 * 1024 * 1024);
  assert.ok(reserve1.ok, "Valid reservation should succeed");
  assert.equal(byteBudget.usedBytes, 50 * 1024 * 1024, "Used bytes must track reservation");
  byteBudget.release(50 * 1024 * 1024);
  assert.equal(byteBudget.usedBytes, 0, "Release must restore budget");
  console.log("✓ Check 4: ByteBudget and transport integration enforce strict budget");
}

// Check 5: Global byte-bounded cache with cross-partition LRU eviction
{
  const globalCache = new GlobalCacheService(1000); // 1000 bytes budget

  // Put 400 bytes into 'frames' partition
  globalCache.set("frames", "f1", { data: "frame1" }, 400);
  assert.equal(globalCache.totalBytes, 400);

  // Put 400 bytes into 'images' partition
  globalCache.set("images", "i1", { data: "image1" }, 400);
  assert.equal(globalCache.totalBytes, 800);

  // Put 300 bytes into 'text' partition: 800 + 300 = 1100 > 1000 maxBytes
  // Must evict the globally oldest entry ('frames::f1')!
  let evicted = null;
  globalCache.set("text", "t1", { data: "text1" }, 300, {
    onEvict: (k) => {
      evicted = k;
    },
  });

  assert.ok(globalCache.totalBytes <= 1000, `Total bytes (${globalCache.totalBytes}) must not exceed maxBytes (1000)`);
  assert.equal(globalCache.has("frames", "f1"), false, "Oldest entry in frames partition must have been evicted");
  assert.equal(globalCache.has("images", "i1"), true, "Newer entry in images partition must survive");
  assert.equal(globalCache.has("text", "t1"), true, "Newly inserted text entry must exist");
  console.log("✓ Check 5: Global cache cross-partition LRU eviction prevents partition starvation");
}

// Check 6: Cache key contract and incompatible format refusal
{
  const contract1 = {
    compositionHash: "comp123",
    frameIndex: 42,
    geometry: "1920x1080",
    seed: 1337,
    rendererVersion: "1.0.0",
    effectList: ["blur", "colorGrade"],
  };

  const key1 = buildContractCacheKey(contract1);
  const key1Again = buildContractCacheKey({
    ...contract1,
    effectList: ["colorGrade", "blur"], // Order invariance
  });
  assert.equal(key1, key1Again, "Cache key must be deterministic and invariant to effect list order");

  // Invalidate on geometry change
  const keyGeom = buildContractCacheKey({ ...contract1, geometry: "1280x720" });
  assert.notEqual(key1, keyGeom, "Cache key must invalidate on geometry change");

  // Invalidate on seed change
  const keySeed = buildContractCacheKey({ ...contract1, seed: 9999 });
  assert.notEqual(key1, keySeed, "Cache key must invalidate on seed change");

  // Invalidate on renderer version change
  const keyVer = buildContractCacheKey({ ...contract1, rendererVersion: "2.0.0" });
  assert.notEqual(key1, keyVer, "Cache key must invalidate on renderer version change");

  // Format compatibility: Incompatible cache format entry refusal with note
  const cache = new GlobalCacheService(10000);
  cache.set("frames", key1, { payload: "stale" }, 50, { formatVersion: 1 }); // stored formatVersion 1, expected 2

  const readResult = cache.get("frames", key1, 2);
  assert.equal(readResult.hit, false, "Incompatible cache format entry must not be a hit");
  assert.ok(readResult.note && readResult.note.includes("Incompatible cache format version 1"), "Refusal note must be returned");
  console.log("✓ Check 6: Cache key contract invalidation and format incompatibility refusal verified");
}

// Check 7: Command startup efficiency — no heavy barrel imports
{
  const programFile = readFileSync(join(process.cwd(), "packages/cinecode/dist/esm/cli/program.js"), "utf8");
  const registryFile = readFileSync(join(process.cwd(), "packages/cinecode/dist/esm/cli/command-registry.js"), "utf8");

  // Check that command path doesn't import root barrel or heavy subsystems eagerly
  assert.ok(!programFile.includes('from "../index.js"'), "CLI program must not import root barrel");
  assert.ok(!registryFile.includes('from "../index.js"'), "Command registry must not import root barrel");
  assert.ok(!registryFile.includes('from "../renderer/engine.js"'), "Command registry must not eagerly import renderer");
  assert.ok(!registryFile.includes('from "../audio/index.js"'), "Command registry must not eagerly import audio");
  assert.ok(!registryFile.includes('from "../model-3d/index.js"'), "Command registry must not eagerly import 3D");
  console.log("✓ Check 7: CLI command path does not eagerly import heavy subsystems or root barrel");
}

// Check 8: Version resolution is build-time constant with no directory walking
{
  const versionFile = readFileSync(join(process.cwd(), "packages/cinecode/dist/esm/version.js"), "utf8");
  assert.ok(!versionFile.includes("readFileSync"), "version.js must not call readFileSync");
  assert.ok(!versionFile.includes("fileURLToPath"), "version.js must not walk directory via fileURLToPath");
  assert.ok(CINECODE_VERSION && typeof CINECODE_VERSION === "string", "CINECODE_VERSION must be valid non-empty string");
  console.log("✓ Check 8: Version resolution is build-time constant without directory walking");
}

console.log("\nAll Phase 27 acceptance checks passed successfully.");
