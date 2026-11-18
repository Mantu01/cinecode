import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegStatic from "@ffmpeg-installer/ffmpeg";
import { muxAudioVideo, planMuxAudio } from "../muxer.js";
import type { AudioBuffer } from "../types.js";
import { probeMediaFile } from "../../media/inspector.js";

const ffmpegPath = ffmpegStatic.path;

function tone(seconds: number, amplitude = 0.5): AudioBuffer {
  const sampleRate = 48000;
  const length = Math.round(seconds * sampleRate);
  const data = new Float32Array(length * 2);
  for (let i = 0; i < length; i += 1) {
    const value = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * amplitude;
    data[i * 2] = value;
    data[i * 2 + 1] = value;
  }
  return { sampleRate, channels: 2, length, data };
}

async function workDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cinecode-mux-"));
}

function makeVideo(path: string, seconds: number, fps = 2): void {
  execFileSync(
    ffmpegPath,
    [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=black:s=64x64:d=${seconds}:r=${fps}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-t",
      String(seconds),
      path,
    ],
    { stdio: "ignore" },
  );
}

test("60 seconds of audio does not shorten a 30 second video", async () => {
  const dir = await workDir();
  try {
    const videoPath = join(dir, "video.mp4");
    makeVideo(videoPath, 30);
    const outputPath = join(dir, "muxed.mp4");
    const result = await muxAudioVideo({
      videoPath,
      audioBuffer: tone(60),
      outputPath,
      videoDuration: 30,
      audioCodec: "aac",
    });
    assert.equal(result.success, true, result.error);
    assert.equal(result.adjustment, "trimmed");
    const probe = await probeMediaFile(outputPath);
    assert.equal(probe.hasAudio, true);
    assert.equal(probe.audioCodec, "aac");
    assert.ok(Math.abs((probe.videoDuration ?? 0) - 30) < 0.5, `video duration ${probe.videoDuration}`);
    assert.ok(Math.abs(probe.duration - 30) < 0.5, `container duration ${probe.duration}`);
    assert.ok(Math.abs((probe.audioDuration ?? 0) - 30) < 0.5, `audio duration ${probe.audioDuration}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shorter audio is padded instead of shortening the video", async () => {
  const dir = await workDir();
  try {
    const videoPath = join(dir, "video.mp4");
    makeVideo(videoPath, 4);
    const outputPath = join(dir, "padded.mp4");
    const result = await muxAudioVideo({
      videoPath,
      audioBuffer: tone(2),
      outputPath,
      videoDuration: 4,
      audioCodec: "aac",
    });
    assert.equal(result.success, true, result.error);
    assert.equal(result.adjustment, "padded");
    const probe = await probeMediaFile(outputPath);
    assert.ok(Math.abs(probe.duration - 4) < 0.3, `container duration ${probe.duration}`);
    assert.ok((probe.audioDuration ?? 0) >= 3.5, `audio duration ${probe.audioDuration}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a 24-bit request produces a 24-bit stream", async () => {
  const dir = await workDir();
  try {
    const videoPath = join(dir, "video.mov");
    makeVideo(videoPath, 1);
    const outputPath = join(dir, "pcm.mov");
    const result = await muxAudioVideo({
      videoPath,
      audioBuffer: tone(1),
      outputPath,
      videoDuration: 1,
      audioCodec: "pcm_s24le",
      pcmBitDepth: 24,
    });
    assert.equal(result.success, true, result.error);
    assert.equal(result.bitDepth, 24);
    const probe = await probeMediaFile(outputPath);
    assert.equal(probe.audioCodec, "pcm_s24le");
    assert.equal(probe.audioBitDepth, 24);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unencodable codec and container pair fails with both values", () => {
  assert.throws(
    () => planMuxAudio({ audioCodec: "opus", containerFormat: "mp4" }),
    /opus[\s\S]*mp4/,
  );
  assert.throws(
    () => planMuxAudio({ audioCodec: "flac", containerFormat: "mov", audioBitrateKbps: 192 }),
    /flac[\s\S]*192/,
  );
  assert.throws(
    () => planMuxAudio({ audioCodec: "aac", containerFormat: "mp4", audioChannels: 3 }),
    /channel count 3/,
  );
});

test("a failed mux returns an error and leaves no artifact", async () => {
  const dir = await workDir();
  try {
    const outputPath = join(dir, "broken.mp4");
    const result = await muxAudioVideo({
      videoPath: join(dir, "missing.mp4"),
      audioBuffer: tone(0.5),
      outputPath,
      videoDuration: 0.5,
    });
    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.equal(existsSync(outputPath), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
