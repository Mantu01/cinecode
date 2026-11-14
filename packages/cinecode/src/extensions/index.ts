import { BUILTIN_EFFECTS, type EffectInput, type EffectProcessor } from "../effects/engine.js";
import { BUILTIN_TRANSITIONS, type TransitionContext, type TransitionProcessor } from "../transitions/engine.js";
import type { MediaResolver } from "../media/resolver-types.js";
import { addMediaResolverToChain } from "../media/resolverChain.js";

export type ExtensionKind =
  | "codec"
  | "effect"
  | "transition"
  | "audioProcessor"
  | "mediaSource"
  | "mediaResolver"
  | "encoder"
  | "decoder"
  | "imageProcessor"
  | "renderer"
  | "command";

export interface AudioProcessorExtension {
  readonly name: string;
  readonly process: (buffer: import("../audio/types.js").AudioBuffer, params: Readonly<Record<string, unknown>>) => import("../audio/types.js").AudioBuffer | Promise<import("../audio/types.js").AudioBuffer>;
}

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

export interface ExtensionSlot<T> {
  readonly kind: ExtensionKind;
  register(name: string, implementation: T): void;
  get(name: string): T | undefined;
  has(name: string): boolean;
  list(): readonly { readonly name: string; readonly implementation: T }[];
  unregister(name: string): boolean;
}

function createSlot<T>(kind: ExtensionKind): ExtensionSlot<T> {
  const entries = new Map<string, T>();
  return {
    kind,
    register(name, implementation) {
      if (!name) throw new Error(`Extension name for ${kind} must be a non-empty string`);
      entries.set(name, implementation);
    },
    get: (name) => entries.get(name),
    has: (name) => entries.has(name),
    list: () => [...entries.entries()].map(([name, implementation]) => ({ name, implementation })),
    unregister: (name) => entries.delete(name),
  };
}

export interface ExtensionSummary {
  readonly kind: ExtensionKind;
  readonly name: string;
  readonly implementation: unknown;
}

export class ExtensionRegistry {
  private readonly slots = new Map<ExtensionKind, ExtensionSlot<unknown>>();

  slot<T>(kind: ExtensionKind): ExtensionSlot<T> {
    let slot = this.slots.get(kind);
    if (!slot) {
      slot = createSlot<unknown>(kind);
      this.slots.set(kind, slot);
    }
    return slot as ExtensionSlot<T>;
  }

  register<T>(kind: ExtensionKind, name: string, implementation: T): void {
    this.slot<T>(kind).register(name, implementation);
  }

  get<T>(kind: ExtensionKind, name: string): T | undefined {
    return this.slot<T>(kind).get(name);
  }

  has(kind: ExtensionKind, name: string): boolean {
    return this.slot<unknown>(kind).has(name);
  }

  unregister(kind: ExtensionKind, name: string): boolean {
    return this.slot<unknown>(kind).unregister(name);
  }

  list<T>(kind: ExtensionKind): readonly { readonly name: string; readonly implementation: T }[] {
    return this.slot<T>(kind).list();
  }

  listAll(): readonly ExtensionSummary[] {
    const summaries: ExtensionSummary[] = [];
    for (const [kind, slot] of this.slots) {
      for (const { name, implementation } of slot.list()) {
        summaries.push({ kind, name, implementation });
      }
    }
    return summaries;
  }

  clear(kind?: ExtensionKind): void {
    if (kind) this.slots.delete(kind);
    else this.slots.clear();
  }
}

let defaultRegistry: ExtensionRegistry | null = null;

export function getExtensions(): ExtensionRegistry {
  if (!defaultRegistry) defaultRegistry = new ExtensionRegistry();
  return defaultRegistry;
}

export function setExtensions(registry: ExtensionRegistry | null): void {
  defaultRegistry = registry;
}

export function registerEffect(processor: EffectProcessor): void {
  getExtensions().slot<EffectProcessor>("effect").register(processor.name, processor);
}

export function resolveEffect(name: string): EffectProcessor | undefined {
  return (
    getExtensions().slot<EffectProcessor>("effect").get(name) ??
    BUILTIN_EFFECTS.find((effect) => effect.name === name)
  );
}

export function registerTransition(processor: TransitionProcessor): void {
  getExtensions().slot<TransitionProcessor>("transition").register(processor.name, processor);
}

export function resolveTransition(name: string): TransitionProcessor | undefined {
  return (
    getExtensions().slot<TransitionProcessor>("transition").get(name) ??
    BUILTIN_TRANSITIONS.find((transition) => transition.name === name)
  );
}

export function listTransitions(): readonly string[] {
  const names = new Set<string>(BUILTIN_TRANSITIONS.map((transition) => transition.name));
  for (const entry of getExtensions().slot<TransitionProcessor>("transition").list()) names.add(entry.name);
  return [...names].sort();
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

for (const effect of BUILTIN_EFFECTS) {
  getExtensions().slot<EffectProcessor>("effect").register(effect.name, effect);
}

for (const transition of BUILTIN_TRANSITIONS) {
  getExtensions().slot<TransitionProcessor>("transition").register(transition.name, transition);
}

export type { EffectInput, EffectProcessor, TransitionContext, TransitionProcessor };
