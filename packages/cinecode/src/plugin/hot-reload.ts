import fs from "node:fs";
import path from "node:path";
import { getPluginRegistry } from "./registry.js";
import { loadPluginFromFile } from "./loader.js";
import { logger } from "../observability/logger.js";

export interface PluginWatcherOptions {
  onReload?: (pluginId: string) => void;
  broadcastHmr?: (event: { type: string; pluginId: string }) => void;
}

export class PluginHotReloader {
  private watchers = new Map<string, fs.FSWatcher>();
  private readonly options: PluginWatcherOptions;

  constructor(options: PluginWatcherOptions = {}) {
    this.options = options;
  }

  public watchPlugin(pluginId: string, filePath: string): void {
    const resolved = path.resolve(filePath);
    if (this.watchers.has(pluginId)) {
      this.unwatchPlugin(pluginId);
    }

    if (!fs.existsSync(resolved)) return;

    try {
      let debounceTimer: NodeJS.Timeout | undefined;
      const watcher = fs.watch(resolved, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          await this.reloadPlugin(pluginId, resolved);
        }, 100);
      });
      this.watchers.set(pluginId, watcher);
    } catch {}
  }

  public unwatchPlugin(pluginId: string): void {
    const watcher = this.watchers.get(pluginId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(pluginId);
    }
  }

  public async reloadPlugin(pluginId: string, filePath: string): Promise<boolean> {
    const registry = getPluginRegistry();
    const existing = registry.get(pluginId);

    try {
      if (existing) {
        try {
          await existing.plugin.teardown?.({
            options: existing.options,
            log: (msg: string) => logger.debug("plugin", `[Plugin:${pluginId}] ${msg}`),
          });
        } catch {}
      }

      const freshPlugin = await loadPluginFromFile(filePath);
      registry.register(freshPlugin, existing?.options || {});
      await registry.init();

      this.options.broadcastHmr?.({ type: "plugin:reloaded", pluginId });
      this.options.onReload?.(pluginId);
      return true;
    } catch (err) {
      logger.error("plugin", `[Plugin:${pluginId}] Hot-reload failed:`, { error: String(err) });
      return false;
    }
  }

  public closeAll(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}
