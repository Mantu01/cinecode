import assert from "node:assert/strict";
import { test } from "node:test";
import { mixAudioTracks, type MixerOptions } from "../mixer.js";
import { prepareAudioTracks } from "../prepare.js";
import type { AudioBuffer, AudioTrackState } from "../types.js";
import { createConversion } from "../../core/time/index.js";
import { resetDiagnostics, takeDegradations } from "../../errors/index.js";

function stereo(seconds: number, sampleRate = 48000, amplitude = 0.6): AudioBuffer {
  const length = Math.round(seconds * sampleRate);
  const data = new Float32Array(length * 2);
  for (let i = 0; i < length; i += 1) {
    const value = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * amplitude;
    data[i * 2] = value;
    data[i * 2 + 1] = value;
  }
  return { sampleRate, channels: 2, length, data };
}

function mono(seconds: number, sampleRate = 48000, amplitude = 0.4): AudioBuffer {
  const length = Math.round(seconds * sampleRate);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.sin((2 * Math.PI * 110 * i) / sampleRate) * amplitude;
  }
  return { sampleRate, channels: 1, length, data };
}

function track(
  id: string,
  buffer: AudioBuffer,
  overrides: Partial<AudioTrackState> = {},
): AudioTrackState {
  return {
    id,
    buffer,
    startSample: 0,
    endSample: buffer.length,
    volume: 1,
    pan: 0,
    muted: false,
    ...overrides,
  };
}

function options(overrides: Partial<MixerOptions> = {}): MixerOptions {
  return {
    sampleRate: 48000,
    channels: 2,
    masterVolume: 1,
    duration: 1,
    ...overrides,
  };
}

function isFiniteBuffer(buffer: AudioBuffer): boolean {
  for (let i = 0; i < buffer.data.length; i += 1) {
    if (!Number.isFinite(buffer.data[i])) return false;
  }
  return true;
}

test("a 60 second stereo 48 kHz mix with fades, pan and sidechain completes under the ceiling", async () => {
  const seconds = 60;
  const tracks = await prepareAudioTracks(
    [
      { type: "sound", name: "music", buffer: stereo(seconds), duration: seconds, fadeIn: 0.5, fadeOut: 0.5 } as never,
      { type: "sound", name: "voice", buffer: mono(seconds), duration: seconds, pan: -0.5, sidechainFrom: "music" } as never,
    ],
    {
      cache: {} as never,
      sampleRate: 48000,
      channels: 2,
      duration: seconds,
      conversion: createConversion(30),
      trackNames: ["music", "voice"],
    },
  );
  const result = mixAudioTracks(tracks, options({ duration: seconds }));

  assert.equal(result.buffer.length, seconds * 48000);
  assert.ok(isFiniteBuffer(result.buffer), "every mixed sample must be finite");
  assert.ok(result.report.tracksMixed === 2);
  assert.ok(result.report.peakBeforeLimit > 0, "the mix must not be silent");
  assert.ok(result.report.peakAfterLimit <= 0.95 + 1e-6);
  assert.ok(result.report.peakAfterLimit <= result.report.peakBeforeLimit);
  assert.equal(result.report.silent, false);
  assert.ok(
    result.report.allocation.scratchBytes < result.report.allocation.outputBytes / 100,
    "block scratch must not scale with the composition duration",
  );
});

test("block size does not change the mix", async () => {
  const fade = await prepareAudioTracks(
    [{ type: "sound", name: "music", buffer: stereo(1), duration: 1, fadeIn: 0.25, fadeOut: 0.25 } as never],
    {
      cache: {} as never,
      sampleRate: 48000,
      channels: 2,
      duration: 1,
      conversion: createConversion(30),
      trackNames: ["music"],
    },
  );
  const tracks = [...fade, track("target", mono(1), { sidechainFrom: "music", pan: 0.25 })];

  const wide = mixAudioTracks(tracks, options({ blockSize: 4096 }));
  const narrow = mixAudioTracks(tracks, options({ blockSize: 64 }));
  assert.equal(wide.buffer.data.length, narrow.buffer.data.length);
  for (let i = 0; i < wide.buffer.data.length; i += 1) {
    assert.equal(wide.buffer.data[i], narrow.buffer.data[i]);
  }
});

