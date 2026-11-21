import type { Canvas } from "@napi-rs/canvas";
import type { Clip, Composition, VisualClip } from "../core/types/index.js";
import { composition as makeComposition, timeline as makeTimeline, track as makeTrack } from "../core/clips/builders.js";
import { resolveImageEncoding, type ImageEncoding } from "../core/quality.js";
import { renderStill } from "./engine.js";

export interface RenderImageOptions {
  readonly width: number;
  readonly height: number;
  readonly background?: string;
  readonly seed?: number;
  /** Retina multiplier applied to width/height. */
  readonly scaleFactor?: number;
}

export interface RenderImageBufferOptions extends RenderImageOptions {
  readonly format?: "png" | "jpg" | "webp";
  /** 0-100, only used by jpg/webp. */
  readonly quality?: number;
}

function asVisual(clip: Clip): VisualClip {
  return { ...clip, start: 0, duration: 1 } as VisualClip;
}

/**
 * Normalizes an image's clips. A top-level `group` is flattened into its
 * children so layers use full composition coordinates instead of the group's
 * implicit 100×100 box.
 */
function normalizeImageClips(input: Clip | readonly Clip[]): VisualClip[] {
  const list = Array.isArray(input) ? input : [input as Clip];
  const out: VisualClip[] = [];
  for (const clip of list) {
    if (clip.type === "group") {
      for (const child of (clip as { children: readonly Clip[] }).children) {
        out.push(asVisual(child));
      }
    } else {
      out.push(asVisual(clip));
    }
  }
  return out;
}

/**
 * Wraps image clips in a one-frame composition and renders it. Reuses the
 * exact same 2D canvas pipeline as video frames — no timeline or muxer needed.
 */
export async function renderImageClip(
  input: Clip | readonly Clip[],
  options: RenderImageOptions,
): Promise<Canvas> {
  const scaleFactor = options.scaleFactor ?? 1;
  const width = Math.round(options.width * scaleFactor);
  const height = Math.round(options.height * scaleFactor);

  const composition: Composition = makeComposition({
    name: "image",
    width,
    height,
    fps: 1,
    background: options.background ?? "#000000",
    duration: 1,
    audio: { sampleRate: 48000, channels: 2, masterVolume: 1 },
    // One clip per track: image layers are all visible at once, and validation
    // (CC3001) flags simultaneous clips on a single track as overlaps. Track
    // order is preserved by the renderer, so z-order is unchanged.
    rootTimeline: makeTimeline(
      normalizeImageClips(input).map((clip, i) => makeTrack(`image-${i}`, [clip])),
    ),
  });

  return renderStill(composition, 0, options.seed ?? 0);
}

function canvasToBuffer(
  canvas: Canvas,
  encoding: Pick<ImageEncoding, "format" | "quality">,
): Buffer {
  const target = canvas as unknown as {
    toBuffer(mime: string, quality?: number): Buffer;
  };
  switch (encoding.format) {
    case "jpg":
      return target.toBuffer("image/jpeg", encoding.quality / 100);
    case "webp":
      return target.toBuffer("image/webp", encoding.quality / 100);
    case "png":
    default:
      return target.toBuffer("image/png");
  }
}

/** Renders image clips to an encoded image buffer (PNG/JPEG/WebP). */
export async function renderImageBuffer(
  input: Clip | readonly Clip[],
  options: RenderImageBufferOptions,
): Promise<Buffer> {
  const encoding = resolveImageEncoding({
    format: options.format,
    quality: options.quality,
    scaleFactor: options.scaleFactor,
  });
  const canvas = await renderImageClip(input, {
    ...options,
    scaleFactor: encoding.scaleFactor,
  });
  return canvasToBuffer(canvas, encoding);
}
