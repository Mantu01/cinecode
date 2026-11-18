import {
  EXTENSION_REGISTRY_VERSION,
  getExtensions,
  type ExtensionRegistry,
} from "../extensions/index.js";
import type { EffectProcessor } from "../effects/engine.js";
import type { TransitionProcessor } from "../transitions/engine.js";

export interface RenderRuntime {
  readonly registry: ExtensionRegistry;
  readonly version: string;
  readonly label: string;
  readonly size: { readonly effects: number; readonly transitions: number };
  resolveEffect(name: string): EffectProcessor | undefined;
  resolveTransition(name: string): TransitionProcessor | undefined;
  listEffects(): readonly string[];
  listTransitions(): readonly string[];
}

export function createRenderRuntime(
  registry: ExtensionRegistry = getExtensions(),
  label = "main",
): RenderRuntime {
  return {
    registry,
    version: EXTENSION_REGISTRY_VERSION,
    label,
    size: {
      effects: registry.list<EffectProcessor>("effect").length,
      transitions: registry.list<TransitionProcessor>("transition").length,
    },
    resolveEffect: (name) => registry.get<EffectProcessor>("effect", name),
    resolveTransition: (name) => registry.get<TransitionProcessor>("transition", name),
    listEffects: () =>
      registry
        .list<EffectProcessor>("effect")
        .map((entry) => entry.name)
        .sort(),
    listTransitions: () =>
      registry
        .list<TransitionProcessor>("transition")
        .map((entry) => entry.name)
        .sort(),
  };
}

let defaultRuntime: RenderRuntime | null = null;
let defaultRuntimeRegistry: ExtensionRegistry | null = null;

export function getDefaultRenderRuntime(): RenderRuntime {
  const registry = getExtensions();
  if (!defaultRuntime || defaultRuntimeRegistry !== registry) {
    defaultRuntime = createRenderRuntime(registry);
    defaultRuntimeRegistry = registry;
  }
  return defaultRuntime;
}
