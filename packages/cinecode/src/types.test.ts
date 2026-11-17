/**
 * Type-level tests — these files exist to ensure TypeScript types compile correctly.
 * They are not runtime tests but catch type regressions in CI.
 */
import type { Composition, VideoClip, AudioTrack } from "./core/types/index.js";
import { composition, track, timeline } from "./core/clips/builders.js";
import { video, audio, sound } from "./core/clips/factories.js";
import { defineEffect } from "./effects/engine.js";

// --- Composition type tests ---
const comp: Composition = composition({
  name: "test",
  width: 1920,
  height: 1080,
  fps: 30,
  rootTimeline: timeline([
    track("video", [
      video("input.mp4", { fit: "cover" }),
    ]),
  ]),
});

// --- Effect type tests ---
const blurEffect = defineEffect({
  name: "blur",
  params: { radius: { default: 5, type: "number" } },
  process: (_input, params) => {
    // TypeScript should infer params.radius as number
    const r: number = (params as { radius: number }).radius;
    void r;
  },
});

// --- Config type tests ---
import type { InferredCinecodeConfig } from "./config/zod-schema.js";
const config: InferredCinecodeConfig = {
  schemaVersion: 2,
  project: { entry: "./main.ts", sourceDir: "./src", outputDir: "./output", cacheDir: ".cinecode/cache" },
  sourceDir: "./src",
  outputDir: "./output",
  cacheDir: ".cinecode/cache",
  video: { width: 1920, height: 1080, fps: 30, background: "#000000" },
  render: { quality: "final" },
};

export { comp, blurEffect, config };
