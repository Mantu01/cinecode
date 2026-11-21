import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Canvas, loadImage } from "@napi-rs/canvas";
import { resolveBinary } from "../../binary/resolver.js";
import { renderVideo, type RenderOptions } from "../index.js";
import type { Composition } from "../../core/types/index.js";
import {
  ALPHA_FORMATS,
  OUTPUT_FORMATS,
  OUTPUT_PLANS,
  resolveOutputPlan,
  type RenderFormat,
} from "../../core/output-plan.js";
import { encodeAnimatedGif, writeSpriteSheet } from "../../encoder/outputs.js";
import { PdfDocumentBuilder } from "../../pdf/index.js";
import { assertFormatFlags } from "../../cli/render.js";

const WIDTH = 64;
const HEIGHT = 48;
const FPS = 10;
const FRAMES = 4;

function composition(name = "formats", duration = FRAMES / FPS): Composition {
  return {
    name,
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    duration,
    background: "#000000",
    audio: { sampleRate: 48000, channels: 2, masterVolume: 1 },
    rootTimeline: {
      tracks: [
        {
          name: "visual",
          kind: "visual",
          clips: [
            { type: "solid", color: "#ff3355", width: 24, height: 24, start: 0, duration },
          ],
        },
      ],
    },
  };
}

interface RenderInput {
  readonly format: RenderFormat;
  readonly alpha?: boolean;
  readonly gifQuality?: number;
  readonly gifDither?: "floyd-steinberg" | "sierra-2" | "atkinson" | "none";
  readonly gifMaxFrames?: number;
  readonly frames?: number;
  readonly comp?: Composition;
}

async function render(input: RenderInput, dir: string): Promise<{ outputPath: string; result: Awaited<ReturnType<typeof renderVideo>> }> {
  const frames = input.frames ?? FRAMES;
  const outputPath = join(dir, `out.${input.format}`);
  const options: RenderOptions = {
    composition: input.comp ?? composition("formats", frames / FPS),
    outputPath,
    cacheDir: join(dir, "cache"),
    seed: 1,
    concurrency: 1,
    chunkSize: 2,
    quality: "preview",
    format: input.format,
    alpha: input.alpha,
    gifQuality: input.gifQuality,
    gifDither: input.gifDither,
    gifMaxFrames: input.gifMaxFrames,
    overwrite: true,
    fresh: true,
    noCache: true,
    silent: true,
  };
  const result = await renderVideo(options);
  return { outputPath, result };
}

async function withTemp<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "cinecode-formats-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function probe(file: string): { container: string; codec?: string; width?: number; height?: number; duration: number } {
  const result = spawnSync(
    resolveBinary("ffprobe").path,
    ["-v", "error", "-show_entries", "format=format_name,duration:stream=codec_name,width,height", "-of", "json", file],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    streams?: { codec_name?: string; width?: number; height?: number }[];
    format?: { format_name?: string; duration?: string };
  };
  const stream = parsed.streams?.[0] ?? {};
  return {
    container: parsed.format?.format_name ?? "",
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    duration: Number(parsed.format?.duration ?? 0),
  };
}

function decodeAll(file: string, width = WIDTH, height = HEIGHT): { count: number; frame: Buffer } {
  const result = spawnSync(
    resolveBinary("ffmpeg").path,
    ["-v", "error", "-i", file, "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr.toString());
  const frameBytes = width * height * 4;
  return { count: Math.floor(result.stdout.length / frameBytes), frame: result.stdout.subarray(0, frameBytes) };
}

/** Decodes frame 0 to PNG and reads the alpha channel back through the canvas. */
async function alphaRange(file: string, dir: string, decoder?: string): Promise<{ transparent: boolean; opaque: boolean }> {
  const target = join(dir, "alpha-probe.png");
  const result = spawnSync(
    resolveBinary("ffmpeg").path,
    ["-v", "error", "-y", ...(decoder ? ["-c:v", decoder] : []), "-i", file, "-frames:v", "1", "-pix_fmt", "rgba", target],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const image = await loadImage(await readFile(target));
  const canvas = new Canvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  let transparent = false;
  let opaque = false;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index]! < 16) transparent = true;
    if (data[index]! > 240) opaque = true;
  }
  return { transparent, opaque };
}

