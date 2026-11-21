import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ErrorCode } from "../../errors/index.js";
import { normalizeConfig } from "../../config/schema.js";
import {
  assembleTimelineComposition,
  loadManifestProject,
  validateManifestDocument,
} from "../index.js";
import { manifestShapeValidationCount } from "../contract.js";

const CONFIG = {
  schemaVersion: 2,
  project: { entry: "./main.ts" },
  video: { width: 32, height: 32, fps: 1 },
};

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "cinecode-main-contract-"));
  writeFileSync(join(root, "cinecode.config.json"), JSON.stringify(CONFIG));
  mkdirSync(join(root, "src"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

const config = normalizeConfig(CONFIG);
const defineUrl = new URL("../../core/define/index.js", import.meta.url).href;

function mainWith(manifest: string, extra: readonly string[] = []): string {
  return [`import { defineMain } from "${defineUrl}";`, ...extra, `export default defineMain(${manifest});`, ""].join("\n");
}

async function load(root: string) {
  return loadManifestProject(config, root);
}

test("defineMain rejects a malformed definition at import with collection, entry and key", async () => {
  const root = project({
    "main.ts": mainWith('{ scenes: [{ name: "no id" }] }'),
  });
  await assert.rejects(load(root), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1010);
    assert.match(error.message, /scenes\.0\.id/);
    assert.equal(error.location.file, join(root, "main.ts"));
    return true;
  });
});

test("a composition export is a contract error naming the received shape", async () => {
  const root = project({
    "main.ts": 'export default { name: "hero", width: 32, height: 32, fps: 1, duration: 1, rootTimeline: { tracks: [] } };\n',
  });
  await assert.rejects(load(root), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1010);
    assert.match(error.message, /defineMain/);
    assert.match(error.message, /a composition \(rootTimeline\)/);
    assert.doesNotMatch(error.message, /registers no timelines/);
    assert.match(error.fixHint, /defineMain/);
    return true;
  });
});

test("a bare timeline, function, array, primitive and empty object are rejected distinctly", async () => {
  const shapes: Array<[string, RegExp]> = [
    ["{ tracks: [] }", /a timeline \(tracks array\)/],
    ["() => ({ tracks: [] })", /a function/],
    ["[{ id: \"x\" }]", /an array of 1 item/],
    ["42", /a primitive \(number\)/],
    ["{}", /an empty object/],
  ];
  for (const [source, expected] of shapes) {
    const root = project({ "main.ts": `export default ${source};\n` });
    await assert.rejects(load(root), (error: any) => {
      assert.equal(error.code, ErrorCode.CC1010, source);
      assert.match(error.message, expected, source);
      return true;
    });
  }
});

test("a valid definition validates once at import and loads without revalidating", async () => {
  const root = project({
    "main.ts": mainWith('{ scenes: [{ id: "intro", file: "./scene.ts", duration: 1 }] }'),
    "scene.ts": "export default { tracks: [] };\n",
  });
  const before = manifestShapeValidationCount();
  const first = await load(root);
  const afterFirst = manifestShapeValidationCount();
  assert.equal(afterFirst - before, 1, "one validation at definition time");
  const second = await load(root);
  assert.equal(manifestShapeValidationCount(), afterFirst, "cached module is not revalidated");
  assert.equal(first.manifest.scenes?.[0]?.id, "intro");
  assert.equal(second.manifest.scenes?.[0]?.id, "intro");
});

test("the documented raw shape still loads", async () => {
  const root = project({
    "main.ts": 'export default { timelines: [{ id: "main", sceneRefs: ["intro"] }], scenes: [{ id: "intro", file: "./scene.ts", duration: 1 }] };\n',
    "scene.ts": 'export default { tracks: [] };\n',
  });
  const loaded = await load(root);
  assert.equal(loaded.manifest.timelines?.[0]?.id, "main");
});

test("non-serialisable entry props are reported with their path", async () => {
  const root = project({ "scene.ts": 'export default { tracks: [] };\n' });
  const raw = {
    scenes: [{ id: "intro", file: "./scene.ts", budget: () => 1 }],
  };
  const result = await validateManifestDocument(raw, {
    rootDir: root,
    manifestPath: join(root, "main.ts"),
    config,
  });
  const issue = result.errors.find((error) => /not JSON-serializable/.test(error.message));
  assert.ok(issue, result.errors.map((error) => error.message).join("\n"));
  assert.match(issue.message, /scenes\[0\]\.budget/);
});

test("a non-deterministic authored module fails the load before any render", async () => {
  const root = project({
    "main.ts": mainWith(
      '{ scenes: [{ id: "intro", file: "./scene.ts", duration: 1 }] }',
      ["const seed = Date.now();", "void seed;"],
    ),
    "scene.ts": 'export default { tracks: [] };\n',
  });
  await assert.rejects(load(root), (error: any) => {
    assert.equal(error.code, ErrorCode.CC3005);
    assert.match(error.message, /Date\.now/);
    assert.equal(error.location.file, join(root, "main.ts"));
    assert.equal(error.location.line, 2);
    return true;
  });
});

test("a non-deterministic entry module is caught by name", async () => {
  const root = project({
    "main.ts": mainWith('{ scenes: [{ id: "intro", file: "./scene.ts", duration: 1 }] }'),
    "scene.ts": "const jitter = Math.random();\nvoid jitter;\nexport default { tracks: [] };\n",
  });
  await assert.rejects(load(root), (error: any) => {
    assert.equal(error.code, ErrorCode.CC3005);
    assert.match(error.message, /scene\.ts/);
    assert.match(error.message, /Math\.random/);
    return true;
  });
});

test("the manifest module is cached between validation and assembly", async () => {
  const root = project({
    "main.ts": mainWith(
      '{ timelines: [{ id: "main", sceneRefs: ["intro"] }], scenes: [{ id: "intro", file: "./scene.ts", duration: 1 }] }',
    ),
    "scene.ts": 'export default { tracks: [] };\n',
  });
  const moduleCache = new Map<string, unknown>();
  const loaded = await load(root);
  const validation = await validateManifestDocument(loaded.rawManifest, {
    rootDir: root,
    manifestPath: loaded.entryPath,
    config,
    moduleCache,
  });
  assert.equal(validation.valid, true, validation.errors.map((error) => error.message).join("\n"));
  assert.ok(moduleCache.size > 0, "validation cached the entry module");
  const composition = await assembleTimelineComposition({ ...loaded, moduleCache }, "main");
  assert.equal(composition.name, "main");
  assert.ok(typeof composition.duration === "number" && composition.duration > 0);
});
