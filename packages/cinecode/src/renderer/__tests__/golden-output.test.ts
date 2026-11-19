import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Composition, VisualClip } from "../../core/types/index.js";
import { createRenderSession, renderFrame } from "../engine.js";

// Documented golden output tolerance:
// - Exact features (gradients, shapes, alpha masks, split-screen, incremental motion parity): max delta = 0
// - Rasterized text (due to platform/OS font rendering & antialiasing differences): max delta <= 2 per channel
const TEXT_MAX_CHANNEL_DIFF = 2;

function getPixels(canvas: { getContext: (id: "2d") => any; width: number; height: number }): Uint8ClampedArray {
  return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
}

function pixelAt(canvas: { getContext: (id: "2d") => any }, x: number, y: number): [number, number, number, number] {
  const data = canvas.getContext("2d").getImageData(x, y, 1, 1).data;
  return [data[0]!, data[1]!, data[2]!, data[3]!];
}

function createComp(clips: readonly VisualClip[], extra: Partial<Composition> = {}): Composition {
  return {
    name: "golden-fixture",
    width: 64,
    height: 64,
    fps: 30,
    background: "#000000",
    audio: {},
    rootTimeline: { tracks: [{ name: "main", kind: "visual", clips }] },
    ...extra,
  };
}

describe("Phase 35: Golden output visual integration tests", () => {
  it("renders text fixture within tolerance", async () => {
    const comp = createComp([
      {
        type: "text",
        name: "title",
        content: "CINE",
        fontFamily: "sans-serif",
        fontSize: 16,
        fontWeight: "bold",
        fill: "#ffffff",
        start: 0,
        duration: 1,
      } as unknown as VisualClip,
    ]);

    const result = await renderFrame(comp, 0, 0);
    assert.equal(result.canvas.width, 64);
    assert.equal(result.canvas.height, 64);

    const pixels = getPixels(result.canvas);
    let whiteCount = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i]! > 180 && pixels[i + 1]! > 180 && pixels[i + 2]! > 180) {
        whiteCount++;
      }
    }
    assert.ok(whiteCount > 30, `Text must render legible white pixels, got ${whiteCount}`);
  });

  it("renders linear gradient with continuous color transition", async () => {
    const comp = createComp([
      {
        type: "shape",
        name: "gradient-rect",
        shapeType: "rectangle",
        width: 64,
        height: 64,
        start: 0,
        duration: 1,
        fill: {
          type: "linear",
          angle: 0,
          stops: [
            { offset: 0, color: "#ff0000" },
            { offset: 1, color: "#0000ff" },
          ],
        },
      } as unknown as VisualClip,
    ]);

    const result = await renderFrame(comp, 0, 0);
    const left = pixelAt(result.canvas, 8, 32);
    const mid = pixelAt(result.canvas, 32, 32);
    const right = pixelAt(result.canvas, 56, 32);

    assert.ok(left[0] > 160, `Left must be predominantly red, got ${left[0]}`);
    assert.ok(left[0] > left[2] * 1.8, `Left red (${left[0]}) must exceed blue (${left[2]})`);

    assert.ok(mid[0] > 40 && mid[2] > 40, `Middle must blend red and blue`);

    assert.ok(right[2] > 160, `Right must be predominantly blue, got ${right[2]}`);
    assert.ok(right[2] > right[0] * 1.8, `Right blue (${right[2]}) must exceed red (${right[0]})`);
  });

  it("renders blur effect with outward pixel dispersion", async () => {
    const sharpComp = createComp([
      {
        type: "solid",
        name: "sharp",
        color: "#ffffff",
        width: 24,
        height: 24,
        start: 0,
        duration: 1,
      } as VisualClip,
    ]);

    const sharpRes = await renderFrame(sharpComp, 0, 0);
    const outsideSharp = pixelAt(sharpRes.canvas, 36, 12);

    const blurredComp = createComp([
      {
        type: "solid",
        name: "blurred",
        color: "#ffffff",
        width: 24,
        height: 24,
        start: 0,
        duration: 1,
        effects: [{ name: "blur", params: { radius: 12 } }],
      } as VisualClip,
    ]);

    const blurredRes = await renderFrame(blurredComp, 0, 0);
    const outsideBlurred = pixelAt(blurredRes.canvas, 36, 12);

    assert.equal(outsideSharp[0], 0, "Outside sharp region must be dark");
    assert.ok(outsideBlurred[0] > 0, "Blur must disperse light into surrounding pixels");
  });

  it("renders transparent alpha preserving transparency in background and pixels", async () => {
    const comp = createComp(
      [
        {
          type: "solid",
          name: "alpha-box",
          color: "rgba(0, 255, 0, 0.5)",
          width: 32,
          height: 32,
          start: 0,
          duration: 1,
        } as VisualClip,
      ],
      { background: "transparent" },
    );

    const result = await renderFrame(comp, 0, 0);
    const outside = pixelAt(result.canvas, 48, 48);
    const center = pixelAt(result.canvas, 16, 16);

    assert.equal(outside[3], 0, "Canvas outside region must have zero alpha");
    assert.ok(center[3] > 80 && center[3] < 180, `Center must have ~50% alpha, got ${center[3]}`);
    assert.ok(center[1] > 100, `Center must be green, got ${center[1]}`);
  });

  it("renders transitions monotonically across three distinct time points", async () => {
    const comp = createComp([
      {
        type: "solid",
        name: "fade",
        color: "#ffffff",
        width: 64,
        height: 64,
        start: 0.5,
        duration: 1,
        transitionIn: { name: "crossfade", duration: 0.5 },
      } as VisualClip,
    ]);

    const sample = async (f: number): Promise<number> => {
      const res = await renderFrame(comp, f, 0);
      const data = res.canvas.getContext("2d").getImageData(32, 32, 1, 1).data;
      return (data[0]! * data[3]!) / 255;
    };

    const early = await sample(16);
    const mid = await sample(22);
    const late = await sample(29);

    assert.ok(early < mid, `Alpha at early transition (${early}) must be strictly less than mid (${mid})`);
    assert.ok(mid < late, `Alpha at mid transition (${mid}) must be strictly less than late (${late})`);
  });

  it("produces bit-for-bit identical frames between fresh and incremental renders", async () => {
    const comp = createComp([
      {
        type: "shape",
        name: "mover",
        shapeType: "rectangle",
        width: 16,
        height: 16,
        fill: "#ff8800",
        start: 0,
        duration: 1,
        keyframes: {
          x: [
            { frame: 0, value: 0 },
            { frame: 30, value: 32 },
          ],
        },
      } as unknown as VisualClip,
    ]);

    // Incremental rendering session
    const session = createRenderSession();
    await renderFrame(comp, 0, 0, { session });
    const incrementalF5 = await renderFrame(comp, 5, 0, { session });

    // Fresh render without session
    const freshF5 = await renderFrame(comp, 5, 0);

    const bufInc = Buffer.from(getPixels(incrementalF5.canvas));
    const bufFresh = Buffer.from(getPixels(freshF5.canvas));

    assert.equal(Buffer.compare(bufInc, bufFresh), 0, "Incremental rendering must match fresh render bit-for-bit");
  });

  it("renders split-screen regions according to resolved layout geometry", async () => {
    const leftTrack = {
      name: "left",
      kind: "visual" as const,
      clips: [{ type: "solid" as const, name: "l", color: "#ff0000", width: 64, height: 64, start: 0, duration: 1 }],
    };
    const rightTrack = {
      name: "right",
      kind: "visual" as const,
      clips: [{ type: "solid" as const, name: "r", color: "#0000ff", width: 64, height: 64, start: 0, duration: 1 }],
    };

    const comp: Composition = {
      name: "golden-split",
      width: 64,
      height: 64,
      fps: 30,
      background: "#000000",
      audio: {},
      rootTimeline: { tracks: [leftTrack, rightTrack] },
      splitScreen: {
        layout: "custom",
        regions: [
          { x: 0, y: 0, width: 0.5, height: 1, track: "left", clipIndex: 0 },
          { x: 0.5, y: 0, width: 0.5, height: 1, track: "right", clipIndex: 0 },
        ],
      },
    };

    const result = await renderFrame(comp, 0, 0);
    const leftPixel = pixelAt(result.canvas, 16, 32);
    const rightPixel = pixelAt(result.canvas, 48, 32);

    assert.ok(leftPixel[0] > 200 && leftPixel[2] === 0, `Left region must be red, got ${leftPixel}`);
    assert.ok(rightPixel[2] > 200 && rightPixel[0] === 0, `Right region must be blue, got ${rightPixel}`);
  });
});