function magic(buffer: Buffer, bytes: number[]): boolean {
  return bytes.every((byte, index) => buffer[index] === byte);
}

test("one table defines every format and rejects impossible requests", () => {
  for (const format of OUTPUT_FORMATS) {
    const plan = OUTPUT_PLANS[format];
    assert.equal(plan.format, format);
    assert.ok(plan.description.length > 0, format);
    assert.ok(plan.codecs.length > 0 || plan.strategy !== "stream", format);
    assert.ok(plan.alpha || plan.alphaPixFmt === undefined, format);
    if (plan.strategy === "stream") assert.ok(plan.muxer, format);
  }
  assert.deepEqual([...ALPHA_FORMATS].sort(), ["apng", "png", "prores", "prores-alpha", "webm", "webm-alpha", "webp"].sort());

  assert.throws(() => resolveOutputPlan({ format: "mp4", alpha: true }), (error: { code?: string }) => error.code === "CC1008");
  assert.throws(() => resolveOutputPlan({ format: "gif", codec: "h264" }), (error: { code?: string }) => error.code === "CC1008");
  assert.throws(() => resolveOutputPlan({ format: "mp4", codec: "vp9" }), (error: { code?: string }) => error.code === "CC1008");

  const alpha = resolveOutputPlan({ format: "webm", alpha: true });
  assert.equal(alpha.alpha, true);
  assert.equal(alpha.inputPixFmt, "rgba");
  assert.equal(resolveOutputPlan({ format: "mp4" }).inputPixFmt, "rgb0");
  assert.equal(resolveOutputPlan({ format: "apng" }).alpha, true);
});

test("streamed formats write the container, codec and duration the table promises", async () => {
  await withTemp(async (dir) => {
    const expected: Record<string, { container: string; codec: string }> = {
      mp4: { container: "mov,mp4,m4a,3gp,3g2,mj2", codec: "h264" },
      webm: { container: "matroska,webm", codec: "vp9" },
      mkv: { container: "matroska,webm", codec: "h264" },
      avi: { container: "avi", codec: "h264" },
      prores: { container: "mov,mp4,m4a,3gp,3g2,mj2", codec: "prores" },
    };
    for (const [format, want] of Object.entries(expected)) {
      const { outputPath } = await render({ format: format as RenderFormat }, dir);
      const info = probe(outputPath);
      assert.equal(info.container, want.container, format);
      assert.equal(info.codec, want.codec, format);
      assert.equal(info.width, WIDTH, format);
      assert.equal(info.height, HEIGHT, format);
      assert.ok(Math.abs(info.duration - FRAMES / FPS) < 0.2, `${format} duration ${info.duration}`);
    }
  });
});

test("gif and apng carry the planned frame count and stay decodable", async () => {
  await withTemp(async (dir) => {
    for (const format of ["gif", "apng"] as const) {
      const { outputPath, result } = await render({ format }, dir);
      const decoded = decodeAll(outputPath);
      assert.equal(decoded.count, FRAMES, format);
      assert.equal(result.frames, FRAMES, format);
      const head = await readFile(outputPath);
      assert.ok(magic(head, format === "gif" ? [0x47, 0x49, 0x46, 0x38] : [0x89, 0x50, 0x4e, 0x47]), format);
    }
  });
});

test("png sequence is a directory of zero-based indexed frames", async () => {
  await withTemp(async (dir) => {
    const { outputPath, result } = await render({ format: "png" }, dir);
    const files = (await readdir(outputPath)).sort();
    assert.deepEqual(files, ["frame-00000.png", "frame-00001.png", "frame-00002.png", "frame-00003.png"]);
    assert.equal(result.frames, FRAMES);
    const first = await readFile(join(outputPath, "frame-00000.png"));
    assert.ok(magic(first, [0x89, 0x50, 0x4e, 0x47]));
  });
});

