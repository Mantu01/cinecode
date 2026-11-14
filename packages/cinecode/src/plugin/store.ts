export interface StoreOptions {
  frame?: number;
  ephemeral?: boolean;
}

export type StoreSubscriptionCallback = (newValue: unknown, oldValue: unknown) => void;
export type EventSubscriptionCallback = (payload: unknown) => void;

export interface ScopedPluginStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, options?: StoreOptions): void;
  delete(key: string): boolean;
  subscribe(key: string, callback: StoreSubscriptionCallback): () => void;
}

export class PluginStateStore {
  private static instance?: PluginStateStore;
  private state = new Map<string, unknown>();
  private frameSnapshots = new Map<number, Map<string, unknown>>();
  private subscriptions = new Map<string, Set<StoreSubscriptionCallback>>();
  private eventHandlers = new Map<string, Set<EventSubscriptionCallback>>();
  private currentFrame = 0;

  public static getInstance(): PluginStateStore {
    if (!PluginStateStore.instance) {
      PluginStateStore.instance = new PluginStateStore();
    }
    return PluginStateStore.instance;
  }

  public get<T>(key: string): T | undefined {
    return this.state.get(key) as T | undefined;
  }

  public set<T>(key: string, value: T, options: StoreOptions = {}): void {
    const oldValue = this.state.get(key);
    this.state.set(key, value);

    const frame = options.frame ?? this.currentFrame;
    if (!options.ephemeral) {
      let snapshot = this.frameSnapshots.get(frame);
      if (!snapshot) {
        snapshot = new Map();
        this.frameSnapshots.set(frame, snapshot);
      }
      snapshot.set(key, value);
    }

    const listeners = this.subscriptions.get(key);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(value, oldValue);
        } catch {}
      }
    }
  }

  public delete(key: string): boolean {
    const had = this.state.delete(key);
    const listeners = this.subscriptions.get(key);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(undefined, undefined);
        } catch {}
      }
    }
    return had;
  }

  public subscribe(key: string, callback: StoreSubscriptionCallback): () => void {
    let listeners = this.subscriptions.get(key);
    if (!listeners) {
      listeners = new Set();
      this.subscriptions.set(key, listeners);
    }
    listeners.add(callback);
    return () => {
      listeners?.delete(callback);
      if (listeners?.size === 0) {
        this.subscriptions.delete(key);
      }
    };
  }

  public for(namespace: string): ScopedPluginStore {
    const prefix = `${namespace}:`;
    return {
      get: <T>(key: string) => this.get<T>(`${prefix}${key}`),
      set: <T>(key: string, value: T, options?: StoreOptions) => this.set<T>(`${prefix}${key}`, value, options),
      delete: (key: string) => this.delete(`${prefix}${key}`),
      subscribe: (key: string, callback: StoreSubscriptionCallback) => this.subscribe(`${prefix}${key}`, callback),
    };
  }

  public setCurrentFrame(frame: number): void {
    this.currentFrame = frame;
    const snapshot = this.frameSnapshots.get(frame);
    if (snapshot) {
      for (const [key, value] of snapshot.entries()) {
        const old = this.state.get(key);
        if (old !== value) {
          this.state.set(key, value);
          const listeners = this.subscriptions.get(key);
          if (listeners) {
            for (const listener of listeners) {
              try {
                listener(value, old);
              } catch {}
            }
          }
        }
      }
    }
  }

  public clearFrameSnapshots(): void {
    this.frameSnapshots.clear();
  }

  public emit(event: string, payload: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch {}
      }
    }
  }

  public on(event: string, handler: EventSubscriptionCallback): () => void {
    let handlers = this.eventHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(event, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers?.delete(handler);
      if (handlers?.size === 0) {
        this.eventHandlers.delete(event);
      }
    };
  }

  public reset(): void {
    this.state.clear();
    this.frameSnapshots.clear();
    this.subscriptions.clear();
    this.eventHandlers.clear();
    this.currentFrame = 0;
  }
}

export const pluginStateStore = PluginStateStore.getInstance();
