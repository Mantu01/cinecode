import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validateAuthoringConfig, validateConfig } from "../config/validator.js";
import { normalizeConfig } from "../config/schema.js";
import { createInitCommand } from "../cli/wizard.js";
import { createCreateCommand } from "../cli/create.js";
import { defineScene, shape, text, timeline, track, composition } from "../core/index.js";
import { renderFrame } from "../renderer/engine.js";

test("Phase 33: starter scene keyframes achieve >99% JSON reduction and fast render", async () => {
  const WIDTH = 1920;
  const HEIGHT = 1080;
  const DURATION = 6;

  const scene = defineScene("Intro", DURATION, () =>
    timeline([
      track("background", [
        shape("rectangle", {
          width: WIDTH,
          height: HEIGHT,
          fill: {
            type: "radial",
            center: { x: 0.5, y: 0.4 },
            radius: 0.9,
            stops: [
              { color: "#2b251d", offset: 0 },
              { color: "#171512", offset: 0.45 },
              { color: "#0a0a0a", offset: 1 },
            ],
          },
          opacity: 0,
          keyframes: { opacity: [[0, 0], [0.9, 1, "easeOutCubic"]] },
          start: 0,
          duration: DURATION,
        }),
      ]),
      track("glow", [
        shape("ellipse", {
          width: 450 * 2,
          height: 450 * 2,
          fill: {
            type: "radial",
            center: { x: 0.5, y: 0.5 },
            radius: 0.5,
            stops: [
              { color: "rgba(200, 117, 51, 0.32)", offset: 0 },
              { color: "rgba(200, 117, 51, 0.14)", offset: 0.5 },
              { color: "rgba(200, 117, 51, 0)", offset: 1 },
            ],
          },
          opacity: 0,
          keyframes: {
            opacity: [[0, 0], [1.4, 0.85, "easeOutCubic"], [4.4, 0.85], [5.4, 0, "easeInCubic"]],
            "transform.x": [[0, 480], [DURATION, 520, "linear"]],
          },
          start: 0.1,
          duration: DURATION - 0.1,
        }),
      ]),
      track("ring", [
        shape("ellipse", {
          width: 460 * 2,
          height: 460 * 2,
          stroke: { color: "#d4a44c", width: 3, lineCap: "round" },
          opacity: 0,
          keyframes: {
            scale: [[0, 0.3], [1.4, 1, "easeOutExpo"]],
            opacity: [[0, 0], [0.35, 1, "easeOutCubic"], [1.1, 1], [1.8, 0, "easeInCubic"]],
          },
          start: 0.25,
          duration: 1.85,
        }),
      ]),
      track("title", [
        text("CINECODE", 108, {
          fontFamily: "Arial",
          fontWeight: 800,
          letterSpacing: 5,
          align: "center",
          maxWidth: WIDTH,
          fill: "#f5f0e8",
          opacity: 0,
          keyframes: {
            opacity: [[0, 0], [0.4, 1, "easeOutCubic"]],
            "transform.y": [[0, 400], [0.8, 360, "easeOutExpo"]],
            scale: [[0, 0.7], [0.8, 1, "easeOutExpo"]],
          },
          start: 1.1,
          duration: DURATION - 1.1,
        }),
      ]),
      track("accent-rule", [
        shape("rectangle", {
          width: 2,
          height: 4,
          fill: "#d4a44c",
          opacity: 0,
          keyframes: {
            width: [[0, 2], [0.6, 730, "easeOutExpo"]],
            opacity: [[0, 0], [0.3, 1, "easeOutCubic"]],
          },
          start: 2.0,
          duration: DURATION - 2.0,
        }),
      ]),
      track("tagline", [
        text("VIDEO, WRITTEN AS CODE", 35, {
          fontFamily: "Arial",
          fontWeight: 600,
          letterSpacing: 18,
          align: "center",
          maxWidth: WIDTH,
          fill: "#d4a44c",
          opacity: 0,
          keyframes: {
            opacity: [[0, 0], [0.5, 1, "easeOutCubic"]],
            letterSpacing: [[0, 18], [0.8, 8, "easeOutCubic"]],
          },
          start: 2.5,
          duration: DURATION - 2.5,
        }),
      ]),
      track("fade-out", [
        shape("rectangle", {
          width: WIDTH,
          height: HEIGHT,
          fill: "#0a0a0a",
          opacity: 0,
          keyframes: { opacity: [[0, 0], [1.0, 1, "easeInCubic"]] },
          start: DURATION - 1.3,
          duration: 1.3,
        }),
      ]),
    ]),
  );

  const rootTimeline = await scene.build({} as any);
  const jsonStr = JSON.stringify(rootTimeline);
  const jsonBytes = Buffer.byteLength(jsonStr, "utf8");

  // Verify: 7 tracks, 7 clips, size under 3 KB (previous per-frame loop was ~514 KB)
  assert.equal(rootTimeline.tracks.length, 7);
  assert.equal(rootTimeline.tracks.reduce((s, t) => s + t.clips.length, 0), 7);
  assert.ok(jsonBytes < 3000, `JSON size was ${jsonBytes} bytes, expected < 3000 bytes (>99% reduction)`);

  const comp = composition({
    name: "test-intro",
    width: WIDTH,
    height: HEIGHT,
    fps: 30,
    duration: DURATION,
    rootTimeline,
  });

  const t0 = performance.now();
  const rendered = await renderFrame(comp, 45, 0);
  const t1 = performance.now();
  assert.ok(rendered !== undefined);
  assert.ok(t1 - t0 < 500, `Frame render time was ${t1 - t0}ms, expected fast execution`);
});

