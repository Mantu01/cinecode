import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { COMMANDS, findCommand } from "../cli/command-registry.js";
import { publishOutput, detectContentType } from "../cli/publish.js";
import { createTtsEngine, synthesizeTts } from "../tts/produce.js";
import { getVoiceRegistry } from "../tts/registry.js";
import { getMediaResolverChain } from "../media/resolverChain.js";
import * as PublicApi from "../index.js";
import { validateComposition } from "../core/validation/index.js";
import { collectHealth } from "../cli/health.js";
import { doctorCommand } from "../cli/doctor.js";
import type { Composition } from "../core/types/composition.js";

describe("Phase 32: Local-only shipped surface and scoped loading", () => {
  it("offline verification: health, doctor, and validation succeed without network", async () => {
    // Collect system health offline
    const health = await collectHealth();
    assert.equal(health.node.compatible, true);
    assert.ok(health.node.version.length > 0);
    assert.ok(health.ffmpeg.path.length > 0);

    // Doctor checks run offline
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cinecode-doc-"));
    try {
      const srcDir = path.join(tempDir, "src");
      const mediaDir = path.join(tempDir, "media");
      const outputDir = path.join(tempDir, "output");
      const cacheDir = path.join(tempDir, ".cinecode", "cache");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(mediaDir, { recursive: true });
      fs.mkdirSync(outputDir, { recursive: true });
      fs.mkdirSync(cacheDir, { recursive: true });

      fs.writeFileSync(
        path.join(tempDir, "cinecode.config.ts"),
        `export default {
          sourceDir: "./src",
          mediaDir: "./media",
          outputDir: "./output",
          cacheDir: "./.cinecode/cache",
        };\n`,
      );
      fs.writeFileSync(
        path.join(srcDir, "index.ts"),
        `export default {
          name: "test",
          width: 1920,
          height: 1080,
          fps: 30,
          duration: 30,
          background: "#000000",
          audio: { sampleRate: 48000, channels: 2 },
          rootTimeline: { tracks: [] },
        };\n`,
      );
      fs.writeFileSync(
        path.join(tempDir, "main.ts"),
        `export const manifest = {
          timelines: [{ id: "main-timeline", file: "${path.join(srcDir, "index.ts").replace(/\\/g, "/")}" }],
          scenes: [],
        };
        export default manifest;\n`,
      );
      await doctorCommand({ root: tempDir, json: true });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // Validate valid composition offline
    const composition: Composition = {
      name: "offline-comp",
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 30,
      background: "#000000",
      audio: { sampleRate: 48000, channels: 2 },
      rootTimeline: {
        tracks: [
          {
            name: "Visual Track",
            kind: "visual",
            clips: [
              {
                type: "shape",
                shapeType: "rectangle",
                start: 0,
                duration: 30,
                width: 100,
                height: 100,
                fill: "#ff0000",
              },
            ],
          },
        ],
      },
    };
    const validation = validateComposition(composition);
    assert.equal(validation.valid, true);
    assert.equal(validation.errors.length, 0);
  });

  it("local publish is atomic, respects ignore rules, and detects content type", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cinecode-pub-"));
    try {
      const srcFile = path.join(tempDir, "rendered.mp4");
      fs.writeFileSync(srcFile, Buffer.from([0, 1, 2, 3]));

      // Verify content type detection
      assert.equal(detectContentType("test.mp4"), "video/mp4");
      assert.equal(detectContentType("test.png"), "image/png");
      assert.equal(detectContentType("test.svg"), "image/svg+xml");
      assert.equal(detectContentType("test.json"), "application/json");

      // Publish to destination
      const destDir = path.join(tempDir, "published-dist");
      const result = await publishOutput(srcFile, { dest: destDir });
      assert.equal(result.success, true);
      assert.equal(result.contentType, "video/mp4");
      assert.ok(fs.existsSync(result.target));
      assert.deepEqual(fs.readFileSync(result.target), Buffer.from([0, 1, 2, 3]));

      // Respects .cinecodeignore
      const ignoredFile = path.join(tempDir, "secret.mp4");
      fs.writeFileSync(ignoredFile, Buffer.from([4, 5, 6]));
      const ignoreFile = path.join(tempDir, ".cinecodeignore");
      fs.writeFileSync(ignoreFile, "secret.mp4\n");

      const ignoreResult = await publishOutput(ignoredFile, { dest: destDir });
      assert.equal(ignoreResult.success, false);
      assert.match(ignoreResult.message, /matches \.cinecodeignore/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("local TTS operates offline and remote engines fail with CC5401", async () => {
    // Local system engine creation works
    const systemEngine = createTtsEngine("system");
    assert.ok(systemEngine);
    assert.equal(systemEngine.name, "system");

    // Remote engine creation fails with CC5401
    assert.throws(
      () => createTtsEngine("edge"),
      (err: any) => err.code === "CC5401",
    );
    assert.throws(
      () => createTtsEngine("openai"),
      (err: any) => err.code === "CC5401",
    );

    // Synthesis with remote engine fails with CC5401
    await assert.rejects(
      async () => {
        await synthesizeTts({
          type: "tts",
          start: 0,
          duration: 30,
          engine: "elevenlabs" as any,
          text: "hello",
        });
      },
      (err: any) => err.code === "CC5401",
    );

    // Registry only provides local system voices by default
    const registry = getVoiceRegistry();
    const providers = registry.listProviders();
    assert.deepEqual(providers, ["system"]);
  });

  it("public API entry does not leak CLI commands or dev server into consumers", () => {
    // Assert public API does not export CLI commands or dev server
    assert.equal((PublicApi as any).createStillCommand, undefined);
    assert.equal((PublicApi as any).createRenderCommand, undefined);
    assert.equal((PublicApi as any).DevServer, undefined);
    assert.equal((PublicApi as any).createDevCommand, undefined);
    assert.equal((PublicApi as any).createDoctorCommand, undefined);
  });

  it("network-bound commands and resolvers are excised from default surfaces", () => {
    // Telemetry and probe commands are not in COMMANDS registry
    assert.equal(findCommand("telemetry"), undefined);
    assert.equal(findCommand("probe"), undefined);

    // Media resolver default chain contains only local resolver
    const chain = getMediaResolverChain();
    assert.equal(chain.canResolve("http://example.com/video.mp4"), false);
    assert.equal(chain.canResolve("https://example.com/video.mp4"), false);
    assert.equal(chain.canResolve("s3://bucket/video.mp4"), false);
    assert.equal(chain.canResolve("file:///local/path/video.mp4"), true);
  });
});
