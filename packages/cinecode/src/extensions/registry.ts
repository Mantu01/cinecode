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
