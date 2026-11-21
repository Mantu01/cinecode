import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ErrorCode } from "../../errors/index.js";
import { normalizeConfig } from "../../config/schema.js";
import { assertIdPathInside, idRule, validateManifestIds } from "../ids.js";
import { findEntry } from "../index.js";
import { validateManifestDocument } from "../validation.js";
import { generateCommand } from "../../cli/generate.js";
import { runReport } from "../../cli/run-report.js";

const config = normalizeConfig({ schemaVersion: 2, video: { width: 32, height: 32, fps: 1 } });

function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "cinecode-ids-"));
  writeFileSync(
    join(root, "cinecode.config.json"),
    JSON.stringify({ schemaVersion: 2, project: { entry: "./main.ts" }, video: { width: 32, height: 32, fps: 1 } }),
  );
  mkdirSync(join(root, "src"), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
  return root;
}

test("hostile ids fail with the violated rule named", () => {
  const cases: Array<[string, RegExp]> = [
    ["../evil", /path separator/],
    ["a/b", /path separator/],
    ["a\\b", /path separator/],
    ["/abs", /absolute path|path separator/],
    ["C:evil", /drive letter/],
    ["..", /parent-traversal/],
    ["CON", /reserved Windows device name/],
    ["aux.png", /reserved Windows device name/],
    ["a\u0001b", /control character/],
    ["name.", /ends with a dot or space/],
    ["name ", /ends with a dot or space/],
    ["a<b", /illegal on Windows/],
    ["", /empty/],
  ];
  for (const [id, expected] of cases) {
    const rule = idRule(id);
    assert.ok(rule, `rejects ${JSON.stringify(id)}`);
    assert.match(rule, expected, id);
  }
  assert.equal(idRule("café-01"), null);
  assert.equal(idRule("intro-2"), null);
});

test("ids reach the manifest error with entry kind, id and rule", async () => {
  const root = project();
  const result = await validateManifestDocument(
    { images: [{ id: "../escape", file: "./img.ts" }], scenes: [{ id: "CON", file: "./s.ts" }] },
    { rootDir: root, manifestPath: join(root, "main.ts"), config },
  );
  const messages = result.errors.map((error) => error.message).join("\n");
  assert.match(messages, /images "\.\.\/escape" is not a filesystem-safe id: it contains a path separator/);
  assert.match(messages, /scenes "CON" is not a filesystem-safe id: it is the reserved Windows device name "CON"/);
  const idErrors = result.errors.filter((error) => /filesystem-safe/.test(error.message));
  assert.equal(idErrors.length, 2);
  assert.ok(idErrors.every((error) => error.code === ErrorCode.CC1010));
});

test("case-only duplicates are rejected across collections", async () => {
  const root = project({ "s.ts": "export default { tracks: [] };\n" });
  const result = await validateManifestDocument(
    { scenes: [{ id: "Intro", file: "./s.ts" }], timelines: [{ id: "intro", sceneRefs: ["Intro"] }] },
    { rootDir: root, manifestPath: join(root, "main.ts"), config },
  );
  const duplicate = result.errors.find((error) => /duplicate id/.test(error.message));
  assert.ok(duplicate, result.errors.map((error) => error.message).join("\n"));
  assert.match(duplicate.message, /case-insensitively/);
  assert.equal(duplicate.code, ErrorCode.CC1010);
});

test("command-line selector ids are validated with the same rule", () => {
  assert.throws(
    () => findEntry([{ id: "ok" }], "../escape", "scene"),
    (error: any) => {
      assert.equal(error.code, ErrorCode.CC1012);
      assert.match(error.message, /Invalid scene id "\.\.\/escape"/);
      assert.match(error.message, /path separator/);
      return true;
    },
  );
});

test("the containment assertion never fires for a valid id and refuses an escape", () => {
  const root = join(tmpdir(), "cinecode-output");
  assert.doesNotThrow(() => assertIdPathInside(root, join(root, "café-01.png"), "café-01"));
  assert.throws(
    () => assertIdPathInside(root, join(root, "..", "outside.png"), "../outside"),
    (error: any) => error.code === ErrorCode.CC1003 && /outside the output root/.test(error.message),
  );
});

test("a unicode id produces the expected file name", async () => {
  const root = project({
    "main.ts": "export default { images: [{ id: \"café-01\", file: \"./image.ts\" }] };\n",
    "image.ts": "export default { type: 'solid', color: '#000000' };\n",
  });
  runReport.start("generate", true);
  await generateCommand("image", { root, all: true, dryRun: true });
  const generated = (runReport.finish().result as any).generated as Array<{ path: string }>;
  assert.equal(generated[0]!.path, join(root, "output", "images", "café-01.png"));
});

test("validateManifestIds reports every offender in one pass", () => {
  const errors = validateManifestIds([
    { kind: "image", entries: [{ id: "ok" }, { id: "a/b" }] },
    { kind: "audio", entries: [{ id: "NUL" }] },
  ]);
  assert.equal(errors.length, 2);
  assert.ok(errors.every((error) => error.code === ErrorCode.CC1003));
});
