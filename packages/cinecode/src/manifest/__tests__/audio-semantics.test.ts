import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ErrorCode } from "../../errors/index.js";
import { normalizeConfig } from "../../config/schema.js";
import { validateManifestDocument } from "../validation.js";
import { validateManifestShape } from "../../config/zod-schema.js";
import { assembleTimelineComposition, loadManifestProject } from "../index.js";
import { generateCommand } from "../../cli/commands/generate.js";
import { renderCommand } from "../../cli/commands/render.js";
import { runReport } from "../../cli/output/run-report.js";

const CONFIG = { schemaVersion: 2, project: { entry: "./main.ts" }, video: { width: 32, height: 32, fps: 30 } };
const config = normalizeConfig(CONFIG);
const TRACKS = "export default { tracks: [{ name: 'a', clips: [{ type: 'solid', color: '#000000', duration: 2 }] }] };\n";
const BUFFER = "export default { sampleRate: 48000, channels: 2, length: 0, data: new Float32Array() };\n";

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "cinecode-audio-"));
  writeFileSync(join(root, "cinecode.config.json"), JSON.stringify(CONFIG));
  mkdirSync(join(root, "src"), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
  return root;
}

test("gain outside 0-4 is a schema error, not a clamp", () => {
  for (const gain of [-1, 5, Number.POSITIVE_INFINITY]) {
    const result = validateManifestShape({ audio: [{ id: "bed", file: "./a.ts", gain }] });
    assert.equal(result.valid, false, String(gain));
    assert.ok(result.errors.some((issue) => issue.path.includes("gain")), String(gain));
  }
  assert.equal(validateManifestShape({ audio: [{ id: "bed", file: "./a.ts", gain: 4 }] }).valid, true);
  assert.equal(validateManifestShape({ audio: [{ id: "bed", file: "./a.ts", gain: 0 }] }).valid, true);
});

test("a missing audio source fails validation even when no timeline references it", async () => {
  const root = project({});
  const result = await validateManifestDocument(
    { audio: [{ id: "bed", src: "./missing.wav" }] },
    { rootDir: root, manifestPath: join(root, "main.ts"), config },
  );
  const error = result.errors.find((candidate) => candidate.code === ErrorCode.CC2001);
  assert.ok(error, result.errors.map((candidate) => candidate.message).join("\n"));
  assert.match(error.message, /missing\.wav/);
  assert.match(error.message, /entry "bed"/);
});

test("audio format is removed; generation reports a WAV artefact", async () => {
  const shape = validateManifestShape({ audio: [{ id: "bed", file: "./a.ts", format: "mp3" }] });
  assert.equal(shape.valid, false);
  assert.ok(shape.errors.some((issue) => issue.keys?.includes("format") || issue.path.includes("format") || issue.message.includes("format")));

  const root = project({
    "main.ts": 'export default { timelines: [{ id: "main", file: "./t.ts", audioRef: ["a"] }], audio: [{ id: "a", file: "./a.ts" }] };\n',
    "t.ts": TRACKS,
    "a.ts": BUFFER,
  });
  runReport.start("generate", true);
  await generateCommand("audio", { root, all: true, dryRun: true, yes: true });
  const report = runReport.finish();
  const generated = (report.result as { generated?: Array<{ path: string }> }).generated ?? [];
  assert.equal(generated.length, 1);
  assert.match(generated[0]!.path, /\.wav$/);
});

test("two beds are placed at the start, span the timeline and report their gains", async () => {
  const root = project({
    "main.ts": 'export default { timelines: [{ id: "main", file: "./t.ts", audioRef: ["a", "b"] }], audio: [{ id: "a", file: "./a.ts", gain: 0.5 }, { id: "b", file: "./b.ts", gain: 2 }] };\n',
    "t.ts": TRACKS,
    "a.ts": BUFFER,
    "b.ts": BUFFER,
  });
  const loaded = await loadManifestProject(config, root);
  const composition = await assembleTimelineComposition(loaded, "main");
  assert.deepEqual(composition.audioPlacements, [
    { id: "a", start: 0, duration: 2, gain: 0.5 },
    { id: "b", start: 0, duration: 2, gain: 2 },
  ]);
  const audioTrack = composition.rootTimeline.tracks.find((track) => track.kind === "audio")!;
  assert.deepEqual(audioTrack.clips.map((clip) => (clip as { volume?: number }).volume), [0.5, 2]);
});

test("render dry-run lists every placed audio track in the machine document", async () => {
  const root = project({
    "main.ts": 'export default { timelines: [{ id: "main", file: "./t.ts", audioRef: ["a", "b"] }], audio: [{ id: "a", file: "./a.ts", gain: 0.5 }, { id: "b", file: "./b.ts", gain: 2 }] };\n',
    "t.ts": TRACKS,
    "a.ts": BUFFER,
    "b.ts": BUFFER,
  });
  runReport.start("render", true);
  await renderCommand({ root, timeline: "main", dryRun: true, all: false, preview: false, noCache: true, fresh: true, resume: false, overwrite: false });
  const report = runReport.finish();
  assert.deepEqual((report.result as { audioPlacements?: unknown }).audioPlacements, [
    { id: "a", start: 0, duration: 2, gain: 0.5 },
    { id: "b", start: 0, duration: 2, gain: 2 },
  ]);
});
