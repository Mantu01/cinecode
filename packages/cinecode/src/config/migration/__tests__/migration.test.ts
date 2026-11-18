import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ErrorCode, isCinecodeError } from "../../../errors/index.js";
import { validateAuthoringConfig } from "../../validator.js";
import { SCHEMA_VERSION } from "../../zod-schema.js";
import { ConfigMigrationEngine, formatDiffSummary } from "../engine.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cinecode-migration-test-"));
}

test("v1 JSON fixture migrates and validates against current schema", () => {
  const dir = createTempDir();
  const filePath = path.join(dir, "cinecode.config.json");
  const v1Content = JSON.stringify(
    {
      schemaVersion: 1,
      fps: 30,
      width: 1920,
      height: 1080,
      duration: 15,
      background: "#000000",
      entry: "src/main.ts",
      render: {
        format: "mp4",
        quality: "high",
        background: "#000000",
      },
    },
    null,
    2,
  );
  fs.writeFileSync(filePath, v1Content, "utf8");

  const engine = new ConfigMigrationEngine();
  const result = engine.migrate(filePath, { backup: true });

  assert.equal(result.originalVersion, 1);
  assert.equal(result.targetVersion, SCHEMA_VERSION);
  assert.equal(result.modified, true);
  assert.ok(result.appliedSteps.length > 0);
  assert.ok(result.diff.length > 0);
  assert.ok(result.backupPath.endsWith(".bak"));
  assert.equal(fs.readFileSync(result.backupPath, "utf8"), v1Content);

  const migratedContent = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(migratedContent);
  assert.equal(parsed.schemaVersion, SCHEMA_VERSION);
  assert.equal(parsed.video?.fps, 30);
  assert.equal(parsed.video?.width, 1920);
  assert.equal(parsed.video?.height, 1080);
  assert.equal(parsed.video?.defaultDuration, 15);
  assert.equal(parsed.video?.background, "#000000");
  assert.equal(parsed.project?.entry, "src/main.ts");
  assert.equal(parsed.render?.quality, "final");
  assert.equal(parsed.fps, undefined);
  assert.equal(parsed.width, undefined);
  assert.equal(parsed.height, undefined);

  const { errors } = validateAuthoringConfig(parsed, filePath);
  assert.equal(errors.length, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("v1 TypeScript fixture migrates and validates cleanly", () => {
  const dir = createTempDir();
  const filePath = path.join(dir, "cinecode.config.ts");
  const v1Content = `/// <reference types="cinecode" />
import { defineConfig } from "cinecode";

export default defineConfig({
  schemaVersion: 1,
  fps: 60,
  width: 1280,
  height: 720,
  render: {
    format: "mp4",
    quality: "high"
  }
});
`;
  fs.writeFileSync(filePath, v1Content, "utf8");

  const engine = new ConfigMigrationEngine();
  const result = engine.migrate(filePath);

  assert.equal(result.originalVersion, 1);
  assert.equal(result.targetVersion, SCHEMA_VERSION);
  assert.equal(result.modified, true);
  assert.equal(result.backupPath, ""); // No backup when backup option is false

  const migratedContent = fs.readFileSync(filePath, "utf8");
  assert.ok(migratedContent.includes(`"schemaVersion": ${SCHEMA_VERSION}`));
  assert.ok(migratedContent.includes(`"fps": 60`));
  assert.ok(migratedContent.includes(`"quality": "final"`));
  assert.ok(!migratedContent.includes(`"quality": "high"`));

  const diffSummary = formatDiffSummary(result.diff);
  assert.ok(diffSummary.includes("fps"));
  assert.ok(diffSummary.includes("final"));

  fs.rmSync(dir, { recursive: true, force: true });
});

test("current v2 fixture is a no-op (file byte-identical, no steps, writes nothing)", () => {
  const dir = createTempDir();
  const filePath = path.join(dir, "cinecode.config.ts");
  const v2Content = `import { defineConfig } from "cinecode";

export default defineConfig({
  schemaVersion: 2,
  video: {
    width: 1920,
    height: 1080,
    fps: 30
  }
});
`;
  fs.writeFileSync(filePath, v2Content, "utf8");
  const originalBytes = fs.readFileSync(filePath);

  const engine = new ConfigMigrationEngine();
  const result = engine.migrate(filePath);

  assert.equal(result.originalVersion, 2);
  assert.equal(result.targetVersion, 2);
  assert.equal(result.modified, false);
  assert.equal(result.appliedSteps.length, 0);
  assert.equal(result.diff.length, 0);
  assert.equal(result.backupPath, "");
  assert.deepEqual(fs.readFileSync(filePath), originalBytes);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("config using imported constants or custom imports is refused with CC1006, file byte-identical", () => {
  const dir = createTempDir();
  const filePath = path.join(dir, "cinecode.config.ts");
  const customImportContent = `import { fps } from "./constants";
import { defineConfig } from "cinecode";

export default defineConfig({
  schemaVersion: 1,
  fps: fps
});
`;
  fs.writeFileSync(filePath, customImportContent, "utf8");
  const originalBytes = fs.readFileSync(filePath);

  const engine = new ConfigMigrationEngine();
  try {
    engine.migrate(filePath);
    assert.fail("Expected migration to throw");
  } catch (err: any) {
    assert.ok(isCinecodeError(err));
    assert.equal(err.code, ErrorCode.CC1006);
    assert.ok(err.message.includes("Custom import"));
  }

  assert.deepEqual(fs.readFileSync(filePath), originalBytes);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("config with comments inside object literal is refused with CC1006, file byte-identical", () => {
  const dir = createTempDir();
  const filePath = path.join(dir, "cinecode.config.ts");
  const commentContent = `import { defineConfig } from "cinecode";

export default defineConfig({
  // Legacy fps setting
  schemaVersion: 1,
  fps: 30
});
`;
  fs.writeFileSync(filePath, commentContent, "utf8");
  const originalBytes = fs.readFileSync(filePath);

  const engine = new ConfigMigrationEngine();
  try {
    engine.migrate(filePath);
    assert.fail("Expected migration to throw");
  } catch (err: any) {
    assert.ok(isCinecodeError(err));
    assert.equal(err.code, ErrorCode.CC1006);
    assert.ok(err.message.includes("comments that cannot be preserved"));
  }

  assert.deepEqual(fs.readFileSync(filePath), originalBytes);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("future schema version is refused with CC1004, file byte-identical", () => {
  const dir = createTempDir();
  const filePath = path.join(dir, "cinecode.config.json");
  const futureContent = JSON.stringify({ schemaVersion: 99, fps: 30 }, null, 2);
  fs.writeFileSync(filePath, futureContent, "utf8");
  const originalBytes = fs.readFileSync(filePath);

  const engine = new ConfigMigrationEngine();
  try {
    engine.migrate(filePath);
    assert.fail("Expected migration to throw");
  } catch (err: any) {
    assert.ok(isCinecodeError(err));
    assert.equal(err.code, ErrorCode.CC1004);
    assert.ok(err.message.includes("99"));
  }

  assert.deepEqual(fs.readFileSync(filePath), originalBytes);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("broken syntax config is refused with CC1006, file byte-identical", () => {
  const dir = createTempDir();
  const filePath = path.join(dir, "cinecode.config.ts");
  const brokenContent = `import { defineConfig } from "cinecode";

export default defineConfig({
  fps:
});
`;
  fs.writeFileSync(filePath, brokenContent, "utf8");
  const originalBytes = fs.readFileSync(filePath);

  const engine = new ConfigMigrationEngine();
  try {
    engine.migrate(filePath);
    assert.fail("Expected migration to throw");
  } catch (err: any) {
    assert.ok(isCinecodeError(err));
    assert.equal(err.code, ErrorCode.CC1006);
  }

  assert.deepEqual(fs.readFileSync(filePath), originalBytes);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("transform/validation failure leaves file byte-identical", () => {
  const dir = createTempDir();
  const filePath = path.join(dir, "cinecode.config.json");
  // Negative fps will fail AuthoringConfig validation after transform
  const invalidContent = JSON.stringify({ schemaVersion: 1, fps: -30, width: 1920, height: 1080 }, null, 2);
  fs.writeFileSync(filePath, invalidContent, "utf8");
  const originalBytes = fs.readFileSync(filePath);

  const engine = new ConfigMigrationEngine();
  try {
    engine.migrate(filePath);
    assert.fail("Expected migration to throw validation error");
  } catch (err: any) {
    assert.ok(isCinecodeError(err));
  }

  assert.deepEqual(fs.readFileSync(filePath), originalBytes);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("dry-run produces transformed preview without writing files", () => {
  const dir = createTempDir();
  const filePath = path.join(dir, "cinecode.config.json");
  const v1Content = JSON.stringify({ schemaVersion: 1, fps: 24, width: 1920, height: 1080 }, null, 2);
  fs.writeFileSync(filePath, v1Content, "utf8");
  const originalBytes = fs.readFileSync(filePath);

  const engine = new ConfigMigrationEngine();
  const result = engine.migrate(filePath, { dryRun: true });

  assert.equal(result.modified, true);
  assert.equal(result.targetVersion, SCHEMA_VERSION);
  assert.ok(result.newContent.includes(`"schemaVersion": ${SCHEMA_VERSION}`));
  assert.deepEqual(fs.readFileSync(filePath), originalBytes);

  fs.rmSync(dir, { recursive: true, force: true });
});
