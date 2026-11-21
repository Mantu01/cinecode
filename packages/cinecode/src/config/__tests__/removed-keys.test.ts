import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ErrorCode } from "../../errors/index.js";
import { exitCodeForError } from "../../cli/exit-codes.js";
import { loadConfig } from "../schema.js";
import { validateManifestDocument } from "../../manifest/validation.js";
import { normalizeConfig } from "../schema.js";
import { validateManifestShape } from "../zod-schema.js";

function root(): string {
  return mkdtempSync(join(tmpdir(), "cinecode-removed-"));
}

test("a removed config key fails with its replacement and the validation exit code", async () => {
  const dir = root();
  const file = join(dir, "cinecode.config.json");
  writeFileSync(file, JSON.stringify({ schemaVersion: 2, dev: { metricsPort: 9100 } }));
  await assert.rejects(loadConfig(file), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1002);
    assert.match(error.message, /dev\.metricsPort/);
    assert.match(error.message, /\/metrics/);
    assert.equal(error.location.file, file);
    assert.ok(error.fixHint);
    return true;
  });
  assert.equal(exitCodeForError(ErrorCode.CC1002), 3);
});

test("a config without removed keys loads unchanged", async () => {
  const dir = root();
  const file = join(dir, "cinecode.config.json");
  const authored = { schemaVersion: 2, dev: { port: 4000 }, render: { format: "mp4" } };
  writeFileSync(file, JSON.stringify(authored));
  const config = await loadConfig(file);
  assert.equal(config.dev.port, 4000);
  assert.equal(config.render.format, "mp4");
});

test("removed manifest keys are rejected with their explanation", async () => {
  const shape = validateManifestShape({
    audio: [{ id: "bed", format: "mp3" }],
    scenes: [{ id: "intro", tags: ["a"] }],
  });
  const recognized = shape.errors.filter((issue) => issue.code === "unrecognized_keys");
  assert.equal(recognized.length, 2);
  assert.deepEqual(recognized.map((issue) => issue.keys?.join()).sort(), ["format", "tags"]);

  const dir = root();
  const result = await validateManifestDocument(
    { audio: [{ id: "bed", format: "mp3" }] },
    { rootDir: dir, manifestPath: join(dir, "main.ts"), config: normalizeConfig({}) },
  );
  const removed = result.errors.find((error) => error.code === ErrorCode.CC1002);
  assert.ok(removed);
  assert.match(removed.message, /audio\.0\.format/);
  assert.match(removed.message, /WAV/);
});

test("the dead config scaffold writer has no references left", () => {
  const src = fileURLToPath(new URL("../..", import.meta.url));
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "__tests__" || entry.endsWith(".map")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts") && readFileSync(full, "utf8").includes("scaffoldConfigFile")) hits.push(full);
    }
  };
  walk(src);
  assert.deepEqual(hits, []);
});
