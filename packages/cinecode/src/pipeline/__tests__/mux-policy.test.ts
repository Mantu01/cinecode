import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderVideo } from "../index.js";
import type { Composition } from "../../core/types/index.js";
import type { AudioBuffer } from "../../audio/types.js";
import { probeMediaFile } from "../../media/inspector.js";
import { resetDiagnostics, takeDegradations } from "../../errors/index.js";

function tone(seconds: number): AudioBuffer {
  const sampleRate = 48000;
  const length = Math.round(seconds * sampleRate);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
  }
  return { sampleRate, channels: 1, length, data };
}

function composition(withAudio: boolean | "missing"): Composition {
  const visual = {
    name: "visual",
    kind: "visual" as const,
    clips: [{ type: "solid" as const, color: "#101010", width: 32, height: 32, start: 0, duration: 0.2 }],
  };
  const audio = {
    name: "music",
    kind: "audio" as const,
    clips:
      withAudio === "missing"
        ? [{ type: "audio" as const, src: "missing/nope.wav", duration: 0.2 }]
        : [{ type: "sound" as never, ref: "tone", buffer: tone(0.2), duration: 0.2 }],
  };
  return {
    name: "mux-policy",
    width: 32,
    height: 32,
    fps: 10,
    background: "#000000",
    audio: { sampleRate: 48000, channels: 2 },
    rootTimeline: { tracks: withAudio ? [visual, audio] : [visual] },
  };
}

async function render(kind: boolean | "missing", allowSilentAudio = false): Promise<{
  readonly audio: boolean;
  readonly streamCount: number;
}> {
  const dir = await mkdtemp(join(tmpdir(), "cinecode-mux-policy-"));
  const outputPath = join(dir, "out.mp4");
  try {
    await renderVideo({
      composition: composition(kind),
      outputPath,
      cacheDir: join(dir, "cache"),
      seed: 1,
      concurrency: 1,
      chunkSize: 2,
      quality: "preview",
      overwrite: true,
      fresh: true,
      noCache: true,
      silent: true,
      allowSilentAudio,
    });
    const probe = await probeMediaFile(outputPath);
    return { audio: probe.hasAudio, streamCount: probe.streamCount };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a composition without audio produces no audio stream", async () => {
  const result = await render(false);
  assert.equal(result.audio, false);
  assert.equal(result.streamCount, 1);
});

test("an audible composition produces an audio stream", async () => {
  const result = await render(true);
  assert.equal(result.audio, true);
  assert.equal(result.streamCount, 2);
});

test("a failed mix is a coded error by default", async () => {
  await assert.rejects(
    render("missing"),
    (error: { code?: string }) => error.code === "CC5001",
  );
});

test("a failed mix falls back to silence only when opted in", async () => {
  resetDiagnostics();
  const result = await render("missing", true);
  assert.equal(result.audio, false);
  const degradations = takeDegradations();
  assert.ok(
    degradations.some((entry) => /silence/i.test(entry.what)),
    JSON.stringify(degradations),
  );
});
