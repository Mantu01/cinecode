import { createError, ErrorCode } from "../errors/codes.js";
import { HOOK_NAMES } from "./types.js";
import type {
  CinecodePlugin,
  HookDataMap,
  HookHandler,
  HookName,
  HookRunResult,
  PluginContext,
  RegisteredPlugin,
} from "./types.js";

type InlineHook = { readonly plugin: string; readonly handler: (data: unknown) => void | Promise<void> };
const FRAME_HOOK_TIMEOUT_MS = 100;

function normalizeHandlers<K extends HookName>(
  value: CinecodePlugin["hooks"] extends undefined ? undefined : NonNullable<CinecodePlugin["hooks"]>[K],
): readonly ((data: HookDataMap[K]) => void | Promise<void>)[] {
  if (!value) return [];
  return Array.isArray(value) ? (value as readonly ((data: HookDataMap[K]) => void | Promise<void>)[]) : [value as (data: HookDataMap[K]) => void | Promise<void>];
}

export interface PluginRegistryOptions {
  readonly onError?: (error: Error, plugin: string, hook: HookName) => void;
  readonly precedence?: readonly string[];
}

interface RegisteredFeature {
  pluginName: string;
  handler: unknown;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, RegisteredPlugin>();
  private readonly optionsByPlugin = new Map<string, Record<string, unknown>>();
  private readonly options: PluginRegistryOptions;
  private autoDiscovered = false;
  private autoDiscoveryEnabled = true;
  private readonly inlineHooks = new Map<HookName, InlineHook[]>();
  private readonly features = new Map<string, RegisteredFeature>();
  private readonly namespacedFeatures = new Map<string, unknown>();

  constructor(options: PluginRegistryOptions = {}) {
    this.options = options;
  }

  registerFeature(name: string, pluginName: string, handler: unknown): void {
    const qualified1 = `${pluginName}/${name}`;
    const qualified2 = `${pluginName}:${name}`;
    this.namespacedFeatures.set(qualified1, handler);
    this.namespacedFeatures.set(qualified2, handler);

    const existing = this.features.get(name);
    if (!existing) {
      this.features.set(name, { pluginName, handler });
      return;
    }

    if (existing.pluginName === pluginName) {
      this.features.set(name, { pluginName, handler });
      return;
    }

    const precedence = this.options.precedence || [];
    const existingIdx = precedence.indexOf(existing.pluginName);
    const newIdx = precedence.indexOf(pluginName);

    if (newIdx !== -1 && (existingIdx === -1 || newIdx < existingIdx)) {
      this.features.set(name, { pluginName, handler });
      return;
    }

    if (existingIdx !== -1 && (newIdx === -1 || existingIdx < newIdx)) {
      return;
    }

    console.warn(`[CC7005] High-priority conflict: Identifier '${name}' registered by both '${existing.pluginName}' and '${pluginName}'. Use disambiguation syntax '${pluginName}/${name}'.`);
  }

  getFeature(identifier: string): unknown | undefined {
    if (this.namespacedFeatures.has(identifier)) {
      return this.namespacedFeatures.get(identifier);
    }
    return this.features.get(identifier)?.handler;
  }

  register(plugin: CinecodePlugin, options: Record<string, unknown> = {}): RegisteredPlugin {
    const name = plugin.manifest?.name;
    if (!name || typeof name !== "string") {
      throw createError(ErrorCode.CC8002, { plugin: String(name ?? "unknown"), reason: "manifest.name must be a non-empty string" });
    }
    if (!plugin.manifest.version || typeof plugin.manifest.version !== "string") {
      throw createError(ErrorCode.CC8002, { plugin: name, reason: "manifest.version must be a semver string" });
    }
    if (!plugin.manifest.kind || typeof plugin.manifest.kind !== "string") {
      throw createError(ErrorCode.CC8002, { plugin: name, reason: "manifest.kind must be a plugin kind" });
    }
    if (typeof plugin.setup !== "undefined" && typeof plugin.setup !== "function") {
      throw createError(ErrorCode.CC8002, { plugin: name, reason: "setup must be a function when present" });
    }
    if (typeof plugin.teardown !== "undefined" && typeof plugin.teardown !== "function") {
      throw createError(ErrorCode.CC8002, { plugin: name, reason: "teardown must be a function when present" });
    }
    if (plugin.hooks) {
      for (const key of Object.keys(plugin.hooks)) {
        if (!(HOOK_NAMES as readonly string[]).includes(key)) {
          throw createError(ErrorCode.CC8002, { plugin: name, reason: `unknown hook "${key}"` });
        }
      }
    }

    const registered: RegisteredPlugin = { plugin, options, state: "registered", errors: [] };
    this.plugins.set(name, registered);
    this.optionsByPlugin.set(name, options);
    return registered;
  }

  get(name: string): RegisteredPlugin | undefined {
    return this.plugins.get(name);
  }

