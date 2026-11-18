import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { test } from "node:test";
import type { Composition } from "../../core/types/index.js";
import {
  BUILTIN_EFFECT_NAMES,
  BUILTIN_TRANSITION_NAMES,
  EXTENSION_REGISTRY_VERSION,
  createBuiltinRegistry,
} from "../bootstrap.js";
import { getExtensions, setExtensions } from "../index.js";
import { createRenderRuntime } from "../../renderer/runtime.js";
import { renderFrame } from "../../renderer/engine.js";

const EXPECTED_EFFECTS = [
  "anamorphic-flare",
  "bloom",
  "blur",
  "box-blur",
  "brightness",
  "bulge",
  "chroma-key",
  "chromatic-aberration",
  "color-grading",
  "contrast",
  "denoise",
  "depth-of-field",
  "film-border",
  "film-grain",
  "film-scratch",
  "gaussian-blur",
  "glitch",
  "hue-rotate",
  "ken-burns",
  "light-leak",
  "lut",
  "neon-glow",
  "noise",
  "overlay",
  "rgb-curves",
  "saturation",
  "sharpen",
  "vignette",
];

const EXPECTED_TRANSITIONS = [
  "crossfade",
  "dissolve",
  "fade",
  "fade-white",
  "iris",
  "iris-close",
  "iris-open",
  "push",
  "slide",
  "spin",
  "wipe",
  "wipe-curve",
  "wipe-diagonal",
  "zoom",
];

function fixtureComposition(effectName = "vignette", transitionName = "fade"): Composition {
  return {
    name: "registry-fixture",
    width: 64,
    height: 32,
    fps: 30,
    background: "#000000",
    audio: {},
    rootTimeline: {
      tracks: [
        {
          name: "base",
          kind: "visual",
          clips: [
            {
              type: "solid",
              name: "base",
              color: "#cc2244",
              width: 64,
              height: 32,
              start: 0,
              duration: 2,
              effects: [{ name: effectName, params: { amount: 0.9 } }],
            },
          ],
        },
        {
          name: "top",
          kind: "visual",
          clips: [
            {
              type: "solid",
              name: "top",
              color: "#2244cc",
              width: 64,
              height: 32,
              start: 0,
              duration: 2,
              transitionIn: { name: transitionName, duration: 1 },
            },
          ],
        },
      ],
    },
  };
}

function runWorker<T>(workerData: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./registry-worker.js", import.meta.url), { workerData });
    worker.once("message", (message: T) => {
      void worker.terminate();
      resolve(message);
    });
    worker.once("error", reject);
  });
}

test("built-in inventory is complete, unique and versioned", () => {
  assert.equal(EXTENSION_REGISTRY_VERSION, "1");
  assert.deepEqual(BUILTIN_EFFECT_NAMES, EXPECTED_EFFECTS);
  assert.deepEqual(BUILTIN_TRANSITION_NAMES, EXPECTED_TRANSITIONS);
  assert.equal(new Set(BUILTIN_EFFECT_NAMES).size, BUILTIN_EFFECT_NAMES.length);
  assert.equal(new Set(BUILTIN_TRANSITION_NAMES).size, BUILTIN_TRANSITION_NAMES.length);
});

test("every built-in resolves from the bootstrap registry", () => {
  const runtime = createRenderRuntime(createBuiltinRegistry());
  for (const name of EXPECTED_EFFECTS) assert.ok(runtime.resolveEffect(name), `effect ${name}`);
  for (const name of EXPECTED_TRANSITIONS) {
    assert.ok(runtime.resolveTransition(name), `transition ${name}`);
  }
  assert.deepEqual(runtime.size, { effects: EXPECTED_EFFECTS.length, transitions: EXPECTED_TRANSITIONS.length });
  assert.equal(runtime.resolveEffect("no-such-effect"), undefined);
  assert.equal(runtime.resolveTransition("no-such-transition"), undefined);
});

test("worker-thread runtime resolves every built-in", async () => {
  const result = await runWorker<{
    missingEffects: string[];
    missingTransitions: string[];
    unknownEffect: boolean;
    unknownTransition: boolean;
    size: { effects: number; transitions: number };
  }>({ mode: "inventory" });
  assert.deepEqual(result.missingEffects, []);
  assert.deepEqual(result.missingTransitions, []);
  assert.equal(result.unknownEffect, true);
  assert.equal(result.unknownTransition, true);
  assert.deepEqual(result.size, { effects: EXPECTED_EFFECTS.length, transitions: EXPECTED_TRANSITIONS.length });
});

test("unknown effect names fail with available names and clip context", async () => {
  await assert.rejects(
    renderFrame(fixtureComposition("no-such-effect"), 5, 0.5),
    (error: Error & { code?: string; location?: { clip?: string; track?: string; time?: string } }) => {
      assert.equal(error.code, "CC3007");
      assert.match(error.message, /no-such-effect/);
      assert.match(error.message, /vignette/);
      assert.equal(error.location?.clip, "base");
      assert.equal(error.location?.track, "base");
      assert.match(error.location?.time ?? "", /frame 5/);
      return true;
    },
  );
});

test("unknown transition names fail with available names and clip context", async () => {
  await assert.rejects(
    renderFrame(fixtureComposition("vignette", "no-such-transition"), 5, 0.5),
    (error: Error & { code?: string; location?: { clip?: string; track?: string } }) => {
      assert.equal(error.code, "CC3007");
      assert.match(error.message, /no-such-transition/);
      assert.match(error.message, /crossfade/);
      assert.equal(error.location?.clip, "top");
      assert.equal(error.location?.track, "top");
      return true;
    },
  );
});

test("main-thread and worker renders of effects and transitions are pixel-identical", async () => {
  const composition = fixtureComposition();
  const frame = 5;
  const seed = 0.25;

  const main = await renderFrame(composition, frame, seed);
  const mainPixels = Buffer.from(
    main.canvas.getContext("2d").getImageData(0, 0, main.canvas.width, main.canvas.height).data,
  ).toString("base64");

  const worker = await runWorker<{ pixels: string; width: number; height: number }>({
    mode: "render",
    composition,
    frame,
    seed,
  });

  assert.equal(worker.width, composition.width);
  assert.equal(worker.height, composition.height);
  assert.equal(worker.pixels, mainPixels);
});

test("default registry is bootstrap-backed and replaceable", () => {
  const bootstrapRegistry = createBuiltinRegistry();
  const runtime = createRenderRuntime(bootstrapRegistry);
  assert.equal(runtime.listEffects().length, EXPECTED_EFFECTS.length);
  setExtensions(bootstrapRegistry);
  assert.equal(getExtensions(), bootstrapRegistry);
  setExtensions(null);
  assert.notEqual(getExtensions(), bootstrapRegistry);
});
