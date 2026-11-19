import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMANDS } from "../cli/command-registry.js";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { validateAuthoringConfig } from "../config/validator.js";
import { normalizeConfig } from "../config/schema.js";
import { defineMain, defineScene, shape, text, timeline, track, composition } from "../core/index.js";
import { renderFrame } from "../renderer/engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const docsDir = resolve(repoRoot, "docs");

test("Phase 34: all documentation links resolve to existing files with zero broken links", () => {
  const mdFiles = [
    resolve(repoRoot, "README.md"),
    ...readdirSync(docsDir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => resolve(docsDir, file)),
  ];

  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

  for (const filePath of mdFiles) {
    const content = readFileSync(filePath, "utf8");
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(content)) !== null) {
      const href = match[2]!;
      // Ignore anchor-only links or schema URLs
      if (href.startsWith("#") || href.startsWith("http://json-schema.org") || href.startsWith("https://cinecode.dev")) {
        continue;
      }
      // Assert no placeholder domains
      assert.ok(!href.includes("example.com"), `Link "${href}" in ${filePath} contains placeholder domain`);

      if (href.startsWith("http://") || href.startsWith("https://")) {
        continue;
      }

      // Relative path resolution
      const targetPath = resolve(dirname(filePath), href.split("#")[0]!);
      assert.ok(
        existsSync(targetPath),
        `Broken relative link in ${filePath}: "${href}" does not exist at ${targetPath}`,
      );
    }
  }
});

test("Phase 34: runnable documentation examples compile, validate, and execute", async () => {
  // Example 1: Config example from README.md
  const readmeConfig = {
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
      concurrency: "auto",
    },
    audio: {
      sampleRate: 48000,
      channels: 2,
    },
  };

  const configValidation = validateAuthoringConfig(readmeConfig);
  assert.equal(configValidation.errors.length, 0, "README config example must validate without errors");
  const normalized = normalizeConfig(readmeConfig);
  assert.equal(normalized.video.width, 1920);

  // Example 2: Manifest example from README.md
  const readmeManifest = defineMain({
    images: [{ id: "thumbnail", file: "./src/images/thumbnail.ts", format: "png" }],
    audio: [{ id: "ambient", file: "./src/audio/ambient.ts", kind: "music", duration: 6 }],
    scenes: [{ id: "intro", file: "./src/scenes/intro.ts", duration: 6 }],
    timelines: [{ id: "main", duration: 6, sceneRefs: ["intro"], audioRef: ["ambient"] }],
  });
  assert.equal(readmeManifest.scenes?.length, 1);
  assert.equal(readmeManifest.timelines?.length, 1);

  // Example 3: Scene example from README.md
  const scene = defineScene("intro", 6, () =>
    timeline([
      track("background", [
        shape("rectangle", {
          width: 1920,
          height: 1080,
          fill: "#0a0a0a",
          opacity: 0,
          keyframes: { opacity: [[0, 0], [0.8, 1, "easeOutCubic"]] },
          start: 0,
          duration: 6,
        }),
      ]),
      track("title", [
        text("CINECODE", 96, {
          fill: "#f5f0e8",
          opacity: 0,
          transform: { x: 480, y: 440 },
          keyframes: {
            opacity: [[0, 0], [0.5, 1, "easeOutCubic"]],
            "transform.y": [[0, 480], [0.8, 440, "easeOutExpo"]],
          },
          start: 0.5,
          duration: 5.5,
        }),
      ]),
    ]),
  );

  const rootTimeline = await scene.build({} as any);
  assert.equal(rootTimeline.tracks.length, 2);

  const comp = composition({
    name: "doc-example",
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 6,
    rootTimeline,
  });

  const frameResult = await renderFrame(comp, 15, 0);
  assert.ok(frameResult !== undefined, "README scene example must render frame successfully");
});

test("Phase 34: command reference is complete and covers all commands and exit codes", () => {
  const cmdRefPath = resolve(docsDir, "command-reference.md");
  assert.ok(existsSync(cmdRefPath), "docs/command-reference.md must exist");
  const content = readFileSync(cmdRefPath, "utf8");

  for (const cmd of COMMANDS) {
    assert.ok(content.includes(`\`cinecode ${cmd.name}\``), `command reference must document "${cmd.name}"`);
  }

  for (const [name, code] of Object.entries(EXIT_CODES)) {
    assert.ok(content.includes(`\`${code}\``), `command reference must document exit code ${code} (${name})`);
  }
});

test("Phase 34: support matrix documents environments, alpha formats, and excluded surfaces", () => {
  const matrixPath = resolve(docsDir, "support-matrix.md");
  assert.ok(existsSync(matrixPath), "docs/support-matrix.md must exist");
  const content = readFileSync(matrixPath, "utf8");

  assert.ok(content.includes("Node.js"), "must document Node.js requirement");
  assert.ok(content.includes(">=22.18.0"), "must state minimum Node version >=22.18.0");
  assert.ok(content.includes("webm-alpha"), "must document webm-alpha");
  assert.ok(content.includes("prores-alpha"), "must document prores-alpha");
  assert.ok(content.includes("Explicitly Not Supported"), "must have Explicitly Not Supported section");
  assert.ok(content.includes("Cloud Publishing"), "must document removal of cloud publishing");
  assert.ok(content.includes("Remote Plugin Marketplace"), "must document removal of remote marketplace");
  assert.ok(content.includes("Remote Cloud Speech"), "must document removal of remote speech");
});

test("Phase 34: architecture documentation covers project contract, precedence, and determinism", () => {
  const archPath = resolve(docsDir, "architecture.md");
  assert.ok(existsSync(archPath), "docs/architecture.md must exist");
  const content = readFileSync(archPath, "utf8");

  assert.ok(content.includes("sourceDir"), "must document sourceDir");
  assert.ok(content.includes("mediaDir"), "must document mediaDir");
  assert.ok(content.includes("outputDir"), "must document outputDir");
  assert.ok(content.includes("cacheDir"), "must document cacheDir");
  assert.ok(content.includes("Precedence Order"), "must document precedence order");
  assert.ok(content.includes("Determinism Guarantees"), "must document determinism guarantees");
  assert.ok(content.includes("Zero-Copy Frame Transport"), "must document zero-copy frame transport");
});

test("Phase 34: changelog is truthful and free of removed network features in Added section", () => {
  const changelogPath = resolve(repoRoot, "packages/cinecode/CHANGELOG.md");
  assert.ok(existsSync(changelogPath), "packages/cinecode/CHANGELOG.md must exist");
  const content = readFileSync(changelogPath, "utf8");

  const [addedSection = "", removedSection = ""] = content.split("### Removed");

  assert.ok(!addedSection.includes("Prometheus metrics server"), "Added section must not claim Prometheus metrics server");
  assert.ok(!addedSection.includes("Marketplace client"), "Added section must not claim Marketplace client");
  assert.ok(!addedSection.includes("publish to local/S3/GCS"), "Added section must not claim S3/GCS publish");
  assert.ok(removedSection.includes("Network Telemetry"), "Removed section must list telemetry removal");
  assert.ok(removedSection.includes("Remote Marketplace Client"), "Removed section must list marketplace removal");
  assert.ok(removedSection.includes("Cloud Publishing"), "Removed section must list cloud publishing removal");
});
