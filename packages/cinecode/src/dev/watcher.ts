import { existsSync, watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";
import { CONFIG_FILENAMES } from "../config/project.js";

export interface ProjectWatcherOptions {
  readonly rootDir: string;
  readonly sourceDir: string;
  readonly mediaDir?: string;
  readonly entryPath?: string;
  readonly configPath?: string;
  readonly additionalFiles?: readonly string[];
  readonly onChange: (files: readonly string[]) => void;
  readonly debounceMs?: number;
}

// Watches project source root, media root, configuration files and individual tracked import files
export class ProjectWatcher {
  private readonly options: ProjectWatcherOptions;
  readonly watchers: FSWatcher[] = [];
  private pendingFiles = new Set<string>();
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(options: ProjectWatcherOptions) {
    this.options = options;
  }

  start(): void {
    if (this.closed) return;

    // 1. Source root directory watcher
    const sourceDir = resolve(this.options.rootDir, this.options.sourceDir);
    if (existsSync(sourceDir)) {
      try {
        const sourceWatcher = watch(sourceDir, { recursive: true }, (_event, filename) => {
          if (!filename) return;
          this.schedule(resolve(sourceDir, filename.toString()));
        });
        this.watchers.push(sourceWatcher);
      } catch {
        // Note: Fallback if recursive watch not supported
      }
    }

    // 2. Media root directory watcher
    if (this.options.mediaDir) {
      const mediaDir = resolve(this.options.rootDir, this.options.mediaDir);
      if (existsSync(mediaDir)) {
        try {
          const mediaWatcher = watch(mediaDir, { recursive: true }, (_event, filename) => {
            if (!filename) return;
            this.schedule(resolve(mediaDir, filename.toString()));
          });
          this.watchers.push(mediaWatcher);
        } catch {
          // Note: Fallback if recursive watch not supported
        }
      }
    }

    // 3. Config files for every supported extension
    const individualFiles = new Set<string>();
    for (const cfg of CONFIG_FILENAMES) {
      individualFiles.add(resolve(this.options.rootDir, cfg));
    }
    if (this.options.configPath) individualFiles.add(resolve(this.options.rootDir, this.options.configPath));
    if (this.options.entryPath) individualFiles.add(resolve(this.options.rootDir, this.options.entryPath));

    // 4. Additional import graph files
    for (const f of this.options.additionalFiles ?? []) {
      individualFiles.add(resolve(this.options.rootDir, f));
    }

    for (const file of individualFiles) {
      if (existsSync(file)) {
        try {
          const fileWatcher = watch(file, () => this.schedule(file));
          this.watchers.push(fileWatcher);
        } catch {
          // Note: File may be locked
        }
      }
    }
  }

  private schedule(file: string): void {
    if (this.closed) return;
    this.pendingFiles.add(file);
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      if (!this.closed && this.pendingFiles.size > 0) {
        const batch = [...this.pendingFiles];
        this.pendingFiles.clear();
        this.options.onChange(batch);
      }
    }, this.options.debounceMs ?? 150);
  }

  close(): void {
    this.closed = true;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.pendingFiles.clear();
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Note: watcher might already be closed
        void 0;
      }
    }
    this.watchers.length = 0;
  }
}
