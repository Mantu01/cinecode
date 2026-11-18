import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertSidechainSources,
  prepareAudioTracks,
  type AudioPrepareOptions,
} from "../prepare.js";
import type { AudioBuffer, AudioTrackState } from "../types.js";
import { createConversion } from "../../core/time/index.js";
import { resetDiagnostics, takeDegradations } from "../../errors/index.js";

function ramp(length = 100, rate = 100, from = 0, to = 1): AudioBuffer {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i += 1) data[i] = from + ((to - from) * i) / (length - 1);
  return { sampleRate: rate, channels: 1, length, data };
}

function silent(length = 100, rate = 100): AudioBuffer {
  return { sampleRate: rate, channels: 1, length, data: new Float32Array(length) };
}

function options(overrides: Partial<AudioPrepareOptions> = {}): AudioPrepareOptions {
  return {
    cache: {} as AudioPrepareOptions["cache"],
    sampleRate: 100,
    channels: 1,
    duration: 10,
    conversion: createConversion(30),
    trackNames: ["music"],
    ...overrides,
  };
}

test("looping crossfades the seam and fills the exact clip duration", async () => {
  const source = ramp(1000, 1000, -0.9, 0.9);
  const tracks = await prepareAudioTracks(
    [{ type: "sound", buffer: source, duration: 2, loop: true } as never],
    options({ sampleRate: 1000, duration: 2 }),
  );
  const data = tracks[0]!.buffer.data;
  assert.equal(tracks[0]!.buffer.length, 2000);
  let maxStep = 0;
  for (let i = 1; i < data.length; i += 1) {
    maxStep = Math.max(maxStep, Math.abs(data[i]! - data[i - 1]!));
  }
  assert.ok(maxStep < 0.25, `seam must not click, largest sample step was ${maxStep}`);
});

test("a looping clip cannot allocate past the composition duration", async () => {
  const tracks = await prepareAudioTracks(
    [{ type: "sound", buffer: ramp(1000, 1000), duration: 1e6, loop: true } as never],
    options({ sampleRate: 1000, duration: 2 }),
  );
  assert.equal(tracks[0]!.buffer.length, 2000);
});

test("reverse plays the known waveform backwards", async () => {
  const source = ramp();
  const tracks = await prepareAudioTracks(
    [{ type: "sound", buffer: source, duration: 1, reverse: true } as never],
    options(),
  );
  assert.equal(tracks[0]!.buffer.data[0], source.data[source.length - 1]);
  assert.equal(tracks[0]!.buffer.data[99], source.data[0]);
});

test("fades apply in playback order, after reverse", async () => {
  const tracks = await prepareAudioTracks(
    [{ type: "sound", buffer: ramp(), duration: 1, reverse: true, fadeIn: 0.1, fadeOut: 0.1 } as never],
    options(),
  );
  const data = tracks[0]!.buffer.data;
  assert.equal(data[0], 0);
  assert.equal(data[99], 0);
  assert.ok(Math.abs(data[50]! - 49 / 99) < 1e-6, "the reversed middle is untouched by the fades");
});

test("speed resamples and changes the produced duration", async () => {
  const fast = await prepareAudioTracks(
    [{ type: "sound", buffer: ramp(), duration: 5, speed: 2 } as never],
    options(),
  );
  const slow = await prepareAudioTracks(
    [{ type: "sound", buffer: ramp(), duration: 5, speed: 0.5 } as never],
    options(),
  );
  assert.equal(fast[0]!.buffer.length, 50);
  assert.equal(slow[0]!.buffer.length, 200);
});

test("trim runs before speed and reverse", async () => {
  const trimmed = await prepareAudioTracks(
    [{ type: "sound", buffer: ramp(1000, 1000), duration: 10, trimStart: 0.25, speed: 2 } as never],
    options({ sampleRate: 1000, duration: 10 }),
  );
  assert.equal(trimmed[0]!.buffer.length, 375);
  assert.ok(Math.abs(trimmed[0]!.buffer.data[0]! - 0.25) < 0.001);
});

test("trimEnd past the source fails with the clip id", async () => {
  await assert.rejects(
    prepareAudioTracks(
      [{ type: "sound", name: "too-long", buffer: ramp(), trimEnd: 2 } as never],
      options(),
    ),
    /too-long[\s\S]*trimEnd/,
  );
});

test("trimStart past the source fails with the clip id", async () => {
  await assert.rejects(
    prepareAudioTracks(
      [{ type: "sound", name: "late-trim", buffer: ramp(), trimStart: 2 } as never],
      options(),
    ),
    /late-trim[\s\S]*trimStart/,
  );
});

test("timecode parsing follows the composition frame rate", async () => {
  const clip = { type: "sound", buffer: ramp(1000, 1000), duration: "00:00:00:12" } as never;
  const at24 = await prepareAudioTracks(
    [clip],
    options({ conversion: createConversion(24), sampleRate: 1000 }),
  );
  const at30 = await prepareAudioTracks(
    [clip],
    options({ conversion: createConversion(30), sampleRate: 1000 }),
  );
  const at60 = await prepareAudioTracks(
    [clip],
    options({ conversion: createConversion(60), sampleRate: 1000 }),
  );
  assert.equal(at24[0]!.buffer.length, 500);
  assert.equal(at30[0]!.buffer.length, 400);
  assert.equal(at60[0]!.buffer.length, 200);
});

test("a missing sidechain track fails with the clip id", async () => {
  await assert.rejects(
    prepareAudioTracks(
      [{ type: "sound", name: "ducked", buffer: ramp(), sidechainFrom: "missing" } as never],
      options(),
    ),
    /ducked[\s\S]*missing/,
  );
});

test("a silent sidechain track fails with the referencing clip id", async () => {
  const tracks = await prepareAudioTracks(
    [
      { type: "sound", name: "music", buffer: silent() } as never,
      { type: "sound", name: "ducked", buffer: ramp(), sidechainFrom: "music" } as never,
    ],
    options(),
  );
  assert.throws(() => assertSidechainSources(tracks), /ducked[\s\S]*music[\s\S]*silent/);
});

test("mono output reports pan as a degradation", async () => {
  resetDiagnostics();
  await prepareAudioTracks(
    [{ type: "sound", buffer: ramp(), pan: 0.5 } as never],
    options({ channels: 1 }),
  );
  assert.ok(takeDegradations().some((entry) => /mono/.test(entry.what)));
});

test("mono output reports a 3D position as a degradation", async () => {
  resetDiagnostics();
  const tracks = await prepareAudioTracks(
    [{ type: "sound", buffer: ramp(), position3d: { x: 1, z: 1 } } as never],
    options({ channels: 1 }),
  );
  assert.ok(takeDegradations().some((entry) => /3D/.test(entry.what)));
  assert.equal(tracks[0]!.buffer.channels, 1);
});

test("stereo output applies a 3D position without a degradation", async () => {
  resetDiagnostics();
  const tracks = await prepareAudioTracks(
    [{ type: "sound", buffer: ramp(), position3d: { x: 1, z: 1 } } as never],
    options({ channels: 2 }),
  );
  assert.equal(tracks[0]!.buffer.channels, 2);
  assert.ok(!takeDegradations().some((entry) => /3D/.test(entry.what)));
});

test("tracks carry the declared sidechain and muted state", async () => {
  const tracks: AudioTrackState[] = await prepareAudioTracks(
    [{ type: "sound", name: "ducked", buffer: ramp(), sidechainFrom: "music", muted: true } as never],
    options(),
  );
  assert.equal(tracks[0]!.sidechainFrom, "music");
  assert.equal(tracks[0]!.muted, true);
});
