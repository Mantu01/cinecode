import assert from "node:assert/strict";
import { test } from "node:test";
import type { Composition, TextClip, VisualClip } from "../../core/types/index.js";
import { renderFrame } from "../engine.js";
import { preflightText } from "../text/preflight.js";
import { resetDiagnostics, pendingDegradations } from "../../errors/degradations.js";

function makeTextComposition(content: string, fontFamily = "sans-serif", extra: Partial<TextClip> = {}): Composition {
  const clip: TextClip = {
    type: "text",
    name: "hero-text",
    content,
    fontFamily,
    fontSize: 24,
    start: 0,
    duration: 1,
    ...extra,
  };
  return {
    name: "text-preflight-fixture",
    width: 64,
    height: 64,
    fps: 30,
    background: "#000000",
    audio: { sampleRate: 48000, channels: 2, masterVolume: 1 },
    rootTimeline: { tracks: [{ name: "main", kind: "visual", clips: [clip as VisualClip] }] },
  };
}

test("a 30-frame render with missing glyphs produces exactly one degradation and zero stdout warnings", async () => {
  resetDiagnostics();
  // \u{E000} is Private Use Area, guaranteed missing from standard font
  const comp = makeTextComposition("Special \u{E000} glyph", "DefinitelyNonExistentFont123");

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };

  try {
    for (let f = 0; f < 30; f++) {
      await renderFrame(comp, f, 0);
    }
  } finally {
    console.warn = originalWarn;
  }

  // Exactly one degradation entry despite 30 frames
  const fontDegradations = pendingDegradations().filter((d) => d.code === "CC3006");
  assert.equal(fontDegradations.length, 1, `expected 1 degradation entry, got ${fontDegradations.length}`);
  assert.equal(fontDegradations[0]?.what, "text font glyph fallback");

  // Zero warnings written to console.warn / standard output
  assert.equal(warnings.length, 0, "no library text warning may be printed to standard output");
});

test("strict mode fails before the first frame when preflight finds a problem", () => {
  const comp = makeTextComposition("Missing \u{E000} char", "DefinitelyNonExistentFont123");

  assert.throws(
    () => preflightText(comp, { strictFonts: true }),
    (err: Error & { code?: string }) => {
      assert.equal(err.code, "CC3006");
      assert.match(err.message, /missing glyphs/i);
      return true;
    },
  );
});

test("a clean project produces zero font degradations", async () => {
  resetDiagnostics();
  const comp = makeTextComposition("Clean ascii text", "sans-serif");

  for (let f = 0; f < 5; f++) {
    await renderFrame(comp, f, 0);
  }

  const fontDegradations = pendingDegradations().filter((d) => d.code === "CC3006");
  assert.equal(fontDegradations.length, 0, "clean text produces no degradation entries");
});

test("preflight report consolidates multiple text clips by family and records affected clip ids", () => {
  resetDiagnostics();
  const comp: Composition = {
    name: "multi-clip-fixture",
    width: 64,
    height: 64,
    fps: 30,
    background: "#000000",
    audio: { sampleRate: 48000, channels: 2, masterVolume: 1 },
    rootTimeline: {
      tracks: [
        {
          name: "track-1",
          kind: "visual",
          clips: [
            {
              type: "text",
              name: "title-clip",
              content: "Title with \u{E001}",
              fontFamily: "CustomFontA",
              fontSize: 32,
              start: 0,
              duration: 1,
            } as VisualClip,
            {
              type: "text",
              name: "subtitle-clip",
              content: "Subtitle with \u{E001} and \u{E002}",
              fontFamily: "CustomFontA",
              fontSize: 16,
              start: 0,
              duration: 1,
            } as VisualClip,
          ],
        },
      ],
    },
  };

  const report = preflightText(comp);
  assert.equal(report.hasProblems, true);
  assert.equal(report.findings.length, 1);
  const finding = report.findings[0]!;
  assert.equal(finding.family, "CustomFontA");
  assert.ok(finding.clipNames.includes("title-clip"));
  assert.ok(finding.clipNames.includes("subtitle-clip"));

  const fontDegradations = pendingDegradations().filter((d) => d.code === "CC3006");
  assert.equal(fontDegradations.length, 1, "exactly one degradation recorded for the family");
});
