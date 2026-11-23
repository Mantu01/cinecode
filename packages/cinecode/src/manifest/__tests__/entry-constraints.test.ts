import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ErrorCode } from "../../errors/index.js";
import { normalizeConfig } from "../../config/schema.js";
import { validateManifestDocument } from "../validation.js";

const config = normalizeConfig({ schemaVersion: 2, video: { width: 32, height: 32, fps: 1 } });
const defineUrl = new URL("../../core/define/index.js", import.meta.url).href;

function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "cinecode-entry-"));
  mkdirSync(join(root, "src"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content);
  }
  return root;
}

async function validate(root: string, raw: unknown) {
  return validateManifestDocument(raw, {
    rootDir: root,
    manifestPath: join(root, "main.ts"),
    config,
  });
}

test("an image entry with no source is rejected naming the id and accepted source", async () => {
  const result = await validate(project(), { images: [{ id: "thumb" }] });
  const error = result.errors[0]!;
  assert.equal(error.code, ErrorCode.CC1010);
  assert.match(error.message, /images\.0\.file/);
  assert.match(error.message, /image "thumb" declares no source/);
  assert.match(error.message, /"file"/);
});

test("an audio entry with no source is rejected naming both accepted sources", async () => {
  const result = await validate(project(), { audio: [{ id: "bed" }] });
  assert.match(result.errors[0]!.message, /audio "bed" declares no source/);
  assert.match(result.errors[0]!.message, /"src"/);
});

test("an audio entry with both file and src names both keys", async () => {
  const result = await validate(project(), { audio: [{ id: "bed", file: "./a.ts", src: "./a.wav" }] });
  assert.match(result.errors[0]!.message, /audio "bed" declares both "file" and "src"/);
});

test("a timeline with file and sceneRefs is rejected with CC3010", async () => {
  const root = project({ "t.ts": "export default { tracks: [] };\n" });
  const result = await validate(root, {
    timelines: [{ id: "main", file: "./t.ts", sceneRefs: ["intro"] }],
    scenes: [{ id: "intro", file: "./t.ts" }],
  });
  assert.equal(result.errors[0]!.code, ErrorCode.CC3010);
  assert.match(result.errors[0]!.message, /Timeline "main" references scene "intro"/);
});

test("a timeline with no source is rejected", async () => {
  const result = await validate(project(), { timelines: [{ id: "main" }] });
  assert.match(result.errors[0]!.message, /timeline "main" declares no source/);
  assert.match(result.errors[0]!.message, /"sceneRefs"/);
});

test("a scene module exporting a timeline is the documented raw shape", async () => {
  const root = project({
    "scene.ts": "export default { tracks: [{ name: 'a', clips: [] }] };\n",
    "image.ts": "export default { type: 'text', content: 'hi', fontSize: 20 };\n",
  });
  const result = await validate(root, {
    scenes: [{ id: "intro", file: "./scene.ts" }],
    images: [{ id: "poster", file: "./image.ts" }],
  });
  assert.deepEqual(result.errors.map((error) => error.message), []);
});

test("a module exporting the wrong kind reports expected and received", async () => {
  const root = project({ "wrong.ts": "export default { tracks: [{ name: 'a', clips: [] }] };\n" });
  const result = await validate(root, { images: [{ id: "poster", file: "./wrong.ts" }] });
  const error = result.errors.find((candidate) => candidate.code === ErrorCode.CC3008);
  assert.ok(error, result.errors.map((candidate) => candidate.message).join("\n"));
  assert.match(error.message, /does not export an image \(defineImage\)/);
  assert.match(error.message, /received a timeline \(tracks array\)/);
  assert.equal(error.location?.clip, "poster");
  assert.equal(error.location?.file, join(root, "wrong.ts"));
});

test("branded definitions load and unbranded wrong kinds fail by brand", async () => {
  const root = project({
    "scene.ts": `import { defineScene } from "${defineUrl}";\nexport default defineScene("Intro", 1, () => ({ tracks: [] }));\n`,
    "image.ts": `import { defineImage } from "${defineUrl}";\nexport default defineImage(() => ({ type: "solid", color: "#000000" }));\n`,
    "timeline.ts": `import { defineTimeline } from "${defineUrl}";\nexport default defineTimeline(() => ({ tracks: [] }));\n`,
  });
  const ok = await validate(root, {
    images: [{ id: "poster", file: "./image.ts" }],
    scenes: [{ id: "intro", file: "./scene.ts", duration: 1 }],
    timelines: [{ id: "main", file: "./timeline.ts" }],
  });
  assert.deepEqual(ok.errors.map((error) => error.message), []);

  const wrong = await validate(root, { scenes: [{ id: "intro", file: "./image.ts" }] });
  const error = wrong.errors.find((candidate) => candidate.code === ErrorCode.CC3008);
  assert.ok(error);
  assert.match(error.message, /does not export a scene \(defineScene\)/);
  assert.match(error.message, /received an image \(defineImage\)/);
});
