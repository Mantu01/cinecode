import assert from "node:assert/strict";
import { test } from "node:test";
import type { Composition, VisualClip } from "../../core/types/index.js";
import {
  compositionTotalFrames,
  compositionConversion,
  resolveFrameWindow,
  durationToFrames,
  secondsToFrame,
  frameToSeconds,
} from "../../core/time/index.js";
import { PreviewLoop } from "../../dev/previewLoop.js";
import { resetDiagnostics, pendingDegradations } from "../../errors/degradations.js";

function makeComposition(overrides: Partial<Composition>): Composition {
  return {
    name: "timebase-fixture",
    width: 64,
    height: 64,
    fps: 30,
    background: "#000000",
    audio: { sampleRate: 48000, channels: 2, masterVolume: 1 },
    rootTimeline: {
      tracks: [
        {
          name: "main",
          kind: "visual",
          clips: [
            {
              type: "solid",
              name: "bg",
              color: "#ff0000",
              start: 0,
              duration: 1,
            } as VisualClip,
          ],
        },
      ],
    },
    ...overrides,
  };
}

test("timebase agreement test table over all boundary and rate conditions", () => {
  const table = [
    {
      label: "integer duration at 30 fps",
      fps: 30,
      duration: 2,
      expectedFrames: 60,
    },
    {
      label: "fractional duration at 30 fps",
      fps: 30,
      duration: 2.5,
      expectedFrames: 75,
    },
    {
      label: "fractional duration at 24 fps",
      fps: 24,
      duration: 1.5,
      expectedFrames: 36,
    },
    {
      label: "duration exactly on frame boundary (1s at 30fps)",
      fps: 30,
      duration: 1.0,
      expectedFrames: 30,
    },
    {
      label: "duration exactly on frame boundary (1/24s at 24fps)",
      fps: 24,
      duration: 1 / 24,
      expectedFrames: 1,
    },
    {
      label: "duration 1ms past boundary (1.001s at 30fps -> 30.03 frames -> 31 frames)",
      fps: 30,
      duration: 1.001,
      expectedFrames: 31,
    },
    {
      label: "variable frame rate composition with tempo regions",
      fps: 30,
      duration: 2,
      tempo: [
        { start: 0, end: 1, fps: 20 },
        { start: 1, end: 2, fps: 40 },
      ],
      expectedFrames: 60,
    },
  ];

  for (const entry of table) {
    const comp = makeComposition({
      fps: entry.fps,
      duration: entry.duration,
      tempo: entry.tempo,
    });

    // 1. Timebase canonical computation
    const timebaseFrames = compositionTotalFrames(comp);
    assert.equal(
      timebaseFrames,
      entry.expectedFrames,
      `[${entry.label}] compositionTotalFrames mismatch`,
    );

    // 2. Pipeline window resolution
    const window = resolveFrameWindow(comp);
    assert.equal(
      window.totalFrames,
      entry.expectedFrames,
      `[${entry.label}] resolveFrameWindow totalFrames mismatch`,
    );
    assert.equal(window.from, 0);
    assert.equal(window.to, entry.expectedFrames);

    // 3. Preview loop totalFrames
    const preview = new PreviewLoop(comp, () => {});
    assert.equal(
      preview.totalFrames(),
      entry.expectedFrames,
      `[${entry.label}] PreviewLoop.totalFrames mismatch`,
    );

    // 4. Conversion consistency
    const conv = compositionConversion(comp);
    const roundTrip = frameToSeconds(secondsToFrame(1.0, conv), conv);
    assert.ok(Math.abs(roundTrip - 1.0) < 1e-3, `[${entry.label}] round trip drift too large`);
  }
});

test("window exceeding composition reports degradation CC4001 and clamps without throw", () => {
  resetDiagnostics();
  const comp = makeComposition({ duration: 2, fps: 30 }); // 60 frames

  const window = resolveFrameWindow(comp, 0, 100);
  assert.equal(window.clamped, true);
  assert.equal(window.from, 0);
  assert.equal(window.to, 60);
  assert.equal(window.totalFrames, 60);

  const degradations = pendingDegradations().filter((d) => d.code === "CC4001");
  assert.equal(degradations.length, 1);
  assert.equal(degradations[0]?.what, "render window");
});

test("boundary behavior extend includes clips extending beyond duration", () => {
  const comp = makeComposition({
    duration: 1, // 30 frames
    fps: 30,
    boundaryBehavior: "extend",
    rootTimeline: {
      tracks: [
        {
          name: "main",
          kind: "visual",
          clips: [
            {
              type: "solid",
              name: "long-clip",
              color: "#ff0000",
              start: 0,
              duration: 3, // 90 frames
            } as VisualClip,
          ],
        },
      ],
    },
  });

  const frames = compositionTotalFrames(comp);
  assert.equal(frames, 90, "extend boundaryBehavior must honor clip end");
});
