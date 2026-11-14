import type {
  CinecodePlugin,
  HookHandler,
  HookName,
  PluginKind,
  PluginManifest,
} from "./types.js";

export interface DefinePluginInput {
  readonly manifest: PluginManifest;
  readonly hooks?: CinecodePlugin["hooks"];
  readonly setup?: CinecodePlugin["setup"];
  readonly teardown?: CinecodePlugin["teardown"];
}

/**
 * Authoring helper for plugin authors — the core export of the plugin SDK
 * concept (`@cinecode/plugin-sdk`). `definePlugin` gives full type inference on
 * manifests, hooks, and lifecycle so authors implement the contract without
 * hand-rolling object literals.
 */
export function definePlugin(input: DefinePluginInput): CinecodePlugin {
  return { manifest: input.manifest, hooks: input.hooks, setup: input.setup, teardown: input.teardown };
}

export function defineManifest(manifest: PluginManifest): PluginManifest {
  return manifest;
}

export function hook<K extends HookName>(name: K, handler: HookHandler<K>): { readonly hook: K; readonly handler: HookHandler<K> } {
  return { hook: name, handler };
}

export function effectPlugin(name: string, version: string, hooks: CinecodePlugin["hooks"]): CinecodePlugin {
  return definePlugin({ manifest: { name, version, kind: "effect" }, hooks });
}

export function transitionPlugin(name: string, version: string, hooks: CinecodePlugin["hooks"]): CinecodePlugin {
  return definePlugin({ manifest: { name, version, kind: "transition" }, hooks });
}

export function audioProcessorPlugin(name: string, version: string, hooks: CinecodePlugin["hooks"]): CinecodePlugin {
  return definePlugin({ manifest: { name, version, kind: "audioProcessor" }, hooks });
}

export function commandPlugin(name: string, version: string, hooks: CinecodePlugin["hooks"]): CinecodePlugin {
  return definePlugin({ manifest: { name, version, kind: "command" }, hooks });
}

export const PLUGIN_KINDS: readonly PluginKind[] = [
  "effect",
  "transition",
  "audioProcessor",
  "mediaSource",
  "renderer",
  "command",
  "encoder",
  "decoder",
  "imageProcessor",
];
