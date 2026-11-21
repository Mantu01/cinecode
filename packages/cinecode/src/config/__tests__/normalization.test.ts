import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { collectSchemaFields } from "../json-schema.js";
import { explicitPathsOf, loadConfig, normalizeConfig } from "../schema.js";
import { REMOVED_CONFIG_KEYS, validateAuthoringConfig } from "../validator.js";
import { SCHEMA_VERSION } from "../zod-schema.js";
import { ErrorCode } from "../../errors/index.js";
import { buildVideoEncoderArgs } from "../../encoder/index.js";

const FULL: Record<string, unknown> = {
  $schema: "./cinecode.schema.json",
  extends: "./base.json",
  schemaVersion: 2,
  project: { entry: "./main.ts", sourceDir: "./src", mediaDir: "./media", outputDir: "./output", cacheDir: "./.cache" },
  video: { width: 1280, height: 720, fps: 24, defaultDuration: 12, background: "#112233" },
  images: { defaultFormat: "webp", quality: 80, scaleFactor: 2 },
  dev: { port: 4100, host: "127.0.0.1", open: true, hmr: false },
  sourceDir: "./src",
  mediaDir: "./media",
  outputDir: "./output",
  cacheDir: "./.cache",
  allowCoLocatedMedia: true,
  cloudMedia: [{ url: "https://example.com/a.png", name: "a", sha256: "abc" }],
  render: {
    fps: 24,
    resolution: "1280x720",
    format: "webm",
    quality: "preview",
    codec: "vp9",
    crf: 30,
    preset: "fast",
    hardwareAcceleration: "off",
    concurrency: 2,
    chunkSize: 16,
    alpha: true,
    twoPass: true,
    platformPreset: "youtube-1080p",
    bitrate: 2500,
    colorManagement: { workingColorSpace: "srgb", outputColorSpace: "rec709", enabled: true },
  },
  audio: { sampleRate: 44100, channels: 1, masterVolume: 0.8 },
  fonts: [{ family: "Inter", src: "./fonts/inter.woff2", weight: 700, style: "normal" }],
  concurrency: 2,
  overwrite: true,
  gitignore: false,
  plugins: [{ source: "cinecode-plugin-x", options: { mode: "strict" }, enabled: true }],
  pluginPrecedence: ["x"],
  autoDiscoverPlugins: false,
  ignorePatterns: ["**/*.tmp"],
};

function segments(path: string, index = 0): string[] {
  return path.split(".").map((part) => (part.endsWith("[]") ? `${part.slice(0, -2)}[${index}]` : part));
}

function readPath(source: unknown, path: string): unknown {
  let cursor: any = source;
  for (const segment of segments(path)) {
    const match = segment.match(/^(.*)\[(\d+)\]$/);
    if (match) {
      cursor = cursor?.[match[1]!]?.[Number(match[2])];
    } else {
      cursor = cursor?.[segment];
    }
  }
  return cursor;
}

function writePath(source: Record<string, unknown>, path: string, value: unknown): void {
  const parts = segments(path);
  let cursor: any = source;
  for (const part of parts.slice(0, -1)) {
    const match = part.match(/^(.*)\[(\d+)\]$/);
    if (match) {
      cursor[match[1]!] ??= [];
      cursor[match[1]!][Number(match[2])] ??= {};
      cursor = cursor[match[1]!][Number(match[2])];
    } else {
      cursor[part] ??= {};
      cursor = cursor[part];
    }
  }
  const last = parts[parts.length - 1]!;
  const match = last.match(/^(.*)\[(\d+)\]$/);
  if (match) {
    cursor[match[1]!] ??= [];
    cursor[match[1]!][Number(match[2])] = value;
  } else {
    cursor[last] = value;
  }
}

test("a fully populated config normalizes every retained field", () => {
  const config = normalizeConfig(FULL);
  const fields = collectSchemaFields().filter((field) => !["$schema", "extends", "composition"].includes(field.path));
  const explicit = explicitPathsOf(FULL);

  for (const field of fields) {
    const authored = readPath(FULL, field.path);
    if (authored === undefined) continue;
    assert.deepEqual(readPath(config, field.path), authored, `survives ${field.path}`);
    const explicitPath = segments(field.path).join(".");
    assert.ok(
      explicit.has(explicitPath) ||
        [...explicit].some((path) => path.startsWith(`${explicitPath}.`) || path.startsWith(`${explicitPath}[`)),
      `explicit ${field.path}`,
    );
  }

  assert.equal(config.render.bitrate, 2500);
  assert.equal(config.render.alpha, true);
  assert.equal(config.render.twoPass, true);
  assert.equal(config.render.platformPreset, "youtube-1080p");
  assert.equal(config.audio.masterVolume, 0.8);
  assert.equal(config.ignorePatterns[0], "**/*.tmp");
  assert.equal(config.pluginPrecedence[0], "x");
  assert.equal(explicitPathsOf({ render: { bitrate: 900 } }).has("render.alpha"), false);
});

test("retained render fields reach the encoder plan", () => {
  const args = buildVideoEncoderArgs({
    fps: 24,
    width: 1280,
    height: 720,
    crf: 30,
    preset: "fast",
    pixFmt: "yuv420p",
    codec: "h264",
    backend: "software",
    format: "mp4",
    outputPath: "out.mp4",
    tempDir: ".",
    overwrite: true,
    bitrateKbps: 2500,
    pass: 2,
    passLogFile: "pass.log",
  });
  assert.ok(args.includes("-b:v") && args.includes("2500k"), args.join(" "));
  assert.ok(args.includes("-pass") && args.includes("2"), args.join(" "));
});

test("every removed key is rejected with its replacement", () => {
  for (const [key, hint] of Object.entries(REMOVED_CONFIG_KEYS)) {
    const doc = structuredClone(FULL);
    writePath(doc, key, key.includes(".") ? true : {});
    const error = validateAuthoringConfig(doc).errors.find((candidate) => candidate.code === ErrorCode.CC1002);
    assert.ok(error, `rejects ${key}`);
    assert.ok(error.message.includes(key), error.message);
    assert.ok(error.message.includes(hint), `${key}: ${error.message}`);
  }
});

test("a future schema version is refused with the supported version", async () => {
  assert.equal(SCHEMA_VERSION, 2);
  const dir = mkdtempSync(join(tmpdir(), "cinecode-version-"));
  const file = join(dir, "cinecode.config.json");
  writeFileSync(file, JSON.stringify({ schemaVersion: 3 }));
  await assert.rejects(loadConfig(file), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1004);
    assert.match(error.message, /Unsupported schema version: 3/);
    assert.match(error.message, /Expected: 2/);
    return true;
  });
});

test("the inventory table covers every authoring field", () => {
  const doc = readFileSync(fileURLToPath(new URL("../../../../../docs/config-inventory.md", import.meta.url)), "utf8");
  const rows = new Map<string, string>();
  for (const line of doc.split("## Removed keys")[0]!.split("\n")) {
    const match = line.match(/^\| `([^`]+)` \| (.*?) \| (.*?) \|$/);
    if (match) rows.set(match[1]!, match[3]!);
  }
  const fields = collectSchemaFields().map((field) => field.path);
  assert.deepEqual([...rows.keys()].sort(), [...fields].sort());
  for (const [field, effect] of rows) {
    assert.ok(effect.length > 0 && !/no consumer/i.test(effect), field);
  }
});
