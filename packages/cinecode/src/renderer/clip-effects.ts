import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import type { Composition, VisualClip, EffectRef } from "../core/types/index.js";
import { createContext, clearCanvas } from "./composite/engine.js";
import { createEffectInput } from "../effects/engine.js";
import { createEffectGraphOptimizer, type EffectBatchEntry } from "./postprocess/batch.js";
import { createError, ErrorCode, type ErrorLocation } from "../errors/index.js";
import { getDefaultRenderRuntime } from "./runtime.js";
import { computeClipSpan } from "../core/validation/index.js";
import { getFallbackSession } from "./session.js";
import type { RenderContext, ClipVisualInput } from "./engine-types.js";

export function isEffectActive(effectRef: EffectRef, context: RenderContext): boolean {
  if (effectRef.enabled === false) return false;
  const conversion = context.conversion;
  if (effectRef.from !== undefined) {
    const startFrame =
      typeof effectRef.from === "number"
        ? effectRef.from
        : parseFloat(effectRef.from as string) * conversion.fpsFloat;
    if (context.frame < startFrame) return false;
  }
  if (effectRef.to !== undefined) {
    const endFrame =
      typeof effectRef.to === "number"
        ? effectRef.to
        : parseFloat(effectRef.to as string) * conversion.fpsFloat;
    if (context.frame >= endFrame) return false;
  }
  return true;
}

export function clipLocation(
  composition: Composition,
  clip: VisualClip,
  context: RenderContext,
): ErrorLocation {
  const tracks = composition.rootTimeline.tracks;
  const index = tracks.findIndex((track) => (track.clips as readonly unknown[]).includes(clip));
  return {
    clip: clip.name ?? clip.type,
    track: index >= 0 ? (tracks[index]?.name ?? `track ${index}`) : undefined,
    time: `${context.time.toFixed(3)}s (frame ${context.frame})`,
  };
}

export function unknownExtensionError(
  kind: "effect" | "transition",
  name: string,
  available: readonly string[],
  location: ErrorLocation,
) {
  return createError(
    ErrorCode.CC3007,
    { kind, id: name, available: available.join(", ") || "none" },
    { location },
  );
}

export function applyEffects(canvas: Canvas, clip: VisualClip, context: RenderContext): Canvas {
  if (!clip.effects || clip.effects.length === 0) return canvas;
  const runtime = context.runtime ?? getDefaultRenderRuntime();
  let current = canvas;
  for (const effectRef of clip.effects) {
    if (!isEffectActive(effectRef, context)) continue;
    const effect = runtime.resolveEffect(effectRef.name);
    if (!effect) {
      throw unknownExtensionError(
        "effect",
        effectRef.name,
        runtime.listEffects(),
        clipLocation(context.composition, clip, context),
      );
    }
    const input = createEffectInput(current, createContext(current), context.time, context.seed);
    effect.apply(input, effectRef.params ?? {});
    current = input.canvas;
  }
  return current;
}

export function transitionFrames(
  transitionRef: NonNullable<VisualClip["transitionIn"]>,
  transition: { readonly defaultDuration?: number },
  conversion: RenderContext["conversion"],
): number {
  const configured = transitionRef.duration ?? transition.defaultDuration;
  if (configured === undefined) return 30;
  const seconds = typeof configured === "number" ? configured : parseFloat(configured);
  return Math.max(0, seconds * conversion.fpsFloat);
}

export function evaluateClipVisual({
  clipCanvas,
  clip,
  context,
  underlying,
}: ClipVisualInput): Canvas {
  const inRef = clip.transitionIn;
  const outRef = clip.transitionOut;
  if (!inRef && !outRef) return clipCanvas;

  const runtime = context.runtime ?? getDefaultRenderRuntime();
  const span = computeClipSpan(clip, context.conversion);
  const durationFrames = Math.max(1, span.endFrames - span.startFrames);
  const resolve = (ref: NonNullable<VisualClip["transitionIn"]>) => {
    const processor = runtime.resolveTransition(ref.name);
    if (!processor) {
      throw unknownExtensionError(
        "transition",
        ref.name,
        runtime.listTransitions(),
        clipLocation(context.composition, clip, context),
      );
    }
    return processor;
  };

  const inProcessor = inRef ? resolve(inRef) : undefined;
  const outProcessor = outRef ? resolve(outRef) : undefined;
  let entryFrames = inRef && inProcessor ? transitionFrames(inRef, inProcessor, context.conversion) : 0;
  let exitFrames = outRef && outProcessor ? transitionFrames(outRef, outProcessor, context.conversion) : 0;
  if (entryFrames + exitFrames > durationFrames) {
    const factor = durationFrames / (entryFrames + exitFrames);
    entryFrames *= factor;
    exitFrames *= factor;
  }

  const inEntry = entryFrames > 0 && context.frame < span.startFrames + entryFrames;
  const exitStart = span.endFrames - exitFrames;
  const inExit = exitFrames > 0 && context.frame >= exitStart;
  if (!inEntry && !inExit) return clipCanvas;

  const { width, height } = context;
  const transparent = (context.session ?? getFallbackSession()).getTransparentCanvas(width, height);
  const bufferPair = (context.session ?? getFallbackSession()).getTransitionBuffers(width, height);
  const fromCanvas = inEntry ? (underlying ?? transparent) : clipCanvas;
  const toCanvas = inEntry ? clipCanvas : transparent;
  const resultCanvas = bufferPair[0] === fromCanvas || bufferPair[0] === toCanvas ? bufferPair[1] : bufferPair[0];
  const progress = inEntry
    ? Math.min(1, Math.max(0, (context.frame - span.startFrames) / entryFrames))
    : Math.min(1, Math.max(0, (context.frame - exitStart) / exitFrames));

  const resultCtx = createContext(resultCanvas);
  clearCanvas(resultCtx, width, height);
  const transition = inEntry ? inProcessor! : outProcessor!;
  transition.apply(
    resultCtx,
    { progress, from: fromCanvas, to: toCanvas, width, height, seed: context.seed },
    (inEntry ? inRef! : outRef!).params ?? {},
  );
  return resultCanvas;
}

export function applyPostProcessing(
  ctx: SKRSContext2D,
  composition: Composition,
  context: RenderContext,
  seed: number,
): void {
  const config = composition.postProcessing;
  if (!config || config.previewMode === true) return;
  const effects = config.effects;
  if (!effects || effects.length === 0) return;
  const entries: EffectBatchEntry[] = [];
  for (const definition of effects) {
    if (definition.enabled === false) continue;
    const runtime = context.runtime ?? getDefaultRenderRuntime();
    const processor = runtime.resolveEffect(definition.name);
    if (!processor) {
      throw unknownExtensionError("effect", definition.name, runtime.listEffects(), {
        clip: "postProcessing",
        time: `${context.time.toFixed(3)}s (frame ${context.frame})`,
      });
    }
    const params = definition.params ?? {};
    entries.push({
      name: definition.name,
      priority: definition.priority ?? 0,
      params,
      apply: (input) => processor.apply(input, params),
    });
  }
  if (entries.length === 0) return;
  const input = createEffectInput(ctx.canvas, ctx, context.time, seed);
  try {
    createEffectGraphOptimizer().execute(input, entries);
  } catch {
    for (const entry of entries) entry.apply(input);
  }
}