  getAll(): readonly RegisteredPlugin[] {
    return [...this.plugins.values()];
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  unregister(name: string): boolean {
    return this.plugins.delete(name);
  }

  clear(): void {
    this.plugins.clear();
    this.optionsByPlugin.clear();
  }

  listByKind(kind: string): readonly RegisteredPlugin[] {
    return this.getAll().filter((entry) => entry.plugin.manifest.kind === kind);
  }

  registerHook<K extends HookName>(hook: K, handler: HookHandler<K>, pluginName = "inline"): () => void {
    const entry: InlineHook = {
      plugin: pluginName,
      handler: (data: unknown) => handler(data as HookDataMap[K]),
    };
    const list = this.inlineHooks.get(hook) ?? [];
    list.push(entry);
    this.inlineHooks.set(hook, list);
    return () => {
      const current = this.inlineHooks.get(hook);
      if (!current) return;
      this.inlineHooks.set(hook, current.filter((item) => item !== entry));
    };
  }

  setAutoDiscovery(enabled: boolean): void {
    this.autoDiscoveryEnabled = enabled;
  }

  async autoDiscover(baseDir = process.cwd()): Promise<readonly CinecodePlugin[]> {
    if (this.autoDiscovered || !this.autoDiscoveryEnabled) return [];
    this.autoDiscovered = true;
    const { discoverPlugins } = await import("./discover.js");
    const plugins = await discoverPlugins(baseDir);
    const registered: CinecodePlugin[] = [];
    for (const plugin of plugins) {
      if (this.has(plugin.manifest.name)) continue;
      this.register(plugin);
      registered.push(plugin);
    }
    return registered;
  }

  async init(): Promise<void> {
    for (const entry of this.plugins.values()) {
      if (entry.state !== "registered") continue;
      entry.state = "initializing";
      const context = this.contextFor(entry);
      try {
        await entry.plugin.setup?.(context);
        entry.state = "active";
      } catch (error) {
        entry.state = "failed";
        const err = error instanceof Error ? error : new Error(String(error));
        (entry.errors as Error[]).push(err);
        this.options.onError?.(err, entry.plugin.manifest.name, "beforeRender");
      }
    }
  }

  async teardown(): Promise<void> {
    for (const entry of this.plugins.values()) {
      if (entry.state !== "active") continue;
      try {
        await entry.plugin.teardown?.(this.contextFor(entry));
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        (entry.errors as Error[]).push(err);
      }
      entry.state = "disposed";
    }
  }

  async runHook<K extends HookName>(hook: K, data: HookDataMap[K]): Promise<HookRunResult<K>> {
    const failures: { plugin: string; error: Error }[] = [];
    let executed = 0;
    const timeout = hook === "beforeFrame" || hook === "afterFrame" ? FRAME_HOOK_TIMEOUT_MS : 0;

    const invoke = async (pluginName: string, handler: (value: HookDataMap[K]) => void | Promise<void>): Promise<void> => {
      try {
        const result = handler(data);
        if (timeout > 0) {
          await this.withTimeout(Promise.resolve(result), timeout, pluginName, hook);
        } else {
          await result;
        }
        executed += 1;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        failures.push({ plugin: pluginName, error: err });
        const wrapped = createError(
          ErrorCode.CC8003,
          { plugin: pluginName, hook, reason: err.message },
          { severity: "warning", fixHint: "The plugin hook failed; other plugins and the render continued. Fix or disable the plugin." }
        );
        this.options.onError?.(wrapped, pluginName, hook);
      }
    };

    for (const entry of this.plugins.values()) {
      if (entry.state !== "active") continue;
      const handlers = normalizeHandlers<K>(entry.plugin.hooks?.[hook] as never);
      for (const handler of handlers) {
        try {
          await invoke(entry.plugin.manifest.name, handler);
        } catch (error) {
          (entry.errors as Error[]).push(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }

    for (const entry of this.inlineHooks.get(hook) ?? []) {
      await invoke(entry.plugin, (value) => entry.handler(value));
    }

    return { hook, executed, failures };
  }

  private async withTimeout(
    promise: Promise<void>,
    timeoutMs: number,
    pluginName: string,
    hook: HookName,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<void>((resolvePromise) => {
      timer = setTimeout(() => {
        console.warn(`[cinecode:plugin] ${pluginName} hook ${hook} exceeded ${timeoutMs}ms; continuing`);
        resolvePromise();
      }, timeoutMs);
    });
    try {
      await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private contextFor(entry: RegisteredPlugin): PluginContext {
    return {
      options: entry.options,
      log: (message: string) => {
        console.log(`[plugin:${entry.plugin.manifest.name}] ${message}`);
      },
    };
  }
}

let defaultRegistry: PluginRegistry | null = null;

export function getPluginRegistry(): PluginRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new PluginRegistry();
    void defaultRegistry.autoDiscover().catch(() => undefined);
  }
  return defaultRegistry;
}

export function setPluginRegistry(registry: PluginRegistry | null): void {
  defaultRegistry = registry;
}
