import { spawn } from "node:child_process";
import { platform } from "node:os";
import { PreviewHost, type DevServerMode } from "../../dev/index.js";
import { setHotReload } from "../../loader/index.js";
import { DEFAULT_DEV } from "../../config/defaults.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { runReport } from "../output/run-report.js";
import { CancellationSignal } from "../shared/exit-codes.js";
import type { ProjectResolution } from "../resolve/project-resolver.js";

export interface DevCliOptions {
  config?: string;
  root?: string;
  port?: number;
  host?: string;
  open?: boolean;
  hmr?: boolean;
  noHmr?: boolean;
  allowNetwork?: boolean;
}

export interface DevPreflightContext {
  readonly resolution?: ProjectResolution;
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
    void 0;
  }
}

export async function startPreviewHost(
  options: DevCliOptions,
  mode: DevServerMode = "dev",
  preflightCtx?: DevPreflightContext,
): Promise<PreviewHost> {
  const isDev = mode === "dev";
  setHotReload(isDev);

  const resolution = preflightCtx?.resolution;
  if (!resolution || !resolution.manifest) {
    throw createError(ErrorCode.CC1009, {
      path: resolution?.manifestPath ?? options.root ?? ".",
    }, { fixHint: "Run dev/preview through the CLI so the project manifest resolves first." });
  }
  const { config, root, configPath, manifest: project } = resolution;

  const port = options.port ?? config.dev?.port ?? DEFAULT_DEV.port;
  const host = options.host ?? config.dev?.host ?? DEFAULT_DEV.host;
  const hmr = isDev && options.noHmr !== true && options.hmr !== false
    ? (config.dev?.hmr ?? DEFAULT_DEV.hmr)
    : false;

  const server = new PreviewHost({
    config,
    project,
    rootDir: root,
    port,
    host,
    hmr,
    allowNetwork: options.allowNetwork === true,
    configPath,
    mode,
  });

  await server.start();

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
  preflightCtx?: DevPreflightContext,
): Promise<void> {
  const server = await startPreviewHost(options, mode, preflightCtx);
  const host = options.host ?? (preflightCtx?.resolution?.config.dev?.host ?? DEFAULT_DEV.host);
  runReport.result({
    port: server.port,
    host,
    url: server.url,
    pid: process.pid,
  });

  let interrupted = false;
  await new Promise<void>((resolvePromise) => {
    let resolved = false;
    const shutdown = async (signal: boolean): Promise<void> => {
      if (resolved) return;
      resolved = true;
      interrupted = signal;
      runReport.diagnostic(`\nShutting down ${mode} server…`);
      await server.stop();
      resolvePromise();
    };
    process.once("SIGINT", () => void shutdown(true));
    process.once("SIGTERM", () => void shutdown(true));
    process.stdin.once("end", () => void shutdown(false));
    process.stdin.resume();
  });
  if (interrupted) throw new CancellationSignal(`${mode} server interrupted`);
}
