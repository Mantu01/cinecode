import { Command } from "commander";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { loadProjectContext } from "./project-context.js";
import { loadManifestProject, type ManifestProject } from "../manifest/index.js";
import { PreviewHost, type DevServerMode } from "../dev/index.js";
import { setHotReload } from "../loader/index.js";
import { DEFAULT_DEV } from "../config/defaults.js";
import type { CinecodeConfig } from "../core/types/index.js";

export interface DevCliOptions {
  config?: string;
  root?: string;
  port?: number;
  host?: string;
  open?: boolean;
  hmr?: boolean;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function openBrowser(url: string): void {
  const plat = platform();
  const command = plat === "win32" ? "cmd" : plat === "darwin" ? "open" : "xdg-open";
  const args = plat === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // Note: ignore browser launch errors in headless or unsupported environments
    void 0;
  }
}

// Unified runner for dev and preview host
export async function startPreviewHost(
  options: DevCliOptions,
  mode: DevServerMode = "dev",
  preflightCtx?: { config: CinecodeConfig; root: string; configPath?: string },
): Promise<PreviewHost> {
  const isDev = mode === "dev";
  setHotReload(isDev);

  let config: CinecodeConfig;
  let root: string;
  let configPath = "";
  let project: ManifestProject;
  let initialError: string | undefined;

  try {
    const context = preflightCtx ?? (await loadProjectContext({ root: options.root, config: options.config, fresh: true }));
    config = context.config;
    root = context.root;
    configPath = context.configPath ?? "";
    project = await loadManifestProject(config, root);
  } catch (err) {
    initialError = err instanceof Error ? err.message : String(err);
    root = options.root ?? process.cwd();
    config = { schemaVersion: 1 } as unknown as CinecodeConfig;
    project = {
      manifest: { timelines: [] },
      entryPath: "",
      rootDir: root,
      config,
      hasManifest: false,
    };
  }

  const port = options.port ?? config.dev?.port ?? DEFAULT_DEV.port;
  const host = options.host ?? config.dev?.host ?? DEFAULT_DEV.host;
  const hmr = isDev ? (options.hmr === false ? false : (config.dev?.hmr ?? DEFAULT_DEV.hmr)) : false;

  const server = new PreviewHost({
    config,
    project,
    rootDir: root,
    port,
    host,
    hmr,
    configPath,
    mode,
    initialError,
  });

  await server.start();

  // Auto-open: disabled in preview mode and never allowed on non-loopback binds
  const canOpen = isLoopback(host);
  const shouldOpen = isDev ? (options.open ?? config.dev?.open ?? false) : (options.open ?? false);
  if (canOpen && shouldOpen) {
    openBrowser(server.url);
  }

  return server;
}

export async function runPreviewHost(
  options: DevCliOptions,
  mode: DevServerMode = "dev",
  preflightCtx?: { config: CinecodeConfig; root: string; configPath?: string },
): Promise<void> {
  const server = await startPreviewHost(options, mode, preflightCtx);

  await new Promise<void>((resolvePromise) => {
    const shutdown = async (): Promise<void> => {
      console.log(`\nShutting down ${mode} server…`);
      await server.stop();
      resolvePromise();
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
  });
}

export async function devCommand(
  options: DevCliOptions,
  preflightCtx?: { config: CinecodeConfig; root: string; configPath?: string },
): Promise<void> {
  await runPreviewHost(options, "dev", preflightCtx);
}

import { findCommand, buildCommanderCommand } from "./command-registry.js";

export function createDevCommand(): Command {
  const spec = findCommand("dev");
  if (!spec) throw new Error("Command 'dev' not found in registry");
  return buildCommanderCommand(spec);
}
