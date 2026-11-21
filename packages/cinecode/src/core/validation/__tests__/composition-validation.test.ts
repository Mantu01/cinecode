import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Composition } from "../../types/index.js";
import { createRenderJob } from "../../../pipeline/index.js";
import { validateComposition } from "../composition.js";

function fixture(overrides: Partial<Composition> = {}): Composition {
  return {
    name: "validation-fixture",
    width: 64,
    height: 32,
    fps: 30,
    background: "#000000",
    audio: {},
    rootTimeline: {
      tracks: [
        {
          name: "main",
          kind: "visual",
          clips: [
            { type: "solid", name: "base", color: "#ffffff", width: 64, height: 32, start: 0, duration: 1 },
          ],
        },
      ],
    },
    ...overrides,
  };
}

function codes(composition: Composition): string[] {
  const result = validateComposition(composition);
  return [...result.errors, ...result.warnings].map((issue) => issue.code);
}

test("a valid composition passes the shared validator", () => {
  const result = validateComposition(fixture());
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.checkedClips, 1);
});

test("negative start and zero duration fail with clip, track and timecode", () => {
  const negative = fixture();
  (negative.rootTimeline.tracks[0] as { clips: unknown[] }).clips = [
    { type: "solid", name: "bad", color: "#ffffff", start: -1, duration: 1 },
  ];
  const negativeResult = validateComposition(negative);
  const negativeIssue = [...negativeResult.errors, ...negativeResult.warnings][0]!;
  assert.equal(negativeIssue.code, "CC3003");
  assert.equal(negativeIssue.clipName, "bad");
  assert.equal(negativeIssue.trackName, "main");
  assert.match(negativeIssue.timecode ?? "", /^\d{2}:\d{2}:\d{2}:\d{2}$/);

  const zero = fixture();
  (zero.rootTimeline.tracks[0] as { clips: unknown[] }).clips = [
    { type: "solid", name: "bad", color: "#ffffff", start: 0, duration: 0 },
  ];
  assert.ok(codes(zero).includes("CC3002"));
});

test("overshoot warns under clamp and fails under strict", () => {
  const comp = fixture({ duration: 0.5 });
  assert.ok(
    validateComposition(comp).warnings.some((issue) => issue.code === "CC1004"),
    "clamp should report a warning",
  );
  const strict = fixture({ duration: 0.5, boundaryBehavior: "strict" });
  assert.ok(
    validateComposition(strict).errors.some((issue) => issue.code === "CC1004"),
    "strict should report an error",
  );
});

test("unknown clip types, effects and transitions are fatal", () => {
  const comp = fixture();
  (comp.rootTimeline.tracks[0] as { clips: unknown[] }).clips = [
    { type: "solid", name: "a", color: "#ffffff", start: 0, duration: 1, effects: [{ name: "nope" }] },
  ];
  assert.ok(codes(comp).includes("CC3007"));
  assert.equal(validateComposition(comp).errors[0]?.clipName, "a");

  const transition = fixture();
  (transition.rootTimeline.tracks[0] as { clips: unknown[] }).clips = [
    { type: "solid", name: "a", color: "#ffffff", start: 0, duration: 1, transitionIn: { name: "nope" } },
  ];
  assert.ok(codes(transition).includes("CC3007"));

  const unknownType = fixture();
  (unknownType.rootTimeline.tracks[0] as { clips: unknown[] }).clips = [
    { type: "hologram", name: "a", start: 0, duration: 1 },
  ];
  assert.ok(codes(unknownType).includes("CC3007"));
});

test("missing required properties are fatal", () => {
  const comp = fixture();
  (comp.rootTimeline.tracks[0] as { clips: unknown[] }).clips = [
    { type: "text", name: "title", start: 0, duration: 1 },
  ];
  const result = validateComposition(comp);
  assert.ok(result.errors.some((issue) => issue.code === "CC3007" && /fontSize|content/.test(issue.message)));

  const audio = fixture();
  (audio.rootTimeline as { tracks: unknown[] }).tracks = [
    {
      name: "audio",
      kind: "audio",
      clips: [{ type: "audio", name: "ambient", buffer: { length: 1 }, start: 0, duration: 1 }],
    },
  ];
  assert.equal(validateComposition(audio).valid, true, "an inline buffer replaces the src requirement");
});

test("overlaps are fatal unless a transition explains them", () => {
  const comp = fixture();
  (comp.rootTimeline.tracks[0] as { clips: unknown[] }).clips = [
    { type: "solid", name: "a", color: "#ffffff", start: 0, duration: 1 },
    { type: "solid", name: "b", color: "#000000", start: 0.5, duration: 1 },
  ];
  assert.ok(codes(comp).includes("CC3001"));

  (comp.rootTimeline.tracks[0] as { clips: unknown[] }).clips = [
    { type: "solid", name: "a", color: "#ffffff", start: 0, duration: 1 },
    { type: "solid", name: "b", color: "#000000", start: 0.5, duration: 1, transitionIn: { name: "crossfade" } },
  ];
  assert.ok(!codes(comp).includes("CC3001"));
});

test("duplicate track names and missing split-screen tracks are fatal", () => {
  const duplicate = fixture();
  (duplicate.rootTimeline as { tracks: unknown[] }).tracks.push({ name: "main", kind: "visual", clips: [] });
  assert.ok(codes(duplicate).includes("CC3007"));

  const split = fixture({
    splitScreen: { layout: "custom", regions: [{ x: 0, y: 0, width: 10, height: 10, clipIndex: 4 }] },
  });
  assert.ok(codes(split).includes("CC3007"));
});

test("the render pipeline refuses to start on a fatal issue", async () => {
  const comp = fixture();
  (comp.rootTimeline.tracks[0] as { clips: unknown[] }).clips = [
    { type: "text", name: "title", start: 0, duration: 1 },
  ];
  const cacheDir = mkdtempSync(join(tmpdir(), "cinecode-validation-"));
  const job = createRenderJob({
    composition: comp,
    outputPath: join(cacheDir, "out.mp4"),
    cacheDir,
    seed: 0,
    concurrency: 1,
    chunkSize: 1,
    quality: "low",
    overwrite: true,
    fresh: true,
    noCache: true,
    silent: true,
  });
  await assert.rejects(job.promise, (error: Error & { code?: string; location?: { clip?: string; track?: string } }) => {
    assert.equal(error.code, "CC1013");
    assert.equal(error.location?.clip, "title");
    assert.equal(error.location?.track, "main");
    return true;
  });
});
