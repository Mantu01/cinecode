import { test } from "node:test";
import assert from "node:assert/strict";
import { measureTextWidth, layoutTextLetters } from "../measure.js";

const STYLE = { fontFamily: "Arial", fontWeight: "normal", fontStyle: "normal", fontSize: 48 };

test("empty text measures to zero width", () => {
  assert.equal(measureTextWidth("", STYLE), 0);
});

test("wider fonts produce wider text", () => {
  const narrow = measureTextWidth("HELLO", { ...STYLE, fontSize: 24 });
  const wide = measureTextWidth("HELLO", { ...STYLE, fontSize: 96 });
  assert.ok(wide > narrow * 1.9, `expected ~2x scaling, got ${narrow} -> ${wide}`);
});

test("letter spacing accumulates between characters only", () => {
  const plain = measureTextWidth("ABC", STYLE);
  const spaced = measureTextWidth("ABC", { ...STYLE, letterSpacing: 10 });
  assert.ok(Math.abs(spaced - (plain + 20)) < 1e-6, `expected +20 for 2 gaps, got ${spaced - plain}`);
});

test("layout positions letters left to right with exact advances", () => {
  const layout = layoutTextLetters("ABC", { ...STYLE, letterSpacing: 4 });
  assert.equal(layout.letters.length, 3);
  const first = layout.letters[0];
  assert.ok(first);
  assert.equal(first.x, 0);
  for (let i = 1; i < layout.letters.length; i += 1) {
    const prev = layout.letters[i - 1];
    const cur = layout.letters[i];
    assert.ok(prev && cur);
    assert.ok(Math.abs(cur.x - (prev.x + prev.width + 4)) < 1e-6, `gap mismatch at index ${i}`);
  }
  const last = layout.letters[2];
  assert.ok(last);
  assert.ok(Math.abs(layout.totalWidth - (last.x + last.width)) < 1e-6);
});

test("letter centers sit at the midpoint of each advance", () => {
  const layout = layoutTextLetters("AB", STYLE);
  for (const letter of layout.letters) {
    assert.ok(Math.abs(letter.center - (letter.x + letter.width / 2)) < 1e-6);
  }
});

test("layout letters match per-character width measurement", () => {
  const style = { ...STYLE, letterSpacing: 3 };
  const layout = layoutTextLetters("CINECODE", style);
  const total = measureTextWidth("CINECODE", style);
  assert.ok(Math.abs(layout.totalWidth - total) < 1e-6, `${layout.totalWidth} vs ${total}`);
});
