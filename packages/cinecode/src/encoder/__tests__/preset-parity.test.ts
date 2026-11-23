import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { listPresetIds, PLATFORM_PRESET_MAP, getPreset, type PlatformPresetId } from "../platform-presets.js";
import { PlatformPresetSchema, RenderInputSchema } from "../../config/zod-schema.js";
import { normalizeConfig } from "../../config/schema.js";
import { resolveRenderParameters } from "../../cli/resolve/precedence.js";
import { buildCommanderCommand } from "../../cli/registry/build.js";
import { findCommand } from "../../cli/registry/assemble.js";

const commandReference = fileURLToPath(new URL("../../../../../docs/command-reference.md", import.meta.url));

test("the preset table is the only id list", () => {
  const ids = listPresetIds();
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    const preset = PLATFORM_PRESET_MAP[id as PlatformPresetId];
    assert.ok(preset, id);
    assert.ok(preset.format.length > 0, id);
    assert.ok(preset.width > 0 && preset.height > 0, id);
    assert.ok(preset.fps > 0, id);
    assert.ok(preset.video.codec.length > 0, id);
    assert.ok(Number.isFinite(preset.video.crf), id);
    assert.ok(preset.video.encoderPreset.length > 0, id);
    assert.ok(preset.audio.codec.length > 0, id);
    assert.ok(preset.extension.startsWith("."), id);
  }
});

test("config and CLI accept exactly the table ids and reject custom or unknown", () => {
  for (const id of listPresetIds()) {
    assert.equal(PlatformPresetSchema.safeParse(id).success, true, id);
    const config = normalizeConfig({ render: { platformPreset: id } });
    assert.equal(config.render?.platformPreset, id);
  }
  for (const value of ["custom", "not-a-preset", ""]) {
    assert.equal(PlatformPresetSchema.safeParse(value).success, false, value);
    assert.equal(getPreset(value), null, value);
    const parsed = RenderInputSchema.safeParse({ platformPreset: value });
    assert.equal(parsed.success, false, value);
    assert.match(JSON.stringify(parsed.error?.issues), /platformPreset/, value);
  }
});

test("selecting a preset through config or the CLI resolves identical parameters", () => {
  for (const id of listPresetIds()) {
    const viaConfig = resolveRenderParameters({
      selection: { name: "clip" },
      project: { root: "/test", config: normalizeConfig({ render: { platformPreset: id } }), mode: "file", selection: "clip" },
    }).parameters;
    const viaCli = resolveRenderParameters({
      flags: { preset: id },
      selection: { name: "clip" },
      project: { root: "/test", config: normalizeConfig({}), mode: "file", selection: "clip" },
    }).parameters;
    for (const field of ["width", "height", "fps", "format", "codec", "crf"] as const) {
      assert.equal(viaConfig[field].value, viaCli[field].value, `${id} ${field}`);
    }
  }
});

test("help, listing and the generated reference agree with the table", () => {
  const spec = findCommand("render");
  assert.ok(spec);
  const help = buildCommanderCommand(spec).options.find((option) => option.long === "--preset");
  assert.ok(help);
  for (const id of listPresetIds()) assert.match(help.description, new RegExp(id));
  const reference = readFileSync(commandReference, "utf8");
  for (const id of listPresetIds()) assert.match(reference, new RegExp(`\\b${id}\\b`), id);
  assert.doesNotMatch(reference, /--preset[^\n]*\bcustom\b/);
});
