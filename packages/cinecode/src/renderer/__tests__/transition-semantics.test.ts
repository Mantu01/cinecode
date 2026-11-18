import assert from "node:assert/strict";
import { test } from "node:test";
import type { Composition, VisualClip } from "../../core/types/index.js";
import { renderFrame } from "../engine.js";
import { createPreviewEngine } from "../preview-engine.js";

function solid(
  name: string,
  color: string,
  start: number,
  duration: number,
  extra: Partial<VisualClip> = {},
): VisualClip {
  return { type: "solid", name, color, width: 32, height: 32, start, duration, ...extra } as VisualClip;
}

function composition(clips: readonly VisualClip[], background = "#000000"): Composition {
  return {
    name: "transition-fixture",
    width: 32,
    height: 32,
    fps: 30,
    background,
    audio: {},
    rootTimeline: { tracks: [{ name: "main", kind: "visual", clips }] },
  };
}

async function pixelAt(comp: Composition, frame: number): Promise<[number, number, number]> {
  const result = await renderFrame(comp, frame, 0.5);
  const data = result.canvas.getContext("2d").getImageData(16, 16, 1, 1).data;
  const alpha = data[3]! / 255;
  return [data[0]! * alpha, data[1]! * alpha, data[2]! * alpha];
}

test("a single clip entry transition blends in from the underlying state", async () => {
  const comp = composition([
    solid("solo", "#ffffff", 0.5, 1, { transitionIn: { name: "crossfade", duration: 0.5 } }),
  ]);
  const first = await pixelAt(comp, 15);
  const middle = await pixelAt(comp, 22);
  const last = await pixelAt(comp, 29);
  assert.ok(first[0] < 20, `first frame should be background, got ${first[0]}`);
  assert.ok(middle[0] > 40 && middle[0] < 220, `middle frame should be partial, got ${middle[0]}`);
  assert.ok(last[0] > 180, `last entry frame should be nearly opaque, got ${last[0]}`);
});

test("an exit transition blends out and stops at the clip end", async () => {
  const comp = composition([
    solid("solo", "#ffffff", 0, 1, { transitionOut: { name: "crossfade", duration: 0.5 } }),
  ]);
  const first = await pixelAt(comp, 16);
  const middle = await pixelAt(comp, 22);
  const last = await pixelAt(comp, 29);
  const past = await pixelAt(comp, 30);
  assert.ok(first[0] > 200, `exit should start opaque, got ${first[0]}`);
  assert.ok(middle[0] > 40 && middle[0] < 220, `exit middle should be partial, got ${middle[0]}`);
  assert.ok(last[0] < 30, `exit should end transparent, got ${last[0]}`);
  assert.ok(past[0] < 5, `nothing may render past the clip end, got ${past[0]}`);
});

test("progress uses the clip's real start, not frame zero", async () => {
  const comp = composition([
    solid("late", "#ffffff", 2, 1, { transitionIn: { name: "crossfade", duration: 0.5 } }),
  ]);
  assert.ok((await pixelAt(comp, 59))[0] < 20);
  assert.ok((await pixelAt(comp, 74))[0] > 180);
});

test("two overlapping clips crossfade between their own visuals", async () => {
  const comp = composition([
    solid("a", "#ff0000", 0, 2),
    solid("b", "#0000ff", 1, 2, { transitionIn: { name: "crossfade", duration: 1 } }),
  ]);
  const [r0, , b0] = await pixelAt(comp, 30);
  const [r1, , b1] = await pixelAt(comp, 45);
  const [r2, , b2] = await pixelAt(comp, 59);
  assert.ok(r0 > 200 && b0 < 30, `transition start should show the underlying clip`);
  assert.ok(r1 > 80 && b1 > 80, `mid transition should blend both clips`);
  assert.ok(b2 > 230 && r2 < 30, `transition end should show the incoming clip`);
});

test("three overlapping clips use the previous clip as the underlay in declaration order", async () => {
  const comp = composition([
    solid("a", "#ff0000", 0, 3),
    solid("b", "#00ff00", 1, 2, { transitionIn: { name: "crossfade", duration: 0.5 } }),
    solid("c", "#0000ff", 2, 1, { transitionIn: { name: "crossfade", duration: 0.5 } }),
  ]);
  const [r0, g0, b0] = await pixelAt(comp, 60);
  assert.ok(g0 > 200 && b0 < 30 && r0 < 30, `third clip should blend from the second clip`);
  const [r1, g1, b1] = await pixelAt(comp, 67);
  assert.ok(g1 > 40 && b1 > 40, `mid blend should mix the second and third clips`);
  assert.ok(r1 < 30);
  const [r2, g2, b2] = await pixelAt(comp, 74);
  assert.ok(b2 > 200 && g2 < 40 && r2 < 30, `third clip should own the frame after its entry`);
});

test("standard and preview paths produce the same transition frame", async () => {
  const comp = composition([
    solid("a", "#ff0000", 0, 2),
    solid("b", "#0000ff", 0.5, 1.5, { transitionIn: { name: "crossfade", duration: 0.5 } }),
  ]);
  const standard = await renderFrame(comp, 22, 0.5);
  const expected = Buffer.from(
    standard.canvas
      .getContext("2d")
      .getImageData(0, 0, standard.canvas.width, standard.canvas.height).data,
  );
  const preview = await createPreviewEngine(comp, { scale: 1, bypassEffects: false }).render(22);
  const actual = Buffer.from(
    preview.canvas.getContext("2d").getImageData(0, 0, preview.canvas.width, preview.canvas.height).data,
  );
  assert.deepEqual(actual, expected);
});
