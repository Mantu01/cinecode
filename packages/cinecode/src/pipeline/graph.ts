import type { Composition, VisualClip, EffectRef } from "../core/types/index.js";
import { createConversion } from "../core/time/index.js";
import { computeClipSpan } from "../core/validation/index.js";

export interface RenderGraphNode {
  readonly type: "clip";
  readonly clip: VisualClip;
  readonly trackIndex: number;
  readonly clipIndex: number;
  readonly frame: number;
  readonly time: number;
  readonly span: { readonly startFrames: number; readonly endFrames: number };
  readonly keyframeValues: ReadonlyMap<string, unknown>;
  readonly activeEffects: readonly EffectRef[];
  readonly transitionIn: VisualClip["transitionIn"] | null;
  readonly opacity: number;
  readonly blendMode: string;
}

export interface RenderGraphFrame {
  readonly frame: number;
  readonly time: number;
  readonly nodes: readonly RenderGraphNode[];
  readonly background: string;
  readonly width: number;
  readonly height: number;
}

export interface RenderGraph {
  readonly composition: Composition;
  readonly frames: readonly RenderGraphFrame[];
  readonly totalFrames: number;
  readonly duration: number;
  readonly fps: number;
}

type KeyframeTuple = readonly [time: number, value: unknown] | readonly [time: number, value: unknown, unknown];

function extractKeyframeValues(clip: VisualClip, frame: number, conversion: ReturnType<typeof createConversion>): Map<string, unknown> {
  const values = new Map<string, unknown>();

  const keyframes = clip.keyframes ?? {};
  for (const [property, kfArray] of Object.entries(keyframes)) {
    const arr = kfArray as unknown as KeyframeTuple[];
    if (!arr || arr.length === 0) continue;

    let value: unknown;
    for (let i = 0; i < arr.length; i++) {
      const kf = arr[i];
      if (!kf) continue;
      const kfTime = typeof kf[0] === "number" ? kf[0] : parseFloat(kf[0] as string);
      const kfFrame = Math.round(kfTime * conversion.fpsFloat);
      if (frame < kfFrame) break;
      value = kf[1];
    }
    if (value !== undefined) {
      values.set(property, value);
    }
  }

  return values;
}

function getActiveEffects(clip: VisualClip, frame: number, conversion: ReturnType<typeof createConversion>): EffectRef[] {
  if (!clip.effects || clip.effects.length === 0) return [];

  const active: EffectRef[] = [];
  for (const effectRef of clip.effects) {
    if (effectRef.enabled === false) continue;

    let isActive = true;
    if (effectRef.from !== undefined) {
      const startFrame = typeof effectRef.from === "number"
        ? effectRef.from
        : Math.round(parseFloat(effectRef.from as string) * conversion.fpsFloat);
      if (frame < startFrame) isActive = false;
    }
    if (effectRef.to !== undefined) {
      const endFrame = typeof effectRef.to === "number"
        ? effectRef.to
        : Math.round(parseFloat(effectRef.to as string) * conversion.fpsFloat);
      if (frame >= endFrame) isActive = false;
    }

    if (isActive) active.push(effectRef);
  }

  return active;
}

export function buildRenderGraph(composition: Composition): RenderGraph {
  const conversion = createConversion(composition.fps);
  const totalFrames = composition.duration
    ? Math.ceil((typeof composition.duration === "number"
      ? composition.duration
      : parseFloat(composition.duration as string)) * conversion.fpsFloat)
    : composition.rootTimeline.tracks.reduce((max, track) => {
      if (track.kind === "audio") return max;
      for (const clip of track.clips) {
        const span = computeClipSpan(clip, conversion);
        if (span.endFrames > max) max = span.endFrames;
      }
      return max;
    }, 0);

  const frames: RenderGraphFrame[] = [];

  for (let frame = 0; frame < totalFrames; frame++) {
    const time = frame / conversion.fpsFloat;
    const nodes: RenderGraphNode[] = [];

    for (let trackIndex = 0; trackIndex < composition.rootTimeline.tracks.length; trackIndex++) {
      const track = composition.rootTimeline.tracks[trackIndex];
      if (!track) continue;
      if (track.kind === "audio") continue;

      for (let clipIndex = 0; clipIndex < track.clips.length; clipIndex++) {
        const clip = track.clips[clipIndex];
        if (!clip) continue;
        const span = computeClipSpan(clip, conversion);

        if (frame >= span.startFrames && frame < span.endFrames) {
          const keyframeValues = extractKeyframeValues(clip, frame, conversion);
          const activeEffects = getActiveEffects(clip, frame, conversion);

          nodes.push({
            type: "clip",
            clip,
            trackIndex,
            clipIndex,
            frame,
            time,
            span,
            keyframeValues,
            activeEffects,
            transitionIn: clip.transitionIn ?? null,
            opacity: clip.opacity ?? 1,
            blendMode: clip.blend ?? "normal",
          });
        }
      }
    }

    const backgroundPaint = composition.background;
    let backgroundStr = "#000000";
    if (typeof backgroundPaint === "string") {
      backgroundStr = backgroundPaint;
    } else if (backgroundPaint && typeof backgroundPaint === "object" && "color" in backgroundPaint) {
      backgroundStr = (backgroundPaint as { color: string }).color;
    }

    frames.push({
      frame,
      time,
      nodes,
      background: backgroundStr,
      width: composition.width,
      height: composition.height,
    });
  }

  const duration = totalFrames / conversion.fpsFloat;

  return {
    composition,
    frames,
    totalFrames,
    duration,
    fps: composition.fps,
  };
}

export function serializeRenderGraph(graph: RenderGraph): string {
  const serializable = {
    composition: {
      name: graph.composition.name,
      width: graph.composition.width,
      height: graph.composition.height,
      fps: graph.composition.fps,
      duration: graph.duration,
    },
    totalFrames: graph.totalFrames,
    duration: graph.duration,
    fps: graph.fps,
    frames: graph.frames.map(f => ({
      frame: f.frame,
      time: f.time,
      background: f.background,
      width: f.width,
      height: f.height,
      nodes: f.nodes.map(n => ({
        type: n.type,
        clipType: n.clip.type,
        trackIndex: n.trackIndex,
        clipIndex: n.clipIndex,
        span: n.span,
        keyframeValues: Object.fromEntries(n.keyframeValues),
        activeEffects: n.activeEffects.map(e => ({ name: e.name, params: e.params })),
        transitionIn: n.transitionIn ? { name: n.transitionIn.name, duration: n.transitionIn.duration } : null,
        opacity: n.opacity,
        blendMode: n.blendMode,
      })),
    })),
  };

  return JSON.stringify(serializable, null, 2);
}