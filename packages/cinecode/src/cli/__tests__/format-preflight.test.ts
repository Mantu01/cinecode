import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { explicitPathsOf, normalizeConfig } from "../../config/schema.js";
import { resolveRenderParameters } from "../resolve/precedence.js";
import { assertRenderableFormat } from "../gate/format-preflight.js";
import { renderCommand } from "../commands/render.js";
import { UsageError } from "../shared/usage-error.js";

function preflight(input: Parameters<typeof assertRenderableFormat>[0]): void {
  assertRenderableFormat(input);
}

test("a still-format preset cannot render a moving window", () => {
  assert.throws(
    () => preflight({ command: "render", format: "webp", fromFrame: 0, toFrame: 30, preset: "web-webp" }),
    (error: unknown) => {
      assert.ok(error instanceof UsageError);
      assert.match(error.message, /web-webp/);
      assert.match(error.message, /30 frames/);
      assert.match(error.message, /cinecode still/);
      return true;
    },
  );
  assert.doesNotThrow(() => preflight({ command: "render", format: "webp", fromFrame: 7, toFrame: 8, preset: "web-webp" }));
});

test("a still command rejects a streamed format and accepts one frame", () => {
  assert.throws(
    () => preflight({ command: "still", format: "mp4", fromFrame: 0, toFrame: 1 }),
    (error: unknown) => error instanceof UsageError && /still command writes one image/.test(error.message),
  );
  assert.doesNotThrow(() => preflight({ command: "still", format: "png", fromFrame: 0, toFrame: 1 }));
  assert.throws(
    () => preflight({ command: "still", format: "png", fromFrame: 0, toFrame: 2 }),
    (error: unknown) => error instanceof UsageError && /one frame/.test(error.message),
  );
});

test("a streaming format succeeds with a one-frame window", () => {
  assert.doesNotThrow(() => preflight({ command: "render", format: "mp4", fromFrame: 10, toFrame: 11 }));
});

test("config format and manifest entry format run the same validation", () => {
  const raw = { render: { format: "jpg" } };
  const viaConfig = resolveRenderParameters({
    selection: { name: "clip", duration: 2 },
    project: { root: "/test", config: normalizeConfig(raw), mode: "file", selection: "clip" },
    explicit: explicitPathsOf(raw),
  }).parameters;
  assert.throws(
    () => preflight({ command: "render", format: viaConfig.format.value, fromFrame: 0, toFrame: 60 }),
    (error: unknown) => error instanceof UsageError && /Format 'jpg' writes a single frame/.test(error.message),
  );

  const viaManifest = resolveRenderParameters({
    selection: { name: "clip", duration: 2, format: "jpg" },
    project: { root: "/test", config: normalizeConfig({}), mode: "project", selection: "timeline clip" },
  }).parameters;
  assert.equal(viaManifest.format.origin, "selection");
  assert.throws(
    () => preflight({ command: "render", format: viaManifest.format.value, fromFrame: 0, toFrame: 60 }),
    (error: unknown) => error instanceof UsageError && /cinecode still/.test(error.message),
  );
});

test("a rejected preset render creates no cache, output or temp files", async () => {
  const root = mkdtempSync(join(tmpdir(), "cinecode-preflight-"));
  writeFileSync(join(root, "cinecode.config.json"), JSON.stringify({ schemaVersion: 2 }));
  writeFileSync(
    join(root, "comp.ts"),
    'export default { name: "still-preset", width: 1080, height: 1080, fps: 30, duration: 2, rootTimeline: { tracks: [] } };\n',
  );
  await assert.rejects(
    renderCommand({
      root,
      file: join(root, "comp.ts"),
      preset: "web-webp",
      all: false,
      preview: false,
      noCache: false,
      fresh: false,
      resume: false,
      overwrite: false,
      dryRun: false,
    }),
    (error: unknown) => error instanceof UsageError && /web-webp/.test(error.message),
  );
  assert.equal(existsSync(join(root, "output")), false);
  assert.equal(existsSync(join(root, ".cinecode")), false);
});

test("a preset that is valid for the command passes without substitution", () => {
  const resolved = resolveRenderParameters({
    flags: { preset: "tiktok" },
    selection: { name: "clip" },
    project: { root: "/test", config: normalizeConfig({}), mode: "file", selection: "clip" },
  });
  assert.equal(resolved.parameters.format.value, "mp4");
  assert.doesNotThrow(() =>
    preflight({
      command: "render",
      format: resolved.parameters.format.value,
      fromFrame: 0,
      toFrame: 300,
      preset: resolved.preset?.id,
    }),
  );
});
