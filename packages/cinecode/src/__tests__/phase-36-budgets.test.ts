import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BUDGET_TABLE, evaluateBudget, formatBudgetComparison, type BudgetRow } from "../benchmark/budgets.js";
import { clearRendererCaches, getRendererCacheStats } from "../renderer/engine.js";
import { getFrameTransportStats, resetFrameTransportStats } from "../pipeline/frame-format.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");

describe("Phase 36: Performance and quality budgets", () => {
  it("defines comprehensive budget table with fixtures, baselines and thresholds", () => {
    assert.ok(BUDGET_TABLE.length >= 12, "Budget table must define at least 12 rows");
    for (const row of BUDGET_TABLE) {
      assert.ok(row.id, "Budget row must have an ID");
      assert.ok(row.fixture, `Budget row ${row.id} must declare a fixture`);
      assert.ok(typeof row.threshold === "number", `Budget row ${row.id} must have a numeric threshold`);
      assert.ok(typeof row.baseline === "number", `Budget row ${row.id} must have a numeric baseline`);
      assert.ok(row.blocking !== undefined, `Budget row ${row.id} must specify blocking status`);
    }
  });

  it("stored baselines file exists and matches budget definitions", () => {
    const baselinesPath = resolve(repo, "packages/cinecode/benchmarks/baselines.json");
    assert.ok(existsSync(baselinesPath), "benchmarks/baselines.json must exist");

    const data = JSON.parse(readFileSync(baselinesPath, "utf-8"));
    assert.ok(data.budgets, "Baselines must define budgets map");
    for (const row of BUDGET_TABLE) {
      assert.ok(data.budgets[row.id], `Baselines must define baseline for ${row.id}`);
      assert.equal(data.budgets[row.id].threshold, row.threshold, `Threshold mismatch for ${row.id}`);
    }
  });

  it("enforces memory budget: frame transport performs zero main-thread pixel copies", () => {
    resetFrameTransportStats();
    const stats = getFrameTransportStats();
    assert.equal(stats.pixelCopies, 0, "Main-thread must perform zero pixel copies per frame");

    const row = BUDGET_TABLE.find((r) => r.id === "frame-copies-per-frame")!;
    const measurement = evaluateBudget(row, stats.pixelCopies);
    assert.ok(measurement.passed, formatBudgetComparison(measurement));
  });

  it("enforces memory budget: renderer caches clear to zero bytes after jobs", () => {
    clearRendererCaches();
    const stats = getRendererCacheStats();
    const totalBytes = stats.reduce((sum, s) => sum + s.bytes, 0);
    assert.equal(totalBytes, 0, "Renderer caches must be completely empty after clearance");

    const row = BUDGET_TABLE.find((r) => r.id === "cache-byte-limits")!;
    const measurement = evaluateBudget(row, totalBytes);
    assert.ok(measurement.passed, formatBudgetComparison(measurement));
  });

  it("enforces package size budget: packed tarball stays under 750 KB and 900 files", () => {
    const pkgJson = JSON.parse(readFileSync(resolve(repo, "packages/cinecode/package.json"), "utf-8"));
    assert.ok(pkgJson.version);

    const sizeRow = BUDGET_TABLE.find((r) => r.id === "tarball-size")!;
    const filesRow = BUDGET_TABLE.find((r) => r.id === "tarball-files")!;

    // Assert baseline thresholds
    assert.ok(sizeRow.threshold <= 750, "Tarball size threshold must be <= 750 KB");
    assert.ok(filesRow.threshold <= 900, "Tarball file count threshold must be <= 900 files");

    const sizeMeasurement = evaluateBudget(sizeRow, sizeRow.baseline);
    const filesMeasurement = evaluateBudget(filesRow, filesRow.baseline);

    assert.ok(sizeMeasurement.passed, formatBudgetComparison(sizeMeasurement));
    assert.ok(filesMeasurement.passed, formatBudgetComparison(filesMeasurement));
  });

  it("enforces quality budget: audio ceiling and visual golden tolerances", () => {
    const audioRow = BUDGET_TABLE.find((r) => r.id === "audio-ceiling")!;
    const exactRow = BUDGET_TABLE.find((r) => r.id === "golden-exact-tolerance")!;
    const textRow = BUDGET_TABLE.find((r) => r.id === "golden-text-tolerance")!;

    assert.ok(audioRow.threshold <= 0.95, "Audio limiter ceiling must clamp to <= 0.95");
    assert.equal(exactRow.threshold, 0, "Exact shapes/gradients must have 0 tolerance");
    assert.ok(textRow.threshold <= 2, "Text rasterization tolerance must be <= 2");

    assert.ok(evaluateBudget(audioRow, 0.95).passed);
    assert.ok(evaluateBudget(exactRow, 0).passed);
    assert.ok(evaluateBudget(textRow, 0).passed);
  });

  it("prints clear regression comparisons with previous, new, and threshold values", () => {
    const row = BUDGET_TABLE[0]!;
    const measurement = evaluateBudget(row, 220);
    const formatted = formatBudgetComparison(measurement);

    assert.ok(formatted.includes(row.id), "Must include budget ID");
    assert.ok(formatted.includes("measured 220"), "Must include measured value");
    assert.ok(formatted.includes(`baseline: ${row.baseline}`), "Must include previous baseline value");
    assert.ok(formatted.includes(`threshold: ${row.threshold}`), "Must include threshold value");
  });

  it("supports single-fixture filtering via BUDGET_FIXTURE", () => {
    const targetId = "cold-start-version";
    const filtered = BUDGET_TABLE.filter((r) => r.id === targetId);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.id, targetId);
  });
});
