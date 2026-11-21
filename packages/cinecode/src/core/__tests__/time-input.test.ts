import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDurationInput, parseTimeInput, TIME_GRAMMAR } from "../time-input.js";
import { parseTimeArgument } from "../../cli/shared.js";
import { UsageError } from "../../cli/usage-error.js";

const ACCEPTED: ReadonlyArray<readonly [string, number, number, number]> = [
  ["00:00:01:15", 30, 45, 1.5],
  ["00:00:02", 30, 60, 2],
  ["01:30", 30, 2700, 90],
  ["12.5s", 30, 375, 12.5],
  ["250ms", 30, 8, 0.25],
  ["12.5", 30, 375, 12.5],
  ["30f", 30, 30, 1],
  ["frames(30)", 30, 30, 1],
  ["30", 30, 900, 30],
  ["00:00:00:00", 25, 0, 0],
];

test("every documented form parses at the caller frame rate", () => {
  for (const [input, fps, frame, seconds] of ACCEPTED) {
    const result = parseTimeInput(input, fps);
    assert.equal(result.ok, true, `${input}: ${result.ok ? "" : result.error}`);
    if (!result.ok) continue;
    assert.equal(result.time.frame, frame, input);
    assert.equal(result.time.seconds, seconds, input);
  }
});

test("the documented grammar names every accepted form", () => {
  assert.match(TIME_GRAMMAR, /HH:MM:SS:FF/);
  assert.match(TIME_GRAMMAR, /HH:MM:SS/);
  assert.match(TIME_GRAMMAR, /12\.5s/);
  assert.match(TIME_GRAMMAR, /250ms/);
  assert.match(TIME_GRAMMAR, /30f/);
  assert.match(TIME_GRAMMAR, /frames\(30\)/);
});

test("malformed times are usage errors naming the accepted forms", () => {
  const rejected = ["", "   ", "-1", "1.5f", "1:2:3:4:5", "00:00:01:30", "12x", "frames(-1)", "abc", "1:70"];
  for (const input of rejected) {
    const result = parseTimeInput(input, 30);
    assert.equal(result.ok, false, input);
    if (result.ok) continue;
    assert.match(result.error, /Accepted forms:/, input);
  }
  assert.throws(() => parseTimeArgument("bogus", 30), (error: unknown) => error instanceof UsageError && /Accepted forms:/.test(error.message));
});

test("manifest durations use the same parser and require a positive value", () => {
  assert.deepEqual(parseDurationInput(2, 30), { ok: true, seconds: 2 });
  assert.deepEqual(parseDurationInput("2s", 30), { ok: true, seconds: 2 });
  assert.deepEqual(parseDurationInput("00:00:02:15", 30), { ok: true, seconds: 2.5 });
  assert.deepEqual(parseDurationInput("30f", 30), { ok: true, seconds: 1 });
  const zero = parseDurationInput("0", 30);
  assert.equal(zero.ok, false);
  const bad = parseDurationInput("nope", 30);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /Accepted forms:/);
});

test("frame indexes in timecode stay below the frame rate", () => {
  assert.equal(parseTimeInput("00:00:01:24", 25).ok, true);
  assert.equal(parseTimeInput("00:00:01:25", 25).ok, false);
  assert.equal(parseTimeInput("00:00:01:30", 30).ok, false);
});
