import { parentPort, workerData } from "node:worker_threads";
import { BUILTIN_EFFECT_NAMES, BUILTIN_TRANSITION_NAMES, createBuiltinRegistry } from "../bootstrap.js";
import { createRenderRuntime } from "../../renderer/runtime.js";
import { renderFrame } from "../../renderer/engine.js";
import type { Composition } from "../../core/types/index.js";

const runtime = createRenderRuntime(createBuiltinRegistry(), "worker");
const input = workerData as {
  mode: "inventory" | "render";
  composition?: Composition;
  frame?: number;
  seed?: number;
};

if (input.mode === "render" && input.composition) {
  const result = await renderFrame(input.composition, input.frame ?? 0, input.seed ?? 0, { runtime });
  const { data } = result.canvas
    .getContext("2d")
    .getImageData(0, 0, result.canvas.width, result.canvas.height);
  parentPort!.postMessage({
    pixels: Buffer.from(data).toString("base64"),
    width: result.canvas.width,
    height: result.canvas.height,
  });
} else {
  parentPort!.postMessage({
    missingEffects: BUILTIN_EFFECT_NAMES.filter((name) => !runtime.resolveEffect(name)),
    missingTransitions: BUILTIN_TRANSITION_NAMES.filter((name) => !runtime.resolveTransition(name)),
    unknownEffect: runtime.resolveEffect("no-such-effect") === undefined,
    unknownTransition: runtime.resolveTransition("no-such-transition") === undefined,
    size: runtime.size,
  });
}
