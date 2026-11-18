import { createBuiltinRegistry } from "./bootstrap.js";
import { ExtensionRegistry, type AudioProcessorExtension, type ExtensionKind } from "./registry.js";
import type { EffectProcessor } from "../effects/engine.js";
import type { TransitionProcessor } from "../transitions/engine.js";
import type { MediaResolver } from "../media/resolver-types.js";
import { addMediaResolverToChain } from "../media/resolverChain.js";

export * from "./registry.js";
export * from "./bootstrap.js";

export interface MediaSourceResolution {
  readonly path: string;
  readonly name?: string;
}

export interface MediaSourceExtension {
  readonly name: string;
  readonly canResolve: (ref: string) => boolean;
  readonly resolve: (ref: string) => Promise<MediaSourceResolution>;
}

export interface CodecExtension {
  readonly name: string;
  readonly kind: "video" | "audio";
  readonly container: string;
  readonly description?: string;
}

let defaultRegistry: ExtensionRegistry | null = null;

export function getExtensions(): ExtensionRegistry {
  if (!defaultRegistry) defaultRegistry = createBuiltinRegistry();
  return defaultRegistry;
}

export function setExtensions(registry: ExtensionRegistry | null): void {
  defaultRegistry = registry;
}

export function registerEffect(processor: EffectProcessor): void {
  getExtensions().slot<EffectProcessor>("effect").register(processor.name, processor);
}

export function resolveEffect(name: string): EffectProcessor | undefined {
  return getExtensions().slot<EffectProcessor>("effect").get(name);
}

export function listEffects(): readonly string[] {
  return getExtensions()
    .slot<EffectProcessor>("effect")
    .list()
    .map((entry) => entry.name)
    .sort();
}

export function registerTransition(processor: TransitionProcessor): void {
  getExtensions().slot<TransitionProcessor>("transition").register(processor.name, processor);
}

export function resolveTransition(name: string): TransitionProcessor | undefined {
  return getExtensions().slot<TransitionProcessor>("transition").get(name);
}

export function listTransitions(): readonly string[] {
  return getExtensions()
    .slot<TransitionProcessor>("transition")
    .list()
    .map((entry) => entry.name)
    .sort();
}

export function registerAudioProcessor(processor: AudioProcessorExtension): void {
  getExtensions().slot<AudioProcessorExtension>("audioProcessor").register(processor.name, processor);
}

export function resolveAudioProcessor(name: string): AudioProcessorExtension | undefined {
  return getExtensions().slot<AudioProcessorExtension>("audioProcessor").get(name);
}

export function registerMediaResolver(resolver: MediaResolver): void {
  addMediaResolverToChain(resolver);
  getExtensions().slot<MediaResolver>("mediaResolver").register(resolver.name, resolver);
}

export function resolveMediaResolver(name: string): MediaResolver | undefined {
  return getExtensions().slot<MediaResolver>("mediaResolver").get(name);
}

export function registerMediaSource(source: MediaSourceExtension): void {
  getExtensions().slot<MediaSourceExtension>("mediaSource").register(source.name, source);
}

export function resolveMediaSource(ref: string): MediaSourceExtension | undefined {
  for (const { implementation } of getExtensions().slot<MediaSourceExtension>("mediaSource").list()) {
    if (implementation.canResolve(ref)) return implementation;
  }
  return undefined;
}

export function registerCodec(codec: CodecExtension): void {
  getExtensions().slot<CodecExtension>("codec").register(codec.name, codec);
}

export function resolveCodec(name: string): CodecExtension | undefined {
  return getExtensions().slot<CodecExtension>("codec").get(name);
}

export function resolveExtension<T>(kind: ExtensionKind, name: string): T | undefined {
  return getExtensions().slot<T>(kind).get(name);
}
