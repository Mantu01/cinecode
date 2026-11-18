import assert from "node:assert/strict";
import { test } from "node:test";
import type { Composition } from "../../core/types/index.js";
import { renderFrame } from "../engine.js";
import { resolveRegions } from "../pip.js";
import { resetDiagnostics, takeDegradations } from "../../errors/index.js";

function track(name: string, color: string, start = 0, duration = 1) {
  return {
    name,
    kind: "visual" as const,
    clips: [
      {
        type: "solid" as const,
        name,
        color,
        width: 64,
        height: 32,
        start,
        duration,
      },
    ],
  };
}

function composition(tracks: readonly ReturnType<typeof track>[], regions: Composition["splitScreen"]): Composition {
  return {
    name: "split-fixture",
    width: 64,
    height: 32,
    fps: 30,
    background: "#000000",
    audio: {},
    rootTimeline: { tracks },
    splitScreen: regions,
  };
}

function pixel(canvas: { getContext: (id: "2d") => any }, x: number, y: number): [number, number, number, number] {
  const data = canvas.getContext("2d").getImageData(x, y, 1, 1).data;
  return [data[0]!, data[1]!, data[2]!, data[3]!];
}

test("regions resolve by declared track, not by clip order", async () => {
  const left = track("left", "#ff0000");
  const right = track("right", "#0000ff");
  const regions = {
    layout: "custom" as const,
    regions: [
      { x: 0, y: 0, width: 0.5, height: 1, track: "right", clipIndex: 0 },
      { x: 0.5, y: 0, width: 0.5, height: 1, track: "left", clipIndex: 1 },
    ],
  };
  const first = await renderFrame(composition([left, right], regions), 0, 0);
  const [r0, , b0] = pixel(first.canvas, 16, 16);
  const [r1, , b1] = pixel(first.canvas, 48, 16);
  assert.ok(b0 > 200 && r0 < 30, "left region must show the right track");
  assert.ok(r1 > 200 && b1 < 30, "right region must show the left track");

  const reordered = await renderFrame(composition([right, left], regions), 0, 0);
  assert.deepEqual(pixel(reordered.canvas, 16, 16), pixel(first.canvas, 16, 16));
  assert.deepEqual(pixel(reordered.canvas, 48, 16), pixel(first.canvas, 48, 16));
});

test("an inactive source track renders the documented empty region", async () => {
  resetDiagnostics();
  const empty = track("later", "#00ff00", 1, 1);
  const regions = {
    layout: "custom" as const,
    regions: [{ x: 0, y: 0, width: 1, height: 1, track: "later", clipIndex: 0 }],
  };
  const result = await renderFrame(composition([empty], regions), 0, 0);
  assert.equal(pixel(result.canvas, 32, 16)[3], 0);
  assert.ok(takeDegradations().some((entry) => /no active clip/.test(entry.what)));
});

test("padding and rounded corners apply at region size", () => {
  const resolved = resolveRegions(64, 32, [
    { x: 0, y: 0, width: 0.5, height: 1, clipIndex: 0, padding: 8, roundedCorners: 10 },
  ]);
  assert.equal(resolved[0]?.x, 0);
  assert.ok((resolved[0]?.width ?? 0) < 32);
  assert.equal(resolved[0]?.roundedCorners, 10);
});
