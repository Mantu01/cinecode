import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, mock } from "node:test";
import { createProjectResolver } from "../resolve/project-resolver.js";
import { runCli } from "../program.js";
import { ErrorCode } from "../../errors/index.js";

const TIMELINE = "export default { tracks: [] };\n";
const SCENE = "export default { kind: 'scene', name: 's', duration: 5, build: () => ({ tracks: [] }) };\n";

interface Sinks {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

function capture(run: (sinks: Sinks) => Promise<number>): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = mock.method(console, "log", (...args: unknown[]) => void out.push(args.join(" ")));
  const error = mock.method(console, "error", (...args: unknown[]) => void err.push(args.join(" ")));
  return run({ stdout: (text) => void out.push(text), stderr: (text) => void err.push(text) })
    .then((code) => ({ code, out: out.join("\n"), err: err.join("\n") }))
    .finally(() => {
      log.mock.restore();
      error.mock.restore();
    });
}

function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "cinecode-val-"));
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

test("duplicate ids within same collection names both entries", async () => {
  const root = project({
    "main.ts": "export default { scenes: [{ id: 'intro', file: './s1.ts' }, { id: 'intro', file: './s2.ts' }] };\n",
    "s1.ts": SCENE,
    "s2.ts": SCENE,
  });
  await assert.rejects(createProjectResolver({ root }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1010);
    assert.match(error.message, /duplicate id "intro" declared in scenes\[0\] and scenes\[1\]/);
    return true;
  });
});

test("duplicate ids across referenceable collections names both occurrences", async () => {
  const root = project({
    "main.ts": "export default { timelines: [{ id: 'shared', file: './t.ts' }], scenes: [{ id: 'shared', file: './s.ts' }] };\n",
    "t.ts": TIMELINE,
    "s.ts": SCENE,
  });
  await assert.rejects(createProjectResolver({ root }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1010);
    assert.match(error.message, /duplicate id "shared" declared in (timelines\[0\] and scenes\[0\]|scenes\[0\] and timelines\[0\])/);
    return true;
  });
});

test("dangling scene reference fails naming the referencing timeline id", async () => {
  const root = project({
    "main.ts": "export default { timelines: [{ id: 't1', sceneRefs: ['missing-scene'] }] };\n",
  });
  await assert.rejects(createProjectResolver({ root }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC3007);
    assert.match(error.message, /t1/);
    assert.match(error.message, /missing-scene/);
    return true;
  });
});

test("dangling audio reference fails naming the referencing timeline id", async () => {
  const root = project({
    "main.ts": "export default { timelines: [{ id: 't1', file: './t.ts', audioRef: ['missing-audio'] }] };\n",
    "t.ts": TIMELINE,
  });
  await assert.rejects(createProjectResolver({ root }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC3007);
    assert.match(error.message, /t1/);
    assert.match(error.message, /missing-audio/);
    return true;
  });
});

test("missing entry file reports entry id, declared path and resolved path", async () => {
  const root = project({
    "main.ts": "export default { scenes: [{ id: 's1', file: './missing-scene.ts' }] };\n",
  });
  await assert.rejects(createProjectResolver({ root }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1009);
    assert.match(error.message, /s1/);
    assert.match(error.message, /missing-scene\.ts/);
    return true;
  });
});

test("wrong-export entry reports the entry id", async () => {
  const root = project({
    "main.ts": "export default { scenes: [{ id: 's1', file: './bad-export.ts' }] };\n",
    "bad-export.ts": "export default { kind: 'image' };\n",
  });
  await assert.rejects(createProjectResolver({ root }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC3008);
    assert.match(error.message, /s1/);
    assert.match(error.message, /scene/i);
    return true;
  });
});

test("invalid duration fails with coded error", async () => {
  const root = project({
    "main.ts": "export default { scenes: [{ id: 's1', file: './s.ts', duration: -5 }] };\n",
    "s.ts": SCENE,
  });
  await assert.rejects(createProjectResolver({ root }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC3002);
    assert.match(error.message, /s1/);
    return true;
  });
});

