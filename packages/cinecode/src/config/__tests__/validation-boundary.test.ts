import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ErrorCode } from "../../errors/index.js";
import { configValidationCounts } from "../validator.js";
import { explicitPathsOf, loadConfig, loadConfigDocument, normalizeConfig } from "../schema.js";
import { resolveRenderParameters } from "../../cli/precedence.js";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "cinecode-boundary-"));
}

let validationModule: string | undefined;

async function defineConfigUrl(): Promise<string> {
  validationModule ??= new URL("../../core/define/index.js", import.meta.url).href;
  return validationModule;
}

async function tsConfig(authored: string): Promise<string> {
  const root = dir();
  const file = join(root, "cinecode.config.ts");
  writeFileSync(file, `import { defineConfig } from "${await defineConfigUrl()}";\n\nexport default defineConfig(${authored});\n`);
  return file;
}

test("a plain config document validates exactly once per load", async () => {
  const root = dir();
  const file = join(root, "cinecode.config.json");
  writeFileSync(file, JSON.stringify({ schemaVersion: 2, project: { entry: "./main.ts" } }));
  const before = configValidationCounts();
  await loadConfig(file);
  const after = configValidationCounts();
  assert.equal(after.authoring - before.authoring, 1);
  assert.equal(after.normalized - before.normalized, 1);
});

test("an authored defineConfig validates once at definition and is not revalidated", async () => {
  const file = await tsConfig('{ schemaVersion: 2, project: { entry: "./main.ts" } }');
  const before = configValidationCounts();
  await loadConfig(file);
  assert.equal(configValidationCounts().authoring - before.authoring, 1);
});

test("a malformed authored config fails at import with one coded error naming file and key", async () => {
  const file = await tsConfig('{ schemaVersion: 2, bogusKey: true }');
  await assert.rejects(loadConfig(file), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1002);
    assert.match(error.message, /bogusKey/);
    assert.equal(error.location.file, file);
    return true;
  });
});

test("validation runs on every config load", async () => {
  const before = configValidationCounts();
  const file = await tsConfig('{ schemaVersion: 2, project: { entry: "./main.ts" } }');
  await loadConfig(file);
  assert.equal(configValidationCounts().authoring - before.authoring, 1);
});

function precedenceFor(config: ReturnType<typeof normalizeConfig>, explicit: ReadonlySet<string>) {
  const { parameters } = resolveRenderParameters({
    selection: { name: "clip", width: 640, height: 360, fps: 24 },
    project: { root: "/test", config, mode: "file", selection: "clip" },
    explicit,
  });
  return { width: parameters.width, bitrate: parameters.bitrate, format: parameters.format };
}

test("precedence survives spread, freeze and a JSON round-trip of the config", async () => {
  const root = dir();
  const file = join(root, "cinecode.config.json");
  writeFileSync(
    file,
    JSON.stringify({ schemaVersion: 2, render: { format: "webm", bitrate: 900, resolution: "1280x720" } }),
  );
  const { config, explicit } = await loadConfigDocument(file);

  assert.deepEqual(
    explicitPathsOf({ schemaVersion: 2, render: { format: "webm", bitrate: 900, resolution: "1280x720" } }),
    explicit,
  );

  const baseline = precedenceFor(config, explicit);
  assert.equal(baseline.format.origin, "config");
  assert.equal(baseline.bitrate.value, "900");
  assert.equal(baseline.width.value, 640, "selection outranks a non-explicit config size");

  for (const variant of [
    { ...config },
    Object.freeze({ ...config }),
    JSON.parse(JSON.stringify(config)),
  ]) {
    assert.deepEqual(precedenceFor(variant, explicit), baseline);
  }
});

test("explicit keys reflect the merged document after inheritance and env substitution", async () => {
  const root = dir();
  writeFileSync(
    join(root, "base.json"),
    JSON.stringify({ schemaVersion: 2, render: { bitrate: 1500 } }),
  );
  const file = join(root, "cinecode.config.json");
  writeFileSync(
    file,
    JSON.stringify({
      extends: "./base.json",
      schemaVersion: 2,
      render: { format: "webm", crf: 20, quality: "${CINECODE_TEST_QUALITY}" },
    }),
  );
  process.env.CINECODE_TEST_QUALITY = "preview";
  try {
    const { config, explicit } = await loadConfigDocument(file);
    assert.equal(config.render.bitrate, 1500);
    assert.equal(config.render.quality, "preview");
    assert.ok(explicit.has("render.bitrate"), "inherited key is explicit");
    assert.ok(explicit.has("render.format"));
    assert.ok(explicit.has("render.crf"));
    assert.ok(explicit.has("render.quality"));
  } finally {
    delete process.env.CINECODE_TEST_QUALITY;
  }
});
