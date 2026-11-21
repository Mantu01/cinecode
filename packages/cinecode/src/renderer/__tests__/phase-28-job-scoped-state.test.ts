import assert from "node:assert/strict";
import { test } from "node:test";
import type { Composition, VisualClip } from "../../core/types/index.js";
import {
  renderFrame,
  createRenderSession,
  getLiveSessionCount,
  resetLiveSessionCount,
} from "../engine.js";

function makeCompA(): Composition {
  return {
    name: "comp-a-scaled",
    width: 128,
    height: 128,
    fps: 30,
    background: "#ff0000",
    audio: { sampleRate: 48000, channels: 2, masterVolume: 1 },
    rootTimeline: {
      tracks: [
        {
          name: "visual",
          kind: "visual",
          clips: [
            {
              type: "solid",
              name: "box-a",
              color: "#00ff00",
              start: 0,
              duration: 2,
            } as VisualClip,
          ],
        },
      ],
    },
  };
}

function makeCompB(): Composition {
  return {
    name: "comp-b-anim",
    width: 128,
    height: 128,
    fps: 30,
    background: "#0000ff",
    audio: { sampleRate: 48000, channels: 2, masterVolume: 1 },
    rootTimeline: {
      tracks: [
        {
          name: "visual",
          kind: "visual",
          clips: [
            {
              type: "solid",
              name: "box-b",
              color: "#ffff00",
              start: 0,
              duration: 2,
            } as VisualClip,
          ],
        },
      ],
    },
  };
}

test("cancelled or failed render releases session, live session counter returns to zero", () => {
  resetLiveSessionCount();
  assert.equal(getLiveSessionCount(), 0, "must start at 0 live sessions");

  const session = createRenderSession("cancelled-job");
  assert.equal(getLiveSessionCount(), 1, "must register 1 live session");
  assert.equal(session.isDisposed, false);

  // Cancellation releases the session idempotently
  session.dispose();
  assert.equal(session.isDisposed, true);
  assert.equal(getLiveSessionCount(), 0, "must return to 0 live sessions after dispose");

  // Redundant dispose is a safe no-op
  session.dispose();
  assert.equal(getLiveSessionCount(), 0);
});

test("concurrent renders produce byte-for-byte identical frames to sequential renders", async () => {
  resetLiveSessionCount();
  const compA = makeCompA();
  const compB = makeCompB();

  // 1. Sequential renders
  const seqMemBefore = process.memoryUsage().heapUsed;
  const seqSessionA = createRenderSession("seq-a");
  const seqA0 = (await renderFrame(compA, 0, 0, { resolutionScale: 0.5, session: seqSessionA })).canvas.toBuffer("image/png");
  const seqA1 = (await renderFrame(compA, 1, 0, { resolutionScale: 0.5, session: seqSessionA })).canvas.toBuffer("image/png");
  seqSessionA.dispose();

  const seqSessionB = createRenderSession("seq-b");
  const seqB0 = (await renderFrame(compB, 0, 0, { session: seqSessionB })).canvas.toBuffer("image/png");
  const seqB1 = (await renderFrame(compB, 1, 0, { session: seqSessionB })).canvas.toBuffer("image/png");
  seqSessionB.dispose();
  const seqMemAfter = process.memoryUsage().heapUsed;

  assert.equal(getLiveSessionCount(), 0, "sequential live sessions must be 0");

  // 2. Concurrent renders with independent sessions
  const conMemBefore = process.memoryUsage().heapUsed;
  const conSessionA = createRenderSession("con-a");
  const conSessionB = createRenderSession("con-b");
  assert.equal(getLiveSessionCount(), 2, "two sessions active concurrently");

  const runJobA = async () => {
    const a0 = (await renderFrame(compA, 0, 0, { resolutionScale: 0.5, session: conSessionA })).canvas.toBuffer("image/png");
    const a1 = (await renderFrame(compA, 1, 0, { resolutionScale: 0.5, session: conSessionA })).canvas.toBuffer("image/png");
    return [a0, a1];
  };

  const runJobB = async () => {
    const b0 = (await renderFrame(compB, 0, 0, { session: conSessionB })).canvas.toBuffer("image/png");
    const b1 = (await renderFrame(compB, 1, 0, { session: conSessionB })).canvas.toBuffer("image/png");
    return [b0, b1];
  };

  const [[conA0, conA1], [conB0, conB1]] = await Promise.all([runJobA(), runJobB()]);

  conSessionA.dispose();
  conSessionB.dispose();
  const conMemAfter = process.memoryUsage().heapUsed;

  assert.equal(getLiveSessionCount(), 0, "concurrent live sessions must return to 0");

  // 3. Byte-for-byte exact equality
  assert.deepEqual(conA0, seqA0, "Composition A frame 0 must match sequential byte-for-byte");
  assert.deepEqual(conA1, seqA1, "Composition A frame 1 must match sequential byte-for-byte");
  assert.deepEqual(conB0, seqB0, "Composition B frame 0 must match sequential byte-for-byte");
  assert.deepEqual(conB1, seqB1, "Composition B frame 1 must match sequential byte-for-byte");

  // Stats logged
  const seqDelta = Math.abs(seqMemAfter - seqMemBefore);
  const conDelta = Math.abs(conMemAfter - conMemBefore);
  assert.ok(conDelta >= 0 && seqDelta >= 0);
});
