import assert from "node:assert/strict";
import { test } from "node:test";
import type { Composition, VisualClip } from "../../core/types/index.js";
import { renderFrame } from "../engine.js";
import { resetDiagnostics, pendingDegradations } from "../../errors/degradations.js";
import { logger } from "../../observability/logger.js";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "../../..");

test("rendering with a degradation produces zero stdout writes and records degradation once", async () => {
  resetDiagnostics();
  // Split-screen with empty track at frame triggers degradation
  const comp: Composition = {
    name: "split-degrade-fixture",
    width: 64,
    height: 64,
    fps: 30,
    background: "#000000",
    audio: { sampleRate: 48000, channels: 2, masterVolume: 1 },
    splitScreen: {
      layout: "side-by-side",
      regions: [{ x: 0, y: 0, width: 0.5, height: 1, track: "main", clipIndex: 0 }],
    },
    rootTimeline: {
      tracks: [
        {
          name: "main",
          kind: "visual",
          clips: [
            {
              type: "solid",
              name: "bg",
              color: "#ff0000",
              start: 0,
              duration: 1,
            } as VisualClip,
          ],
        },
      ],
    },
  };

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = (chunk: unknown) => {
    stdoutChunks.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk: unknown) => {
    stderrChunks.push(String(chunk));
    return true;
  };

  try {
    // Frame 60 (at 2.0s) is beyond duration 1s of clip "bg"
    await renderFrame(comp, 60, 2);
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  // Stdout must remain completely empty during library render
  assert.equal(stdoutChunks.length, 0, `stdout must be clean, got: ${stdoutChunks.join("")}`);

  // Degradation recorded through collector exactly once
  const degradations = pendingDegradations().filter((d) => d.code === "CC3007");
  assert.equal(degradations.length, 1, "split screen degradation must be recorded once");
  assert.equal(degradations[0]?.what, "split-screen region has no active clip");
});

test("structured logger writes to stderr and respects log level", () => {
  const stderrChunks: string[] = [];
  const stdoutChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = (chunk: unknown) => {
    stdoutChunks.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk: unknown) => {
    stderrChunks.push(String(chunk));
    return true;
  };

  try {
    logger.setLevel("info");
    logger.debug("test-comp", "this should be silent");
    assert.equal(stderrChunks.length, 0, "debug should be silent when level is info");
    assert.equal(stdoutChunks.length, 0, "stdout should always be empty");

    logger.setLevel("debug");
    logger.debug("test-comp", "this should be printed to stderr");
    assert.equal(stdoutChunks.length, 0, "stdout must still be empty");
    assert.ok(stderrChunks.some((c) => c.includes("this should be printed to stderr")));
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    logger.setLevel("info");
  }
});

test("check-console-writes script confirms zero disallowed console writes in library modules", () => {
  const scriptPath = path.join(pkgRoot, "scripts/check-console-writes.mjs");
  const output = execFileSync(process.execPath, [scriptPath], { encoding: "utf8" });
  assert.match(output, /passed/);
  assert.match(output, /zero violations/);
});
