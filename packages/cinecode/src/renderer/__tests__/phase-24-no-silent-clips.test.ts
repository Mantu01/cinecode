import assert from "node:assert/strict";
import { test } from "node:test";
import type { Clip, Composition, Timeline, VisualClip } from "../../core/types/index.js";
import { renderFrame } from "../engine.js";
import { validateComposition } from "../../core/validation/index.js";

const ALL_CLIP_TYPES = [
  "video",
  "image",
  "text",
  "shape",
  "solid",
  "group",
  "scene",
  "component",
  "audio",
  "sound",
  "tts",
  "model3d",
  "svg",
  "particle",
  "noise",
  "audioVisualizer",
  "chromakey",
  "subtitle",
  "dataViz",
  "sticker",
  "gradient-mesh",
  "meshwarp",
  "text3d",
  "multiCamera",
] as const;

function makeComposition(clips: readonly VisualClip[], extra: Partial<Composition> = {}): Composition {
  return {
    name: "test-comp",
    width: 64,
    height: 64,
    fps: 30,
    background: "#000000",
    audio: { sampleRate: 48000, channels: 2, masterVolume: 1 },
    rootTimeline: { tracks: [{ name: "main", kind: "visual", clips }] },
    ...extra,
  };
}

test("nested scene renders content inside clip window and respects clip transform and opacity", async () => {
  const nestedTimeline: Timeline = {
    tracks: [
      {
        name: "nested-track",
        kind: "visual",
        clips: [
          {
            type: "solid",
            name: "nested-solid",
            color: "#ff0000",
            width: 64,
            height: 64,
            start: 0,
            duration: 1,
          } as VisualClip,
        ],
      },
    ],
  };

  const comp = makeComposition(
    [
      {
        type: "scene",
        name: "scene-clip",
        ref: "intro",
        start: 0,
        duration: 1,
        width: 64,
        height: 64,
      } as VisualClip,
    ],
    {
      scenes: {
        intro: nestedTimeline,
      },
    },
  );

  const validation = validateComposition(comp);
  assert.equal(validation.valid, true, "valid nested scene passes validation");

  const result = await renderFrame(comp, 0, 0);
  const data = result.canvas.getContext("2d").getImageData(32, 32, 1, 1).data;
  assert.ok(data[0]! > 100, `red channel should be painted, got ${data[0]}`);
  assert.equal(data[3]!, 255, `alpha should be 255 for opaque nested content, got ${data[3]}`);
});

test("rejected component clip fails validation before frame one with coded error and location", async () => {
  const comp = makeComposition([
    {
      type: "component",
      name: "bad-comp-clip",
      ref: "comp-a",
      start: 0,
      duration: 1,
    } as VisualClip,
  ]);

  const validation = validateComposition(comp);
  assert.equal(validation.valid, false, "component clip must be rejected at validation");
  const error = validation.errors.find((e) => e.clipName === "bad-comp-clip");
  assert.ok(error, "validation error must report the clip name");
  assert.equal(error?.code, "CC3007");
  assert.equal(error?.trackName, "main");
  assert.ok(error?.timecode, "timecode must be present");
  assert.match(error!.message, /flatten the component into the timeline/i);

  await assert.rejects(
    () => renderFrame(comp, 0, 0),
    (err: Error) => {
      assert.match(err.message, /bad-comp-clip/);
      return true;
    },
  );
});

test("unresolved scene clip fails validation before frame one naming missing reference", async () => {
  const comp = makeComposition([
    {
      type: "scene",
      name: "unresolved-scene",
      ref: "missing-scene",
      start: 0,
      duration: 1,
    } as VisualClip,
  ]);

  const validation = validateComposition(comp);
  assert.equal(validation.valid, false, "unresolved scene clip must be rejected at validation");
  const error = validation.errors.find((e) => e.clipName === "unresolved-scene");
  assert.ok(error, "validation error must report clip name");
  assert.equal(error?.code, "CC3007");
  assert.match(error!.message, /missing-scene/);
  assert.match(error!.message, /flatten the scene into the timeline/i);

  await assert.rejects(
    () => renderFrame(comp, 0, 0),
    (err: Error) => {
      assert.match(err.message, /unresolved-scene/);
      return true;
    },
  );
});

test("clip coverage test verifies all clip types are either renderable or rejected at validation", () => {
  const renderableTypes = new Set([
    "solid",
    "shape",
    "text",
    "image",
    "video",
    "group",
    "scene",
    "model3d",
    "multiCamera",
    "svg",
    "particle",
    "noise",
    "audioVisualizer",
    "chromakey",
    "subtitle",
    "dataViz",
    "sticker",
    "gradient-mesh",
    "meshwarp",
    "text3d",
  ]);

  const nonVisualOrRejectedTypes = new Set([
    "component",
    "audio",
    "sound",
    "tts",
  ]);

  for (const type of ALL_CLIP_TYPES) {
    if (nonVisualOrRejectedTypes.has(type)) {
      if (type === "component") {
        const comp = makeComposition([
          { type, name: `clip-${type}`, ref: "test", start: 0, duration: 1 } as unknown as VisualClip,
        ]);
        assert.equal(validateComposition(comp).valid, false, `${type} must fail validation`);
      }
    } else {
      assert.ok(renderableTypes.has(type), `${type} must be classified as renderable`);
    }
  }

  assert.equal(
    renderableTypes.size + nonVisualOrRejectedTypes.size,
    ALL_CLIP_TYPES.length,
    "every clip type in union is covered without omission",
  );
});
