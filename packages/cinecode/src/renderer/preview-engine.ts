import type { Canvas } from "@napi-rs/canvas";
import type { Composition } from "../core/types/index.js";
import { createRenderSession, renderFrame, type RenderSessionState } from "./engine.js";
import { createRenderRuntime, type RenderRuntime } from "./runtime.js";
import { clampResolutionScale, qualityFromScale, type QualityLevel, type ResolutionScale } from "./scale.js";

export const EXPENSIVE_EFFECTS: readonly string[] = [
  "bloom",
  "depth-of-field",
  "dof",
  "optical-flow",
  "volumetric-lighting",
  "volumetric",
  "denoise",
  "raymarch",
  "raytrace",
];

export interface FastPreviewOptions {
  readonly seed?: number;
  readonly scale?: ResolutionScale | number;
  readonly bypassEffects?: boolean;
  readonly nearestNeighbor?: boolean;
}

export interface PreviewRenderResult {
  readonly canvas: Canvas;
  readonly frame: number;
  readonly time: number;
  readonly scale: ResolutionScale;
  readonly quality: QualityLevel;
  readonly renderTimeMs: number;
}

function isExpensive(name: string): boolean {
  const normalized = name.toLowerCase();
  return EXPENSIVE_EFFECTS.some((effect) => normalized === effect || normalized.includes(effect));
}

export function buildFastPreviewComposition(composition: Composition, _scale: number, bypassEffects = true): Composition {
  const scaled = composition;
  if (!bypassEffects) return scaled;
  const tracks = scaled.rootTimeline.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      const effects = (clip as { effects?: readonly { name: string }[] }).effects;
      if (!effects || effects.length === 0) return clip;
      return { ...clip, effects: effects.filter((effect) => !isExpensive(effect.name)) } as typeof clip;
    }),
  }) as typeof track);
  const postProcessing = scaled.postProcessing;
  return {
    ...scaled,
    rootTimeline: { ...scaled.rootTimeline, tracks },
    ...(postProcessing
      ? {
          postProcessing: {
            ...postProcessing,
            previewMode: true,
            effects: (postProcessing.effects ?? []).filter((effect) => !isExpensive(effect.name)),
          },
        }
      : {}),
  };
}

export class PreviewEngine {
  private readonly composition: Composition;
  private scale: ResolutionScale;
  private readonly seed: number;
  private readonly bypassEffects: boolean;
  private readonly runtime: RenderRuntime = createRenderRuntime(undefined, "preview");
  private readonly session: RenderSessionState = createRenderSession();

  constructor(composition: Composition, options: FastPreviewOptions = {}) {
    this.composition = composition;
    this.scale = clampResolutionScale(options.scale ?? 0.5);
    this.seed = options.seed ?? 0;
    this.bypassEffects = options.bypassEffects !== false;
  }

  setScale(scale: ResolutionScale | number): void {
    this.scale = clampResolutionScale(scale);
  }

  /** Releases this engine's canvases and caches; safe to call more than once. */
  dispose(): void {
    this.session.dispose();
  }

  getScale(): ResolutionScale {
    return this.scale;
  }

  getQuality(): QualityLevel {
    return qualityFromScale(this.scale);
  }

  async render(frame: number): Promise<PreviewRenderResult> {
    const started = Date.now();
    const fast = buildFastPreviewComposition(this.composition, this.scale, this.bypassEffects);
    const result = await renderFrame(fast, frame, this.seed, {
      runtime: this.runtime,
      resolutionScale: this.scale,
      session: this.session,
    });
    return {
      canvas: result.canvas,
      frame: result.frame,
      time: result.time,
      scale: this.scale,
      quality: qualityFromScale(this.scale),
      renderTimeMs: Date.now() - started,
    };
  }
}

export function createPreviewEngine(composition: Composition, options: FastPreviewOptions = {}): PreviewEngine {
  return new PreviewEngine(composition, options);
}

export function downscaleNearest(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x / scale));
      const sourceIndex = (sourceY * width + sourceX) * 4;
      const targetIndex = (y * targetWidth + x) * 4;
      output[targetIndex] = pixels[sourceIndex]!;
      output[targetIndex + 1] = pixels[sourceIndex + 1]!;
      output[targetIndex + 2] = pixels[sourceIndex + 2]!;
      output[targetIndex + 3] = pixels[sourceIndex + 3]!;
    }
  }
  return { data: output, width: targetWidth, height: targetHeight };
}
