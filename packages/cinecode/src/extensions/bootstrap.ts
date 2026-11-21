import { BUILTIN_EFFECTS, type EffectProcessor } from "../effects/engine.js";
import { BUILTIN_TRANSITIONS, type TransitionProcessor } from "../transitions/engine.js";
import { anamorphicFlareEffect, filmBorderEffect } from "../effects/film-border.js";
import { bloomEffect } from "../effects/bloom.js";
import { boxBlurEffect, gaussianBlurEffect } from "../effects/blur.js";
import { chromaKeyEffect } from "../effects/chroma-key.js";
import { chromaticAberrationEffect } from "../effects/chromatic-aberration.js";
import { colorGradingEffect } from "../effects/color-grading.js";
import { denoiseEffect } from "../effects/denoise.js";
import { depthOfFieldEffect } from "../effects/depth-of-field.js";
import { filmGrainEffect } from "../effects/film-grain.js";
import { filmScratchEffect } from "../effects/film-scratch.js";
import { glitchEffect } from "../effects/glitch.js";
import { kenBurnsEffect } from "../effects/ken-burns.js";
import { lightLeakEffect } from "../effects/light-leak.js";
import { lutEffect } from "../effects/lut.js";
import { neonGlowEffect } from "../effects/neon-glow.js";
import { overlayEffect } from "../effects/overlay.js";
import { rgbCurvesEffect } from "../effects/rgb-curves.js";
import { sharpenEffect } from "../effects/sharpen.js";
import { vignetteEffect } from "../effects/vignette.js";
import { bulgeEffect } from "../renderer/postprocess/effects.js";
import { curveWipeTransition, diagonalWipeTransition } from "../transitions/wipe-variants.js";
import { dissolveTransition } from "../transitions/dissolve.js";
import { fadeToWhiteTransition, fadeTransition } from "../transitions/fade.js";
import { irisCloseTransition, irisOpenTransition } from "../transitions/iris-variants.js";
import { spinTransitionProcessor } from "../transitions/spin.js";
import { zoomTransitionProcessor } from "../transitions/zoom.js";
import { reverbProcessor } from "../audio/reverb/register.js";
import { ExtensionRegistry, type AudioProcessorExtension } from "./registry.js";

export const EXTENSION_REGISTRY_VERSION = "1";

export const BUILTIN_EFFECT_PROCESSORS: readonly EffectProcessor[] = [
  ...BUILTIN_EFFECTS,
  bloomEffect,
  boxBlurEffect,
  gaussianBlurEffect,
  chromaKeyEffect,
  chromaticAberrationEffect,
  colorGradingEffect,
  denoiseEffect,
  depthOfFieldEffect,
  filmBorderEffect,
  anamorphicFlareEffect,
  filmGrainEffect,
  filmScratchEffect,
  glitchEffect,
  kenBurnsEffect,
  lightLeakEffect,
  lutEffect,
  neonGlowEffect,
  overlayEffect,
  rgbCurvesEffect,
  sharpenEffect,
  vignetteEffect,
  bulgeEffect,
];

export const BUILTIN_TRANSITION_PROCESSORS: readonly TransitionProcessor[] = [
  ...BUILTIN_TRANSITIONS,
  dissolveTransition,
  fadeTransition,
  fadeToWhiteTransition,
  irisOpenTransition,
  irisCloseTransition,
  spinTransitionProcessor,
  diagonalWipeTransition,
  curveWipeTransition,
  zoomTransitionProcessor,
];

export const BUILTIN_EFFECT_NAMES: readonly string[] = BUILTIN_EFFECT_PROCESSORS.map(
  (processor) => processor.name,
).sort();

export const BUILTIN_TRANSITION_NAMES: readonly string[] = BUILTIN_TRANSITION_PROCESSORS.map(
  (processor) => processor.name,
).sort();

export const BUILTIN_EXTENSION_INVENTORY = Object.freeze({
  version: EXTENSION_REGISTRY_VERSION,
  effects: BUILTIN_EFFECT_NAMES,
  transitions: BUILTIN_TRANSITION_NAMES,
  audioProcessors: Object.freeze([reverbProcessor.name]),
});

export function createBuiltinRegistry(): ExtensionRegistry {
  const registry = new ExtensionRegistry();
  for (const processor of BUILTIN_EFFECT_PROCESSORS) {
    registry.register<EffectProcessor>("effect", processor.name, processor);
  }
  for (const processor of BUILTIN_TRANSITION_PROCESSORS) {
    registry.register<TransitionProcessor>("transition", processor.name, processor);
  }
  registry.register<AudioProcessorExtension>("audioProcessor", reverbProcessor.name, reverbProcessor);

  if (process.env.CINECODE_VERBOSE === "1" || process.env.CINECODE_LOG_LEVEL === "debug") {
    process.stderr.write(
      `cinecode: extension registry v${EXTENSION_REGISTRY_VERSION}: ${BUILTIN_EFFECT_NAMES.length} effects, ${BUILTIN_TRANSITION_NAMES.length} transitions\n`,
    );
  }
  return registry;
}
