import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { Canvas } from "@napi-rs/canvas";
import type { FontEntry } from "../../../core/types/index.js";
import { describeRegisteredFonts, registerProjectFonts } from "../fonts.js";

const projectRoot = resolve(process.cwd(), "../..");
const mediaDir = "example/sql/assets/fonts";
const family = "Cinecode Test Grotesk";
const source = "SpaceGrotesk-Bold.ttf";
const fontSrc = `${mediaDir}/${source}`;

function fonts(): FontEntry[] {
  return [{ family, src: fontSrc }];
}

function widthFor(fontFamily: string): number {
  const ctx = new Canvas(8, 8).getContext("2d");
  ctx.font = `16px "${fontFamily}"`;
  return ctx.measureText("Hello World").width;
}

test("a configured font file changes measured glyph metrics", () => {
  const result = registerProjectFonts(fonts(), { projectRoot, mediaDir });
  assert.deepEqual(result.errors, []);
  assert.equal(result.fonts[0]?.kind, "file");
  const custom = widthFor(family);
  const fallback = widthFor("Cinecode Missing Family");
  assert.ok(Number.isFinite(custom) && custom > 0);
  assert.notEqual(custom, fallback);
  const registered = describeRegisteredFonts();
  assert.ok(registered.families.includes(family));
});

test("missing font files fail with family and path", () => {
  const result = registerProjectFonts(
    [{ family: "Missing Font", src: "missing-font.ttf" }],
    { projectRoot, mediaDir },
  );
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]?.code, "CC2001");
  assert.equal(result.errors[0]?.family, "Missing Font");
  assert.match(result.errors[0]?.path ?? "", /missing-font\.ttf$/);
});

test("web font formats are rejected clearly", () => {
  const result = registerProjectFonts(
    [{ family: "Web Font", src: "web-font.woff2" }],
    { projectRoot, mediaDir },
  );
  assert.equal(result.errors[0]?.code, "CC1003");
  assert.match(result.errors[0]?.message ?? "", /unsupported web format/);
});

test("fonts must live inside the media root", () => {
  const root = mkdtempSync(resolve(tmpdir(), "cinecode-font-outside-"));
  mkdirSync(resolve(root, "media"), { recursive: true });
  copyFileSync(resolve(projectRoot, mediaDir, source), resolve(root, "outside.ttf"));
  const result = registerProjectFonts([{ family: "Outside Font", src: "outside.ttf" }], {
    projectRoot: root,
    mediaDir: "media",
  });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]?.message ?? "", /media root/);
});

test("duplicate families resolve deterministically to the first configured face", () => {
  const result = registerProjectFonts(
    [
      { family: "Duplicate Grotesk", src: `${mediaDir}/SpaceGrotesk-Bold.ttf` },
      { family: "Duplicate Grotesk", src: `${mediaDir}/SpaceGrotesk-Medium.ttf` },
    ],
    { projectRoot, mediaDir },
  );
  assert.equal(result.fonts.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]?.message ?? "", /first configured face/);
});

test("a worker process registers the same configured font", async () => {
  const local = widthFor(family);
  const result = await new Promise<{
    errors: number;
    width: number;
    registered: { count: number; families: string[] };
  }>((resolvePromise, reject) => {
    const worker = new Worker(new URL("./font-worker.js", import.meta.url), {
      workerData: { fonts: fonts(), projectRoot, mediaDir, family },
    });
    worker.once("message", (message) => {
      void worker.terminate();
      resolvePromise(message);
    });
    worker.once("error", reject);
  });
  assert.equal(result.errors, 0);
  assert.equal(result.width, local);
  assert.ok(result.registered.families.includes(family));
});
