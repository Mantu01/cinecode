import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginRegistry } from "../registry.js";
import { createWorkerManager } from "../../pipeline/workers.js";
import type { Composition } from "../../core/types/index.js";

function createMockComposition(name: string, width = 16, height = 16): Composition {
  return {
    name,
    width,
    height,
    fps: 30,
    duration: 1 / 30,
    background: "#000000",
    audio: { sampleRate: 48000, channels: 2, masterVolume: 1 },
    rootTimeline: { tracks: [] },
  };
}

describe("Phase 31: Plugin lifecycle and capabilities", () => {
  it("plugin-provided effect renders in worker thread", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cinecode-plugin-worker-"));
    const pluginPath = join(dir, "worker-plugin.mjs");
    const pluginCode = `
      export default {
        manifest: { name: "test-worker-plugin", version: "1.0.0", kind: "effect" },
        effects: [
          {
            name: "workerMagentaFill",
            apply: (input) => {
              input.ctx.fillStyle = "#ff00ff";
              input.ctx.fillRect(0, 0, input.width, input.height);
            },
          },
        ],
      };
    `;
    await writeFile(pluginPath, pluginCode, "utf8");

    const comp: Composition = {
      ...createMockComposition("WorkerPluginComp", 16, 16),
      rootTimeline: {
        tracks: [
          {
            name: "visual",
            kind: "visual",
            clips: [
              {
                type: "solid",
                color: "#000000",
                width: 16,
                height: 16,
                start: 0,
                duration: 1 / 30,
                effects: [{ name: "workerMagentaFill" }],
              },
            ],
          },
        ],
      },
    };

    const manager = createWorkerManager({
      concurrency: 1,
      composition: comp,
      seed: 1,
      cacheDir: join(dir, "cache"),
      plugins: [{ name: "test-worker-plugin", source: pluginPath }],
    });

    try {
      const results = await manager.processChunks([{ startFrame: 0, endFrame: 0, frames: [0] }]);
      assert.equal(results.length, 1);
      assert.equal(results[0]!.frames.length, 1);
      const buf = results[0]!.frames[0]!.buffer;
      // Pixel (0,0): RGBA
      assert.equal(buf[0], 255); // Red
      assert.equal(buf[1], 0);   // Green
      assert.equal(buf[2], 255); // Blue
      assert.equal(buf[3], 255); // Alpha
    } finally {
      await manager.terminate();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("hook stage order matches documented list", async () => {
    const registry = new PluginRegistry();
    const order: string[] = [];

    const expectedStages = [
      "beforeRender",
      "beforeFrame",
      "afterFrame",
      "beforeEncode",
      "afterEncode",
      "beforeMix",
      "afterMix",
      "afterRender",
    ] as const;

    for (const stage of expectedStages) {
      registry.registerHook(stage, () => {
        order.push(stage);
      });
    }

    const mockComp = createMockComposition("Mock");

    await registry.runHook("beforeRender", { composition: mockComp, totalFrames: 1 });
    await registry.runHook("beforeFrame", { composition: mockComp, frame: 0 });
    await registry.runHook("afterFrame", { composition: mockComp, frame: 0 });
    await registry.runHook("beforeEncode", {
      composition: mockComp,
      outputPath: "out.mp4",
      format: "mp4",
      totalFrames: 1,
      encoderArgs: [],
    });
    await registry.runHook("afterEncode", {
      composition: mockComp,
      outputPath: "out.mp4",
      durationMs: 1,
      fileSize: 100,
    });
    await registry.runHook("beforeMix", {
      composition: mockComp,
      trackCount: 1,
      sampleRate: 48000,
      durationSeconds: 1,
    });
    await registry.runHook("afterMix", {
      composition: mockComp,
      trackCount: 1,
      sampleRate: 48000,
      durationSeconds: 1,
      durationMs: 1,
      peakLevel: 0,
    });
    await registry.runHook("afterRender", {
      composition: mockComp,
      outputPath: "out.mp4",
      totalFrames: 1,
      durationMs: 10,
    });

    assert.deepEqual(order, expectedStages);
  });

  it("precedence conflict report when two plugins register same feature", async () => {
    const registry = new PluginRegistry({
      precedence: ["plugin-high", "plugin-low"],
    });

    const effectLow = {
      name: "colorize",
      apply: () => {},
    };
    const effectHigh = {
      name: "colorize",
      apply: () => {},
    };

    registry.register({
      manifest: { name: "plugin-low", version: "1.0.0", kind: "effect" },
      effects: [effectLow],
    });

    registry.register({
      manifest: { name: "plugin-high", version: "1.0.0", kind: "effect" },
      effects: [effectHigh],
    });

    await registry.init();

    const conflicts = registry.getConflicts();
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.winningPlugin, "plugin-high");
    assert.equal(conflicts[0]!.losingPlugin, "plugin-low");
    assert.equal(conflicts[0]!.feature, "colorize");
    assert.equal(conflicts[0]!.reason, "precedence");

    assert.equal(registry.getFeature("colorize"), effectHigh);
    assert.equal(registry.getFeature("plugin-low/colorize"), effectLow);
    assert.equal(registry.getFeature("plugin-high/colorize"), effectHigh);
  });

  it("plugin error in fatal stage fails render with CC8003 and non-fatal degrades", async () => {
    const registry = new PluginRegistry();

    registry.register({
      manifest: { name: "faulty-plugin", version: "1.0.0", kind: "effect" },
      hooks: {
        beforeRender: () => {
          throw new Error("hook failure before render");
        },
        onProgress: () => {
          throw new Error("progress glitch");
        },
      },
    });

    await registry.init();

    const mockComp = createMockComposition("Mock");

    await assert.rejects(
      registry.runHook("beforeRender", { composition: mockComp, totalFrames: 1 }),
      (err: any) => {
        assert.equal(err.code, "CC8003");
        assert.ok(err.message.includes("faulty-plugin"));
        assert.ok(err.message.includes("beforeRender"));
        assert.ok(err.message.includes("hook failure before render"));
        return true;
      },
    );

    const progressResult = await registry.runHook("onProgress", {
      currentFrame: 1,
      totalFrames: 10,
      elapsedMs: 10,
    });
    assert.equal(progressResult.failures.length, 1);
    assert.equal(progressResult.failures[0]!.plugin, "faulty-plugin");
  });
});