test("bad timecode fails against project frame rate", async () => {
  const root = project({
    "main.ts": "export default { scenes: [{ id: 's1', file: './s.ts', duration: '00:00:01:30' }] };\n",
    "s.ts": SCENE,
  });
  await assert.rejects(createProjectResolver({ root }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1010);
    assert.match(error.message, /s1/);
    assert.match(error.message, /24 fps/);
    return true;
  });
});

test("unknown manifest key is rejected with its path", async () => {
  const root = project({
    "main.ts": "export default { timelines: [{ id: 't1', file: './t.ts', unsupportedField: true }] };\n",
    "t.ts": TIMELINE,
  });
  await assert.rejects(createProjectResolver({ root }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1002);
    assert.match(error.message, /unsupportedField/);
    return true;
  });
});

test("path traversal outside root is rejected with entry id", async () => {
  const root = project({
    "main.ts": "export default { scenes: [{ id: 's1', file: '../outside.ts' }] };\n",
  });
  await assert.rejects(createProjectResolver({ root }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1003);
    assert.match(error.message, /s1/);
    assert.match(error.message, /outside project root/);
    return true;
  });
});

test("media reference missing reports coded error and entry id", async () => {
  const root = project({
    "main.ts": "export default { timelines: [{ id: 't1', file: './t.ts', audioRef: ['a1'] }], audio: [{ id: 'a1', src: './nonexistent.mp3' }] };\n",
    "t.ts": TIMELINE,
  });
  await assert.rejects(createProjectResolver({ root }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC2001);
    assert.match(error.message, /nonexistent\.mp3/);
    assert.match(error.message, /a1/);
    return true;
  });
});

test("reserved collections are explicitly rejected as unsupported", async () => {
  const root = project({
    "main.ts": "export default { characters: [{ id: 'c1' }] };\n",
  });
  await assert.rejects(createProjectResolver({ root }).resolve(), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1010);
    assert.match(error.message, /characters.*not supported/i);
    return true;
  });
});

test("render, validate and inspect report identical issue lists for the same project", async () => {
  const root = project({
    "main.ts": "export default { scenes: [{ id: 'dup', file: './s.ts' }, { id: 'dup', file: './s.ts' }] };\n",
    "s.ts": SCENE,
  });

  const renderResult = await capture((sinks) => runCli(["node", "cinecode", "render", "--root", root, "--scene", "dup", "--json"], sinks));
  const validateResult = await capture((sinks) => runCli(["node", "cinecode", "validate", "--root", root, "--json"], sinks));
  const inspectResult = await capture((sinks) => runCli(["node", "cinecode", "inspect", "--root", root, "--scene", "dup", "--json"], sinks));

  assert.equal(renderResult.code, 3);
  assert.equal(validateResult.code, 3);
  assert.equal(inspectResult.code, 3);

  const renderJson = JSON.parse(renderResult.out);
  const validateJson = JSON.parse(validateResult.out);
  const inspectJson = JSON.parse(inspectResult.out);

  assert.equal(renderJson.error.code, validateJson.error.code);
  assert.equal(renderJson.error.message, validateJson.error.message);
  assert.equal(inspectJson.error.code, validateJson.error.code);
  assert.equal(inspectJson.error.message, validateJson.error.message);
});

test("entry modules are loaded at most once per resolution", async () => {
  const root = project({
    "main.ts": "export default { scenes: [{ id: 's1', file: './s.ts' }] };\n",
    "s.ts": "globalThis.__LOAD_COUNT = (globalThis.__LOAD_COUNT || 0) + 1; export default { kind: 'scene', name: 's1', duration: 1, build: () => ({ tracks: [] }) };\n",
  });
  (globalThis as any).__LOAD_COUNT = 0;
  const resolver = createProjectResolver({ root, scene: "s1" });
  await resolver.resolve();
  const countAfterResolve = (globalThis as any).__LOAD_COUNT;
  assert.equal(countAfterResolve, 1);
  await resolver.selected();
  await resolver.all();
  assert.equal((globalThis as any).__LOAD_COUNT, 1);
});