test("a fade spanning a block boundary stays continuous", async () => {
  resetDiagnostics();
  const [faded] = await prepareAudioTracks(
    [{ type: "sound", name: "fade", buffer: stereo(1, 48000, 0.8), duration: 1, fadeIn: 0.5 } as never],
    {
      cache: {} as never,
      sampleRate: 48000,
      channels: 2,
      duration: 1,
      conversion: createConversion(30),
      trackNames: ["fade"],
    },
  );
  const result = mixAudioTracks([faded!], options({ blockSize: 100 }));
  let maxStep = 0;
  for (let i = 2; i < result.buffer.data.length; i += 2) {
    maxStep = Math.max(maxStep, Math.abs(result.buffer.data[i]! - result.buffer.data[i - 2]!));
  }
  assert.ok(maxStep < 0.03, `fade must not step at the block boundary, largest step was ${maxStep}`);
});

test("a non-finite track is reported and excluded", async () => {
  resetDiagnostics();
  const poisoned = stereo(0.5);
  poisoned.data[100] = Number.NaN;
  poisoned.data[101] = Number.POSITIVE_INFINITY;
  const result = mixAudioTracks(
    [track("bad", poisoned), track("good", stereo(0.5))],
    options({ duration: 0.5 }),
  );

  assert.deepEqual(
    result.report.excludedTracks.map((entry) => entry.id),
    ["bad"],
  );
  assert.equal(result.report.tracksMixed, 1);
  assert.ok(isFiniteBuffer(result.buffer));
  assert.ok(takeDegradations().some((entry) => /excluded/.test(entry.what)));
});

test("silence is only produced when no track is audible", () => {
  const empty = mixAudioTracks([], options());
  assert.equal(empty.report.silent, true);
  assert.equal(empty.report.tracksMixed, 0);

  const muted = mixAudioTracks(
    [track("muted", stereo(1), { muted: true })],
    options(),
  );
  assert.equal(muted.report.silent, true);
  assert.deepEqual(muted.report.mutedTracks, ["muted"]);

  const audible = mixAudioTracks([track("live", stereo(1))], options());
  assert.equal(audible.report.silent, false);
});

test("a mono source into a stereo output is reported as an upmix", () => {
  const result = mixAudioTracks([track("mono", mono(0.5))], options({ duration: 0.5 }));
  assert.deepEqual(
    result.report.channelConversions.map((entry) => [entry.from, entry.to, entry.kind]),
    [[1, 2, "upmix"]],
  );
  for (const frame of [100, 500, 1000]) {
    const left = result.buffer.data[frame * 2]!;
    assert.equal(left, result.buffer.data[frame * 2 + 1], "mono is duplicated to both channels");
    assert.ok(Math.abs(left) > 0);
  }
});

test("a stereo source into a mono output is reported as a downmix", () => {
  resetDiagnostics();
  const result = mixAudioTracks([track("stereo", stereo(0.5))], options({ duration: 0.5, channels: 1 }));
  assert.deepEqual(
    result.report.channelConversions.map((entry) => [entry.from, entry.to, entry.kind]),
    [[2, 1, "downmix"]],
  );
  assert.ok(takeDegradations().some((entry) => /downmix/i.test(entry.what)));
});

test("a hot mix is limited to the ceiling", () => {
  const result = mixAudioTracks([track("hot", stereo(1, 48000, 3))], options());
  assert.ok(isFiniteBuffer(result.buffer));
  assert.ok(result.report.peakBeforeLimit > 1);
  assert.ok(result.report.peakAfterLimit <= 0.95 + 1e-6);
  assert.equal(result.report.limiterEngaged, true);
});
