import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { MainManifest } from "../../core/types/index.js";
import { ErrorCode } from "../../errors/index.js";
import { runCli } from "../../cli/program.js";
import { buildReferenceGraph, referenceWarnings } from "../references.js";

const TRACKS = "export default { tracks: [{ name: 'a', clips: [{ type: 'solid', color: '#000000', duration: 1 }] }] };\n";
const IMAGE = "export default { type: 'solid', color: '#000000' };\n";
const AUDIO = "export default { kind: 'audio', build: () => ({ sampleRate: 48000, channels: 2, length: 0, data: new Float32Array() }) };\n";

const MANIFEST = `export default {
  timelines: [{ id: "main", sceneRefs: ["used"], audioRef: ["bed"] }],
  scenes: [
    { id: "used", file: "./used.ts" },
    { id: "standalone", file: "./standalone.ts" },
  ],
  audio: [{ id: "bed", file: "./audio.ts" }],
  images: [{ id: "poster", file: "./image.ts" }],
};
`;

function project(manifest = MANIFEST): string {
  const root = mkdtempSync(join(tmpdir(), "cinecode-refs-"));
  writeFileSync(
    join(root, "cinecode.config.json"),
    JSON.stringify({ schemaVersion: 2, project: { entry: "./main.ts" }, video: { width: 32, height: 32, fps: 30 } }),
  );
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "main.ts"), manifest);
  writeFileSync(join(root, "used.ts"), TRACKS);
  writeFileSync(join(root, "standalone.ts"), TRACKS);
  writeFileSync(join(root, "image.ts"), IMAGE);
  writeFileSync(join(root, "audio.ts"), AUDIO);
  return root;
}

function idsOf(warnings: ReturnType<typeof referenceWarnings>): string[] {
  return warnings
    .map((warning) =>
      warning.code === ErrorCode.CC3010
        ? `${warning.code}:${warning.message.match(/"([^"]+)" references scene "([^"]+)"/)?.slice(1).join("/")}`
        : `${warning.code}:${warning.message.match(/"([^"]+)"/)?.[1]}`,
    )
    .sort();
}

test("the four fixture cases produce exactly the expected warning set", () => {
  const fixture: MainManifest = {
    timelines: [{ id: "main", file: "./used.ts", sceneRefs: ["used"], audioRef: ["bed"] }],
    scenes: [{ id: "used", file: "./used.ts" }, { id: "standalone", file: "./standalone.ts" }],
    audio: [{ id: "bed", file: "./audio.ts" }],
    images: [{ id: "poster", file: "./image.ts" }],
  };
  const warnings = referenceWarnings(fixture);
  assert.deepEqual(idsOf(warnings), [
    "CC3009:poster",
    "CC3009:standalone",
    "CC3010:main/used",
  ]);
  assert.ok(warnings.every((warning) => warning.severity === "warning"));
  const standalone = warnings.find((warning) => warning.message.includes('"standalone"'));
  assert.ok(standalone);
  assert.match(standalone.fixHint ?? "", /standalone render target/);
});

test("the reference graph separates referenced and unreferenced entries", () => {
  const graph = buildReferenceGraph({
    timelines: [{ id: "main", sceneRefs: ["used"], audioRef: ["bed"] }],
    scenes: [{ id: "used", file: "./used.ts" }, { id: "standalone", file: "./standalone.ts" }],
    audio: [{ id: "bed", file: "./audio.ts" }],
    images: [{ id: "poster", file: "./image.ts" }],
  });
  assert.deepEqual([...graph.scenes], ["used"]);
  assert.deepEqual([...graph.audio], ["bed"]);
  assert.deepEqual([...graph.timelines], ["main"]);
  assert.deepEqual(graph.overridden, []);
});

test("a scene reference overridden by a timeline file warns once per reference", () => {
  const overridden: MainManifest = {
    timelines: [{ id: "main", file: "./used.ts", sceneRefs: ["used", "standalone"] }],
  };
  const graph = buildReferenceGraph(overridden);
  assert.equal(graph.overridden.length, 2);
  const warnings = referenceWarnings(overridden).filter((warning) => warning.code === ErrorCode.CC3010);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0]!.message, /Timeline "main" references scene "used"/);
});

test("check reports each warning once and strict mode fails the run", async () => {
  const root = project();

  const relaxed = await runCli(["node", "cinecode", "check", "--root", root, "--json"], {
    stdout: () => undefined,
    stderr: () => undefined,
  }).then((code) => code);
  assert.equal(relaxed, 0);

  const strict = await runCli(["node", "cinecode", "check", "--root", root, "--strict", "--json"], {
    stdout: () => undefined,
    stderr: () => undefined,
  });
  assert.equal(strict, 3);
});

test("inspect prints the reference warnings and machine mode carries them", async () => {
  const root = project();
  const chunks: string[] = [];
  const code = await runCli(["node", "cinecode", "inspect", "--root", root, "--timeline", "main", "--json"], {
    stdout: (text) => void chunks.push(text),
    stderr: () => undefined,
  });
  assert.equal(code, 0, chunks.join(""));
  const report = JSON.parse(chunks.join(""));
  const codes = (report.warnings as Array<{ code: string }>).map((warning) => warning.code);
  assert.equal(codes.filter((code) => code === "CC3009").length, 2);
});
