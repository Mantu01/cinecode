import type { Composition, VisualClip } from "../core/types/index.js";
import type { FrameConversion } from "../core/time/index.js";
import { computeClipSpan } from "../core/validation/index.js";
import { createError, ErrorCode, recordDegradation } from "../errors/index.js";
import { resolveRegions, resolveLayout, drawRegionShadow, drawSourceIntoRegion, type SplitRegion } from "./pip.js";
import { createContext, clearCanvas } from "./composite/engine.js";
import { applyBlendMode } from "./shapes/index.js";
import { resolveBlendMode } from "./shapes-render.js";
import { applySkybox } from "./clip-3d.js";
import { drawClip } from "./clip-dispatch.js";
import { applyEffects, evaluateClipVisual, applyPostProcessing } from "./clip-effects.js";
import { renderSubtitleTracks } from "./clip-text.js";
import type { RenderContext, RenderResult } from "./engine-types.js";
import { getFallbackSession } from "./session.js";

export function splitRegionClip(
  composition: Composition,
  region: { readonly track?: string; readonly clipIndex: number },
  frame: number,
  conversion: FrameConversion,
  regionIndex: number,
): VisualClip | undefined {
  const tracks = composition.rootTimeline.tracks;
  const trackIndex =
    region.track !== undefined
      ? tracks.findIndex((track) => track.name === region.track)
      : region.clipIndex;
  const track = tracks[trackIndex];
  if (!track || track.kind === "audio" || track.kind === "subtitle") {
    recordDegradation({
      code: ErrorCode.CC3007,
      what: "split-screen region source missing",
      reason: region.track !== undefined ? `no track named "${region.track}"` : `no visual track at index ${region.clipIndex}`,
      input: `region ${regionIndex}`,
      instead: "the region renders empty",
    });
    return undefined;
  }
  const active = track.clips
    .map((clip, order) => ({ clip, order, span: computeClipSpan(clip as never, conversion) }))
    .filter((entry) => entry.span.startFrames <= frame && frame < entry.span.endFrames)
    .sort((a, b) => a.span.startFrames - b.span.startFrames || a.order - b.order);
  if (active.length === 0) {
    recordDegradation({
      code: ErrorCode.CC3007,
      what: "split-screen region has no active clip",
      reason: `track "${track.name ?? region.clipIndex}" is empty at frame ${frame}`,
      input: `region ${regionIndex}`,
      instead: "the region renders empty",
    });
    return undefined;
  }
  const selected = active[active.length - 1]!;
  if (active.length > 1) {
    recordDegradation({
      code: ErrorCode.CC3007,
      what: "split-screen region has several active clips",
      reason: `track "${track.name ?? region.clipIndex}" has ${active.length} active clips at frame ${frame}`,
      input: `region ${regionIndex}`,
      instead: `topmost clip "${selected.clip.name ?? selected.clip.type}" was used`,
    });
  }
  return selected.clip;
}

export async function renderSplitScreen(
  composition: Composition,
  context: RenderContext,
  seed: number,
  renderStandardFrameFallback: (composition: Composition, context: RenderContext, seed: number) => Promise<RenderResult>,
): Promise<RenderResult> {
  const config = composition.splitScreen;
  if (!config) {
    return renderStandardFrameFallback(composition, context, seed);
  }
  const regionsConfig: readonly SplitRegion[] =
    config.regions !== undefined && config.regions.length > 0
      ? config.regions
      : resolveLayout(config.layout, config.padding ?? 0);
  const regions = resolveRegions(
    composition.width,
    composition.height,
    regionsConfig,
    config.padding ?? 0,
  );
  const frame = context.frame;
  const targetCanvas = (context.session ?? getFallbackSession()).getRenderTarget(composition.width, composition.height);
  const targetCtx = createContext(targetCanvas);
  clearCanvas(targetCtx, composition.width, composition.height);
  await applySkybox(targetCtx, composition);
  const [bufA] = (context.session ?? getFallbackSession()).getDrawBuffers(composition.width, composition.height);

  for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
    const region = regions[regionIndex]!;
    const clip = splitRegionClip(composition, region, frame, context.conversion, regionIndex);
    if (clip === undefined) continue;
    drawRegionShadow(targetCtx, region);
    const clipCanvas = bufA;
    const clipCtx = createContext(clipCanvas);
    clearCanvas(clipCtx, composition.width, composition.height);
    await drawClip(clipCtx, clip, context, seed);
    const withEffects = applyEffects(clipCanvas, clip, context);
    const finalCanvas = evaluateClipVisual({ clipCanvas: withEffects, clip, context, underlying: null });
    targetCtx.save();
    applyBlendMode(targetCtx, resolveBlendMode(clip.blend));
    targetCtx.globalAlpha = clip.opacity ?? 1;
    drawSourceIntoRegion(targetCtx, finalCanvas, region);
    targetCtx.restore();
  }

  await renderSubtitleTracks(targetCtx, composition, context, seed);
  applyPostProcessing(targetCtx, composition, context, seed);
  return { canvas: targetCanvas, frame, time: context.time };
}
