import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderFrame } from "../engine.js";
import type { Composition, VisualClip } from "../../core/types/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "../../..");

test("wgpu-matrix dependency and GPU backend directories are completely removed", () => {
  const pkgJsonPath = resolve(pkgRoot, "package.json");
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  assert.equal(
    pkg.dependencies?.["wgpu-matrix"],
    undefined,
    "wgpu-matrix must not be present in dependencies",
  );

  const backendDir = resolve(pkgRoot, "src/renderer/backend");
  assert.equal(existsSync(backendDir), false, "src/renderer/backend must not exist");

  const gpuComputeDir = resolve(pkgRoot, "src/renderer/effects/gpu-compute");
  assert.equal(existsSync(gpuComputeDir), false, "src/renderer/effects/gpu-compute must not exist");
});

test("CPU rendering is fully operational and deterministic", async () => {
  const comp: Composition = {
    name: "cpu-backend-verify",
    width: 64,
    height: 64,
    fps: 30,
    background: "#123456",
    audio: { sampleRate: 48000, channels: 2, masterVolume: 1 },
    rootTimeline: {
      tracks: [
        {
          name: "main",
          kind: "visual",
          clips: [
            {
              type: "solid",
              name: "block",
              color: "#abcdef",
              start: 0,
              duration: 1,
            } as VisualClip,
          ],
        },
      ],
    },
  };

  const result1 = await renderFrame(comp, 0, 0);
  const result2 = await renderFrame(comp, 0, 0);

  const buf1 = result1.canvas.toBuffer("image/png");
  const buf2 = result2.canvas.toBuffer("image/png");

  assert.ok(buf1.length > 0, "rendered frame must produce valid buffer");
  assert.deepEqual(buf1, buf2, "CPU renderer output must be 100% deterministic");
});
