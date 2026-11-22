import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectHealth } from "../health.js";
import { buildSyncReport } from "../sync.js";
import { parseVariantLabel, PREDEFINED_VARIANTS } from "../../pipeline/multiResolution.js";
import { getBenchmarkHistoryPath } from "../benchmark.js";
import { buildStoryboardClips, storyboardToComposition, type Storyboard } from "../story.js";
import { drawPath, type PathSegment } from "../../renderer/shapes/draw.js";
import { createDefaultTransform, type DrawContext } from "../../renderer/shapes/primitives.js";
import { Canvas } from "@napi-rs/canvas";

describe("Phase 30: Auxiliary commands tell the truth", () => {
  it("health probe reports real facts offline without network", async () => {
    const report = await collectHealth();
    assert.ok(report.ffmpeg);
    assert.ok(typeof report.ffmpeg.version === "string");
    assert.ok(report.node);
    assert.ok(report.node.compatible);
    assert.ok(report.workers.available > 0);
    assert.ok(report.diskSpace);
    assert.ok(report.gpu.available);
  });

  it("sync dry-run matches plan and only deletes with explicit confirmation", async () => {
    const reportDry = await buildSyncReport({ dryRun: true, deleteOrphans: true });
    assert.ok(reportDry.actions);
    assert.deepEqual(reportDry.actions.upload, []);
    assert.deepEqual(reportDry.actions.download, []);
    assert.equal(reportDry.dryRun, true);

    const reportUnconfirmed = await buildSyncReport({ dryRun: false, deleteOrphans: true, confirmed: false });
    assert.deepEqual(reportUnconfirmed.actions?.delete, []);
  });

  it("multi-res validates variants against predefined variants and dimensions", () => {
    const v720 = parseVariantLabel("720p");
    assert.equal(v720.width, 1280);
    assert.equal(v720.height, 720);

    const vCustom = parseVariantLabel("640x360");
    assert.equal(vCustom.width, 640);
    assert.equal(vCustom.height, 360);

    assert.throws(() => parseVariantLabel("invalid-preset-xyz"), /Unknown variant/);
    assert.ok(PREDEFINED_VARIANTS["1080p"]);
  });

  it("benchmark isolates history outside cleanable cache", () => {
    const histPath = getBenchmarkHistoryPath("/test-project");
    assert.ok(!histPath.includes("/cache/"));
    assert.ok(histPath.endsWith("history.json"));
  });

  it("storyboard rejects unregistered transitions and validates composition", () => {
    const invalidBoard: Storyboard = {
      title: "Bad Transition",
      shots: [
        { type: "scene", config: { type: "shape", shapeType: "rectangle" } },
        { type: "transition", name: "fabricated-warp-transition" },
      ],
    };
    assert.throws(() => buildStoryboardClips(invalidBoard), (err: unknown) => {
      return (err as { code?: string }).code === "CC1002" || (err instanceof Error && err.message.includes("transition.name"));
    });

    const validBoard: Storyboard = {
      title: "Good Transition",
      shots: [
        { type: "scene", config: { type: "shape", shapeType: "rectangle" } },
        { type: "transition", name: "fade", duration: 1 },
        { type: "text", content: "Valid" },
      ],
    };
    const comp = storyboardToComposition(validBoard);
    assert.equal(comp.name, "Good Transition");
    assert.ok(Number(comp.duration) > 0);
  });

  it("shape drawPath handles 100,000 points without call stack overflow", () => {
    const canvas = new Canvas(100, 100);
    const ctx = canvas.getContext("2d");
    const drawContext: DrawContext = {
      canvas: canvas as unknown as DrawContext["canvas"],
      ctx: ctx as unknown as DrawContext["ctx"],
      transform: createDefaultTransform(),
      opacity: 1,
      blendMode: "source-over",
      clipPath: null,
    };

    const segments: PathSegment[] = [];
    for (let i = 0; i < 100_000; i++) {
      segments.push({ command: "line", points: [{ x: i % 100, y: (i * 3) % 100 }] });
    }

    assert.doesNotThrow(() => {
      drawPath(drawContext, segments, { fill: { r: 255, g: 0, b: 0, a: 1 } });
    });
  });
});