test("pdf output is one page per frame with document metadata and real duration", async () => {
  await withTemp(async (dir) => {
    const { outputPath, result } = await render({ format: "pdf" }, dir);
    const buffer = await readFile(outputPath);
    assert.ok(magic(buffer, [0x25, 0x50, 0x44, 0x46]));
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(buffer);
    assert.equal(doc.getPageCount(), FRAMES);
    assert.equal(result.pages, FRAMES);
    assert.equal(result.frames, FRAMES);
    assert.ok(Math.abs(result.duration - FRAMES / FPS) < 1e-6, String(result.duration));
    assert.equal(doc.getTitle(), "formats");
    assert.match(doc.getSubject() ?? "", new RegExp(`^${FRAMES} pages at ${WIDTH}x${HEIGHT}px$`));
  });
});

test("still formats write their planned extension, not a video container", async () => {
  await withTemp(async (dir) => {
    const checks: Record<string, number[]> = {
      jpg: [0xff, 0xd8, 0xff],
      webp: [0x52, 0x49, 0x46, 0x46],
    };
    for (const [format, prefix] of Object.entries(checks)) {
      const { outputPath, result } = await render({ format: format as RenderFormat }, dir);
      const buffer = await readFile(outputPath);
      assert.ok(magic(buffer, prefix), format);
      assert.equal(result.frames, 1, format);
      assert.equal((await stat(outputPath)).size > 0, true, format);
    }
  });
});

test("alpha survives to a decoded frame for every alpha format", async () => {
  await withTemp(async (dir) => {
    const cases = [
      { format: "png" as const, decoder: undefined },
      { format: "apng" as const, decoder: undefined },
      { format: "prores-alpha" as const, decoder: undefined },
      { format: "webm-alpha" as const, decoder: "libvpx-vp9" },
    ];
    for (const { format, decoder } of cases) {
      const { outputPath } = await render({ format }, dir);
      const file = format === "png" ? join(outputPath, "frame-00000.png") : outputPath;
      const range = await alphaRange(file, dir, decoder);
      assert.ok(range.transparent, `${format} should keep transparent pixels`);
      assert.ok(range.opaque, `${format} should keep an opaque clip`);
    }
  });
});

test("format-only flags conflict before rendering instead of being ignored", () => {
  assert.throws(
    () => assertFormatFlags("mp4", { gifQuality: 4 }),
    (error: { code?: string; message?: string }) => error.code === "CC1012" && /--gif-quality/.test(error.message ?? ""),
  );
  assert.throws(
    () => assertFormatFlags("png", { gifMaxFrames: 4 }),
    (error: { code?: string }) => error.code === "CC1012",
  );
  assert.throws(
    () => assertFormatFlags("pdf", { twoPass: true }),
    (error: { code?: string }) => error.code === "CC1012",
  );
  assert.doesNotThrow(() => assertFormatFlags("gif", { gifQuality: 4, gifDither: "none", gifMaxFrames: 3 }));
  assert.doesNotThrow(() => assertFormatFlags("mp4", { twoPass: true }));
});

test("alpha is rejected for formats that cannot carry it, before rendering", async () => {
  await withTemp(async (dir) => {
    for (const format of ["mp4", "gif", "jpg", "pdf"] as const) {
      await assert.rejects(
        render({ format, alpha: true }, dir),
        (error: { code?: string; message?: string }) => {
          assert.equal(error.code, "CC1008", format);
          assert.match(error.message ?? "", new RegExp(format));
          return true;
        },
      );
      await assert.rejects(stat(join(dir, `out.${format}`)));
    }
  });
});

test("gif flags reach the encoder", async () => {
  await withTemp(async (dir) => {
    const capped = await render({ format: "gif", gifMaxFrames: 2 }, dir);
    assert.equal(decodeAll(capped.outputPath).count, 2);

    const frames = noiseFrames(6, 64);
    const none = join(dir, "none.gif");
    const floyd = join(dir, "floyd.gif");
    const low = join(dir, "low.gif");
    const high = join(dir, "high.gif");
    const written = await encodeAnimatedGif(frames, none, { fps: 10, overwrite: true, dither: "none" });
    assert.equal(written.frames, 6);
    await encodeAnimatedGif(frames, floyd, { fps: 10, overwrite: true, dither: "floyd-steinberg" });
    await encodeAnimatedGif(frames, low, { fps: 10, overwrite: true, quality: 1 });
    await encodeAnimatedGif(frames, high, { fps: 10, overwrite: true, quality: 8 });
    assert.notDeepEqual(await readFile(none), await readFile(floyd));
    assert.notDeepEqual(await readFile(low), await readFile(high));
  });
});

