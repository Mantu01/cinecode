import type { EffectProcessor } from "../../effects/engine.js";
import { getExtensions, resolveEffect } from "../../extensions/index.js";

export function resolveGlobalEffect(name: string): EffectProcessor | undefined {
  return resolveEffect(name);
}

export function listGlobalEffects(): readonly string[] {
  const registered = getExtensions().slot<EffectProcessor>("effect").list().map((e) => e.name);
  const defaults = ["vignette", "color-grading", "film-grain", "bulge"];
  return [...new Set([...defaults, ...registered])].sort();
}