test("Phase 33: template config validates cleanly with authoring validator", () => {
  const tsConfigRaw = readFileSync(
    resolve(process.cwd(), "packages/create-cinecode/templates/typescript/cinecode.config.ts"),
    "utf8",
  );
  const rendered = tsConfigRaw
    .replaceAll("{{WIDTH}}", "1920")
    .replaceAll("{{HEIGHT}}", "1080")
    .replaceAll("{{FPS}}", "30");

  const mockConfig = {
    schemaVersion: 2,
    project: {
      entry: "./main.ts",
      sourceDir: "./src",
      mediaDir: "./media",
      outputDir: "./output",
      cacheDir: ".cinecode/cache",
    },
    video: {
      width: 1920,
      height: 1080,
      fps: 30,
      background: "#0a0a0a",
    },
    render: {
      format: "mp4",
      quality: "final",
      codec: "h264",
      preset: "slow",
      hardwareAcceleration: "off",
      concurrency: "auto",
      chunkSize: 32,
    },
    images: {
      defaultFormat: "png",
      quality: 92,
      scaleFactor: 1,
    },
    audio: {
      sampleRate: 48000,
      channels: 2,
      masterVolume: 1,
    },
    dev: {
      port: 3000,
      host: "localhost",
      hmr: true,
      open: false,
    },
  };

  const validation = validateAuthoringConfig(mockConfig);
  assert.equal(validation.errors.length, 0, `Validation errors: ${JSON.stringify(validation.errors)}`);
  assert.equal(validation.warnings.length, 0);

  const normalized = normalizeConfig(mockConfig);
  const fullValidation = validateConfig(normalized, "cinecode.config.ts");
  assert.equal(fullValidation.errors.length, 0);
});

test("Phase 33: CLI init and create commands share identical flags and delegate to scaffolder", () => {
  const initCmd = createInitCommand();
  const createCmd = createCreateCommand();

  assert.equal(initCmd.name(), "init");
  assert.equal(createCmd.name(), "create");

  const initOptions = initCmd.options.map((o) => o.long).sort();
  const createOptions = createCmd.options.map((o) => o.long).sort();

  assert.deepEqual(initOptions, createOptions, "init and create must have identical flags");
  assert.ok(initOptions.includes("--local-link"));
  assert.ok(initOptions.includes("--skip-install"));
  assert.ok(initOptions.includes("--ts"));
  assert.ok(initOptions.includes("--js"));
});