test("sprite sheet batches frames and writes sidecar metadata", async () => {
  await withTemp(async (dir) => {
    const frames = noiseFrames(6, 32);
    const atlas = join(dir, "sheet.png");
    const result = await writeSpriteSheet(frames, atlas, { frameCount: 6, columns: 3, overwrite: true });
    assert.equal(result.success, true, result.error);
    assert.equal(result.frames, 6);
    assert.equal(result.columns, 3);
    assert.equal(result.rows, 2);
    assert.equal(result.cellWidth, 32);
    assert.equal(result.width, 96);
    assert.equal(result.height, 64);
    const meta = JSON.parse(await readFile(result.metadataPath, "utf8")) as {
      width: number;
      height: number;
      frames: { index: number; x: number; y: number; w: number; h: number }[];
    };
    assert.equal(meta.width, 96);
    assert.equal(meta.height, 64);
    assert.deepEqual(meta.frames.map((f) => [f.index, f.x, f.y]), [[0, 0, 0], [1, 32, 0], [2, 64, 0], [3, 0, 32], [4, 32, 32], [5, 64, 32]]);
    assert.ok(magic(await readFile(atlas), [0x89, 0x50, 0x4e, 0x47]));
  });
});

function noiseFrames(count: number, size: number): Buffer[] {
  const canvas = new Canvas(size, size);
  const ctx = canvas.getContext("2d");
  const frames: Buffer[] = [];
  let seed = 0x9e3779b9;
  const next = (): number => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
  for (let index = 0; index < count; index += 1) {
    const image = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i += 1) {
      const value = next();
      image.data[i * 4] = value & 0xff;
      image.data[i * 4 + 1] = (value >>> 8) & 0xff;
      image.data[i * 4 + 2] = (value >>> 16) & 0xff;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    frames.push(canvas.toBuffer("image/png"));
  }
  return frames;
}

function rssMb(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

test("long gif and apng encodes keep memory bounded", async () => {
  const size = 320;
  const count = 24;
  const frames = noiseFrames(count, size);
  const inputMb = frames.reduce((total, frame) => total + frame.length, 0) / (1024 * 1024);
  assert.ok(inputMb > 3, `expected a meaningful payload, got ${inputMb.toFixed(1)}MB`);

  await withTemp(async (dir) => {
    const before = rssMb();
    const gif = join(dir, "long.gif");
    const gifResult = await encodeAnimatedGif(frames, gif, { fps: 10, overwrite: true });
    assert.equal(gifResult.success, true, gifResult.error);
    assert.equal(gifResult.frames, count);
    const afterGif = rssMb();
    assert.ok(afterGif - before < 30, `gif grew rss by ${(afterGif - before).toFixed(1)}MB for ${inputMb.toFixed(1)}MB of frames`);

    const { encodeAnimatedPng } = await import("../../encoder/outputs.js");
    const apng = join(dir, "long.apng");
    const apngResult = await encodeAnimatedPng(frames, apng, { fps: 10, overwrite: true });
    assert.equal(apngResult.success, true, apngResult.error);
    assert.equal(apngResult.frames, count);
    const afterApng = rssMb();
    assert.ok(afterApng - afterGif < 30, `apng grew rss by ${(afterApng - afterGif).toFixed(1)}MB`);
  });
});

test("long pdf assembly keeps memory bounded and reports pages", async () => {
  const size = 256;
  const count = 40;
  const frames = noiseFrames(count, size);
  const inputMb = frames.reduce((total, frame) => total + frame.length, 0) / (1024 * 1024);
  assert.ok(inputMb > 4, `expected a meaningful payload, got ${inputMb.toFixed(1)}MB`);

  await withTemp(async (dir) => {
    const before = rssMb();
    const builder = await PdfDocumentBuilder.create({ width: size, height: size, title: "long" });
    for (const frame of frames) await builder.addPngFrame(frame);
    const built = await builder.finish();
    assert.equal(built.pages, count);
    const grew = rssMb() - before;
    assert.ok(grew < 30, `pdf assembly grew rss by ${grew.toFixed(1)}MB`);
    assert.ok(built.buffer.length > 0);
  });
});
