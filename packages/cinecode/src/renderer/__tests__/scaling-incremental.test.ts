import assert from "node:assert/strict";
import { test } from "node:test";
import { Canvas } from "@napi-rs/canvas";
import type { Composition, VisualClip } from "../../core/types/index.js";
import {
  clearRendererCaches,
  createRenderSession,
  renderFrame,
} from "../engine.js";

function shape(
  name: string,
  start: number,
  duration: number,
  extra: Partial<VisualClip> = {},
): VisualClip {
  return {
    type: "shape",
    name,
    shapeType: "rectangle",
    width: 16,
    height: 16,
    start,
    duration,
    fill: "#ffffff",
    ...extra,
  } as VisualClip;
}

function composition(clips: readonly VisualClip[], width = 64, height = 32): Composition {
  return {
    name: "scaling-fixture",
    width,
    height,
    fps: 30,
    background: "#000000",
    audio: {},
    rootTimeline: { tracks: [{ name: "main", kind: "visual", clips }] },
  };
}

function bytes(canvas: { getContext: (id: "2d") => any; width: number; height: number }): Buffer {
  return Buffer.from(
    canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data,
  );
}

function alphaAt(canvas: { getContext: (id: "2d") => any }, x: number, y: number): number {
  return canvas.getContext("2d").getImageData(x, y, 1, 1).data[3]!;
}

test("scaled render matches a full render downsampled geometrically", async () => {
  const comp = composition([
    {
      type: "shape",
      name: "gradient",
      shapeType: "rectangle",
      width: 64,
      height: 32,
      start: 0,
      duration: 1,
      fill: {
        type: "linear",
        angle: 45,
        stops: [
          { color: "#ff0000", offset: 0 },
          { color: "#0000ff", offset: 1 },
        ],
      },
      effects: [{ name: "blur", params: { radius: 2 } }],
    } as VisualClip,
  ]);
  const full = await renderFrame(comp, 0, 0.5);
  const reference = new Canvas(32, 16);
  const refCtx = reference.getContext("2d");
  refCtx.imageSmoothingEnabled = true;
  refCtx.imageSmoothingQuality = "high";
  refCtx.drawImage(full.canvas, 0, 0, 64, 32, 0, 0, 32, 16);

  const scaled = await renderFrame(comp, 0, 0.5, { resolutionScale: 0.5 });
  assert.equal(scaled.canvas.width, 32);
  assert.equal(scaled.canvas.height, 16);
  const actual = bytes(scaled.canvas);
  const expected = bytes(reference);
  assert.equal(actual.length, expected.length);
  let maxDelta = 0;
  for (let i = 0; i < actual.length; i += 1) {
    maxDelta = Math.max(maxDelta, Math.abs(actual[i]! - expected[i]!));
  }
  assert.ok(maxDelta <= 2, `scaled render differs by ${maxDelta}`);
});

test("incremental rendering matches a fresh render across changing clips", async () => {
  const comp = composition([
    shape("first", 0, 1 / 30),
    shape("second", 1 / 30, 1, { fill: "#00ff00" }),
  ]);
  const session = createRenderSession();
  await renderFrame(comp, 0, 0.5, { session });
  const incremental = await renderFrame(comp, 1, 0.5, { session });
  clearRendererCaches();
  const fresh = await renderFrame(comp, 1, 0.5);
  assert.deepEqual(bytes(incremental.canvas), bytes(fresh.canvas));
  assert.equal(alphaAt(fresh.canvas, 0, 0), 255);
});

test("effect margins are not clipped by dirty-rect drawing", async () => {
  const comp = composition([
    shape("blurred", 0, 1, {
      width: 8,
      height: 8,
      effects: [{ name: "blur", params: { radius: 6 } }],
    }),
  ]);
  const session = createRenderSession();
  const result = await renderFrame(comp, 0, 0.5, { session });
  assert.ok(alphaAt(result.canvas, 14, 4) > 0, "blur should spread outside the clip box");
});

test("renderer caches clear between jobs and stay usable", async () => {
  const comp = composition([shape("base", 0, 1)]);
  const first = await renderFrame(comp, 0, 0.5);
  const before = bytes(first.canvas);
  clearRendererCaches();
  const second = await renderFrame(comp, 0, 0.5);
  assert.deepEqual(bytes(second.canvas), before);
});
