import type { SKRSContext2D } from "@napi-rs/canvas";
import type { AudioVisualizerClip, AudioTrack, AudioClip } from "../core/types/index.js";
import type { FrameConversion } from "../core/time/index.js";
import { computeClipSpan } from "../core/validation/index.js";
import {
  layoutBars,
  layoutWaveform,
  layoutRadial,
  resolveAudioTrack,
  smoothBands,
  type VisualizerLayout,
} from "../audio/visualizer.js";
import {
  getAnalysisBuffer,
  extractVisualizerSample,
} from "../audio/visualizerSample.js";
import { fft, magnitude, extractBands, extractBandsLogarithmic } from "../audio/fft.js";
import { createDefaultTransform, applyTransform, type ShapeDrawParams } from "./shapes/index.js";
import type { RenderContext } from "./engine-types.js";

const FFT_WINDOW_SIZE = 2048;
const smoothingState = new WeakMap<object, Float32Array>();

export function buildVisualizerLayout(
  clip: AudioVisualizerClip,
  bands: Float32Array,
  width: number,
  height: number,
): VisualizerLayout {
  const options = { barWidth: clip.barWidth, barGap: clip.barGap, mirror: clip.mirror };
  switch (clip.vizType) {
    case "bars":
      return layoutBars(bands, width, height, options);
    case "waveform":
      return layoutWaveform(bands, width, height, options);
    case "radial":
      return layoutRadial(bands, width, height, options, "radial");
    case "circular":
      return layoutRadial(bands, width, height, options, "circular");
  }
}

export async function drawAudioVisualizerClip(
  ctx: SKRSContext2D,
  clip: AudioVisualizerClip,
  params: ShapeDrawParams,
  context: RenderContext,
): Promise<void> {
  const width = Math.max(1, Math.round(clip.width ?? context.width));
  const height = Math.max(1, Math.round(clip.height ?? context.height));
  const bands = await computeVisualizerBands(clip, context);
  const layout = buildVisualizerLayout(clip, bands, width, height);
  ctx.save();
  applyTransform(ctx, { ...createDefaultTransform(), ...params.transform }, width, height);
  ctx.globalAlpha = params.opacity ?? 1;
  const color = clip.fill ?? "#ffffff";
  if (layout.bars !== undefined) {
    ctx.fillStyle = color;
    for (const bar of layout.bars) {
      if (bar.height <= 0) continue;
      ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
    }
  } else if (layout.waveform !== undefined) {
    drawWaveformPath(ctx, layout.waveform, color);
  } else if (layout.radial !== undefined) {
    drawRadialLines(ctx, layout, color, width, height);
  }
  ctx.restore();
}

export async function computeVisualizerBands(
  clip: AudioVisualizerClip,
  context: RenderContext,
): Promise<Float32Array> {
  const bandCount = Math.max(1, clip.barCount ?? 32);
  const empty = new Float32Array(bandCount);
  const track = resolveAudioTrack(clip.trackRef, context.composition.rootTimeline);
  if (track === undefined) {
    throw new Error(`Audio visualizer references unknown audio track: ${clip.trackRef}`);
  }
  const span = computeClipSpan(clip, context.conversion);
  const activeClip = findActiveAudioClip(
    track,
    context.frame,
    span.startFrames,
    span.endFrames,
    context.conversion,
  );
  if (activeClip === undefined) return empty;
  const buffer = await getAnalysisBuffer(activeClip.src);
  if (buffer === undefined) return empty;
  const sampleTime =
    (context.frame - span.startFrames) / context.conversion.fpsFloat +
    (typeof activeClip.trimStart === "number" ? activeClip.trimStart : 0);
  const window = extractVisualizerSample(buffer, sampleTime * buffer.sampleRate, FFT_WINDOW_SIZE);
  const mags = magnitude(fft(window));
  const bands =
    clip.frequencyScale === "logarithmic"
      ? extractBandsLogarithmic(mags, bandCount, buffer.sampleRate)
      : extractBands(mags, bandCount, buffer.sampleRate);

  if ((clip.smoothing ?? 0) > 0) {
    const previous = smoothingState.get(clip);
    const smoothed = smoothBands(bands, previous, clip.smoothing ?? 0);
    smoothingState.set(clip, smoothed);
    return smoothed;
  }
  smoothingState.delete(clip);
  return bands;
}

export function findActiveAudioClip(
  track: AudioTrack,
  frame: number,
  visualizerStart: number,
  visualizerEnd: number,
  conversion: FrameConversion,
): AudioClip | undefined {
  for (const clip of track.clips) {
    if (clip.type !== "audio") continue;
    const span = computeClipSpan(clip, conversion);
    if (
      span.startFrames <= frame &&
      frame < span.endFrames &&
      span.startFrames >= visualizerStart - 1 &&
      span.endFrames <= visualizerEnd + 1
    ) {
      return clip;
    }
  }
  return undefined;
}

export function drawWaveformPath(
  ctx: SKRSContext2D,
  points: readonly { x: number; y: number }[],
  color: string,
): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i]!.x, points[i]!.y);
  }
  ctx.stroke();
}

export function drawRadialLines(
  ctx: SKRSContext2D,
  layout: VisualizerLayout,
  color: string,
  width: number,
  height: number,
): void {
  const radial = layout.radial;
  if (radial === undefined || radial.length === 0) return;
  const isCircular = layout.type === "circular";
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  if (isCircular) {
    ctx.beginPath();
    ctx.moveTo(radial[0]!.x, radial[0]!.y);
    for (let i = 1; i < radial.length; i += 1) {
      ctx.lineTo(radial[i]!.x, radial[i]!.y);
    }
    ctx.closePath();
    ctx.stroke();
    return;
  }
  const cx = width / 2;
  const cy = height / 2;
  for (const point of radial) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }
}
