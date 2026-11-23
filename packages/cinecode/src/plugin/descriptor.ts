import { createBuiltinRegistry, type ExtensionRegistry } from "../extensions/index.js";
import { loadPlugin } from "./loader.js";
import type { PluginRegistry } from "./registry.js";
import { assertFrameCapability, registerPluginExtensions } from "./registry.js";
import type { CinecodePlugin } from "./types.js";

export interface ExtensionPluginDescriptor {
  readonly name: string;
  readonly version: string;
  readonly kind: string;
  readonly permissions: readonly string[];
  readonly source?: string;
  readonly options: Readonly<Record<string, unknown>>;
  readonly effects: readonly string[];
  readonly transitions: readonly string[];
}

export interface ExtensionDescriptor {
  readonly version: string;
  readonly plugins: readonly ExtensionPluginDescriptor[];
  readonly effects: readonly string[];
  readonly transitions: readonly string[];
}

export function createExtensionDescriptor(registry: PluginRegistry): ExtensionDescriptor {
  const plugins = registry.getAll().map((entry) => {
    const plugin = entry.plugin;
    const effects = (plugin.effects ?? []).filter((effect) => registry.getFeature(effect.name) === effect).map((effect) => effect.name);
    const transitions = (plugin.transitions ?? [])
      .filter((transition) => registry.getFeature(transition.name) === transition)
      .map((transition) => transition.name);
    return {
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      kind: plugin.manifest.kind,
      permissions: [...(plugin.manifest.permissions ?? [])],
      source: entry.source,
      options: entry.options,
      effects,
      transitions,
    };
  });
  return {
    version: "1",
    plugins,
    effects: plugins.flatMap((plugin) => plugin.effects),
    transitions: plugins.flatMap((plugin) => plugin.transitions),
  };
}

export async function installExtensionDescriptor(
  descriptor: ExtensionDescriptor,
  rootDir = process.cwd(),
): Promise<ExtensionRegistry> {
  const registry = createBuiltinRegistry({ log: false });
  for (const entry of descriptor.plugins) {
    if (!entry.source) continue;
    const plugin: CinecodePlugin = await loadPlugin(entry.source, { options: entry.options, rootDir });
    assertFrameCapability(plugin);
    registerPluginExtensions(registry, plugin, entry.effects, entry.transitions);
  }
  return registry;
}
