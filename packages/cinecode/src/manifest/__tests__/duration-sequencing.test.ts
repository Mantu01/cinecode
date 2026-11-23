import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ErrorCode } from "../../errors/index.js";
import { pendingDegradations, pendingNotes } from "../../errors/degradations.js";
import { normalizeConfig } from "../../config/schema.js";
import { runReport } from "../../cli/output/run-report.js";
import {
  assembleTimelineComposition,
  composeSceneComposition,
  loadManifestProject,
  validateManifestDocument,
} from "../index.js";
import { runCli } from "../../cli/program.js";

const CONFIG = { schemaVersion: 2, project: { entry: "./main.ts" }, video: { width: 32, height: 32, fps: 30 } };
const config = normalizeConfig(CONFIG);

function clip(duration: number): string {
  return `export default { tracks: [{ name: "a", clips: [{ type: "solid", color: "#000000", duration: ${duration} }] }] };\n`;
}

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "cinecode-duration-"));
  writeFileSync(join(root, "cinecode.config.json"), JSON.stringify(CONFIG));
  mkdirSync(join(root, "src"), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
  return root;
}

async function load(files: Record<string, string>) {
  const root = project(files);
  return { root, project: await loadManifestProject(config, root) };
}

test("a declared duration shorter than the content is rejected with both numbers and the frame loss", async () => {
  const { project: loaded } = await load({
    "main.ts": 'export default { timelines: [{ id: "main", file: "./t.ts", duration: 2 }] };\n',
    "t.ts": clip(5),
  });
  await assert.rejects(assembleTimelineComposition(loaded, "main"), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1010);
    assert.match(error.message, /declares duration 2s but its content runs 5s/);
    assert.match(error.message, /90 frame\(s\)/);
    assert.match(error.message, /truncate/);
    assert.equal(error.location.clip, "main");
    return true;
  });
});

test("truncate: true accepts the cut and reports the dropped frames", async () => {
  runReport.reset();
  const { project: loaded } = await load({
    "main.ts": 'export default { timelines: [{ id: "main", file: "./t.ts", duration: 2, truncate: true }] };\n',
    "t.ts": clip(5),
  });
  const composition = await assembleTimelineComposition(loaded, "main");
  assert.equal(composition.duration, 2);
  assert.equal(composition.contentDuration, 5);
  const degradation = pendingDegradations().find((entry) => /truncates its content/.test(entry.what));
  assert.ok(degradation);
  assert.match(degradation.instead, /90 frame\(s\)/);
});

test("a declared duration longer than the content is allowed and noted", async () => {
  runReport.reset();
  const { project: loaded } = await load({
    "main.ts": 'export default { timelines: [{ id: "main", file: "./t.ts", duration: 8 }] };\n',
    "t.ts": clip(5),
  });
  const composition = await assembleTimelineComposition(loaded, "main");
  assert.equal(composition.duration, 8);
  assert.equal(composition.contentDuration, 5);
  assert.ok(pendingNotes().some((note) => /content ends at 5s/.test(note)));
});

test("a scene duration that disagrees with its content is rejected", async () => {
  const { project: loaded } = await load({
    "main.ts": 'export default { scenes: [{ id: "intro", file: "./s.ts", duration: 2 }] };\n',
    "s.ts": clip(5),
  });
  await assert.rejects(composeSceneComposition(loaded, "intro"), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1010);
    assert.match(error.message, /scene "intro" declares duration 2s but its content runs 5s/);
    return true;
  });
});

test("a mismatched scene is rejected when a timeline references it", async () => {
  const { project: loaded } = await load({
    "main.ts": 'export default { timelines: [{ id: "main", sceneRefs: ["intro"] }], scenes: [{ id: "intro", file: "./s.ts", duration: 2 }] };\n',
    "s.ts": clip(5),
  });
  await assert.rejects(assembleTimelineComposition(loaded, "main"), (error: any) => {
    assert.match(error.message, /scene "intro"/);
    return true;
  });
});

test("a timeline declaring both file and sceneRefs is rejected with both keys named", async () => {
  const root = project({
    "main.ts": 'export default { timelines: [{ id: "main", file: "./t.ts", sceneRefs: ["a"] }], scenes: [{ id: "a", file: "./a.ts" }] };\n',
    "t.ts": clip(1),
    "a.ts": clip(1),
  });
  const result = await validateManifestDocument(
    { timelines: [{ id: "main", file: "./t.ts", sceneRefs: ["a"] }], scenes: [{ id: "a", file: "./a.ts" }] },
    { rootDir: root, manifestPath: join(root, "main.ts"), config },
  );
  assert.equal(result.valid, false);
  const error = result.errors.find((candidate) => /both "file" and "sceneRefs"/.test(candidate.message));
  assert.ok(error, result.errors.map((candidate) => candidate.message).join("\n"));
  assert.match(error.message, /remove either "file" or "sceneRefs"/);
});

test("check surfaces the duration error before rendering", async () => {
  const root = project({
    "main.ts": 'export default { timelines: [{ id: "main", file: "./t.ts", duration: 2 }] };\n',
    "t.ts": clip(5),
  });
  const chunks: string[] = [];
  const code = await runCli(["node", "cinecode", "check", "--root", root, "--json"], {
    stdout: (text) => void chunks.push(text),
    stderr: () => undefined,
  });
  assert.equal(code, 3, chunks.join(""));
  const report = JSON.parse(chunks.join(""));
  const codes = (report.result.errors as Array<{ code: string }>).map((issue) => issue.code);
  assert.ok(codes.includes(ErrorCode.CC1010), codes.join(", "));
  assert.match(JSON.stringify(report.result.errors), /declares duration 2s but its content runs 5s/);
});

test("sequential scenes assemble back-to-back with the sum of their contents", async () => {
  const { project: loaded } = await load({
    "main.ts": 'export default { timelines: [{ id: "main", sceneRefs: ["a", "b"] }], scenes: [{ id: "a", file: "./a.ts" }, { id: "b", file: "./b.ts" }] };\n',
    "a.ts": clip(2),
    "b.ts": clip(3),
  });
  const composition = await assembleTimelineComposition(loaded, "main");
  assert.equal(composition.duration, 5);
  assert.equal(composition.contentDuration, 5);
  const starts = composition.rootTimeline.tracks
    .flatMap((track) => track.clips as readonly { start?: number }[])
    .map((entry) => Number(entry.start ?? 0))
    .sort((left, right) => left - right);
  assert.deepEqual(starts, [0, 2]);
});
