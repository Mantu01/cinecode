import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createProjectResolver, describeResolution } from "../project-resolver.js";
import { ErrorCode } from "../../errors/index.js";

const TIMELINE = "export default { tracks: [] };\n";

function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "cinecode-resolver-"));
  writeFileSync(
    join(root, "cinecode.config.json"),
    JSON.stringify({
      schemaVersion: 2,
      project: { sourceDir: "./src", outputDir: "./out", cacheDir: "./.ccache" },
      video: { width: 320, height: 180, fps: 24, background: "#000000" },
    }),
  );
  mkdirSync(join(root, "src"), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
  return root;
}

test("a missing manifest is fatal, coded and names the entry path", async () => {
  const root = project();
  await assert.rejects(createProjectResolver({ root }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1009);
    assert.equal(error.location.file, join(root, "main.ts"));
    assert.match(error.fixHint, /--file/);
    return true;
  });
});

test("an empty manifest is rejected instead of defaulting to the config file", async () => {
  const root = project({ "main.ts": "export default {};\n" });
  await assert.rejects(createProjectResolver({ root }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1010);
    assert.equal(error.location.file, join(root, "main.ts"));
    assert.match(error.message, /registers no timelines/);
    return true;
  });
});

test("a syntax-broken manifest is a located manifest error", async () => {
  const root = project({ "main.ts": "export default {\n" });
  await assert.rejects(createProjectResolver({ root }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1010);
    assert.equal(error.location.file, join(root, "main.ts"));
    return true;
  });
});

test("a config object is never accepted as a composition", async () => {
  const root = project();
  await assert.rejects(
    createProjectResolver({ cwd: root, file: join(root, "cinecode.config.json") }).resolve(),
    (error: any) => {
      assert.equal(error.code, ErrorCode.CC3008);
      assert.match(error.fixHint, /config file is not a composition/);
      return true;
    },
  );
});

test("mode and flag mismatches are errors, not silent switches", async () => {
  const root = project({ "main.ts": "export default { timelines: [{ id: 't1', file: './timeline.ts' }] };\n", "timeline.ts": TIMELINE });
  await assert.rejects(
    createProjectResolver({ root, file: join(root, "timeline.ts"), timeline: "t1" }).resolve(),
    (error: any) => {
      assert.equal(error.code, ErrorCode.CC1012);
      assert.match(error.message, /--timeline.*--file/);
      return true;
    },
  );
  await assert.rejects(createProjectResolver({ root, composition: "t1" }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1012);
    assert.match(error.message, /--composition.*--file/);
    return true;
  });
  await assert.rejects(createProjectResolver({ root, all: true, timeline: "t1" }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1012);
    assert.match(error.message, /Conflicting selectors/);
    return true;
  });
});

test("an unknown timeline id lists what is registered", async () => {
  const root = project({ "main.ts": "export default { timelines: [{ id: 't1', file: './timeline.ts' }] };\n", "timeline.ts": TIMELINE });
  await assert.rejects(createProjectResolver({ root, timeline: "missing" }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC3007);
    assert.match(error.message, /t1/);
    return true;
  });
});

test("a missing selector lists the available ids instead of choosing one", async () => {
  const root = project({
    "main.ts": "export default { timelines: [{ id: 't1', file: './timeline.ts' }], scenes: [{ id: 's1', file: './timeline.ts' }] };\n",
    "timeline.ts": TIMELINE,
  });
  await assert.rejects(createProjectResolver({ root, requireSelection: true }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1012);
    assert.match(error.message, /timelines: t1/);
    assert.match(error.message, /scenes: s1/);
    return true;
  });
});

test("root and nested invocation resolve the same record", async () => {
  const root = project({ "main.ts": "export default { timelines: [{ id: 't1', file: './timeline.ts' }] };\n", "timeline.ts": TIMELINE });
  const nested = join(root, "src", "deep");
  mkdirSync(nested, { recursive: true });
  const fromRoot = await createProjectResolver({ cwd: root, timeline: "t1" }).resolve();
  const fromNested = await createProjectResolver({ cwd: nested, timeline: "t1" }).resolve();
  assert.deepEqual(describeResolution(fromRoot), describeResolution(fromNested));
  assert.equal(fromNested.root, root);
  assert.equal(fromNested.mode, "project");
  assert.deepEqual([...(await createProjectResolver({ cwd: nested, timeline: "t1" }).all())].length, 1);
});

test("resolution is memoized per invocation", async () => {
  const root = project({ "main.ts": "export default { timelines: [{ id: 't1', file: './timeline.ts' }] };\n", "timeline.ts": TIMELINE });
  const resolver = createProjectResolver({ root, timeline: "t1" });
  assert.equal(await resolver.resolve(), await resolver.resolve());
  assert.equal(await resolver.all(), await resolver.all());
});
