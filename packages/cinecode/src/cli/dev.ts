import { Command } from "commander";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { resolve } from "node:path";
import { loadConfig } from "../config/schema.js";
import { loadManifestProject } from "../manifest/index.js";
import { DevServer } from "../dev/index.js";

export interface DevCliOptions {
  config?: string;
  port?: number;
  host?: string;
  open?: boolean;
  hmr?: boolean;
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

export async function devCommand(options: DevCliOptions): Promise<void> {
  const configPath = options.config ?? "cinecode.config.js";
  const config = await loadConfig(resolve(configPath));
  const project = await loadManifestProject(config, process.cwd());

  const port = options.port ?? config.dev?.port ?? 3000;
  const host = options.host ?? config.dev?.host ?? "localhost";
  const hmr = options.hmr === false ? false : (config.dev?.hmr ?? true);

  const server = new DevServer({
    config,
    project,
    rootDir: process.cwd(),
    port,
    host,
    hmr,
    configPath: resolve(configPath),
  });

  await server.start();

  console.log(`Cinecode dev server running at ${server.url}`);
  console.log(`Watching ${config.sourceDir ?? "./src"} — ${server.nodes.length} asset(s) registered`);

  if (options.open ?? config.dev?.open ?? false) {
    openBrowser(server.url);
  }

  const shutdown = async (): Promise<void> => {
    console.log("\nShutting down dev server…");
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  // Keep the process alive until interrupted.
  await new Promise<void>(() => {});
}

export function createDevCommand(): Command {
  return new Command("dev")
    .description("Start the dev server with granular HMR for scenes, images, and audio")
    .option("-c, --config <path>", "Path to config file", "cinecode.config.js")
    .option("-p, --port <number>", "Port to listen on", (v) => parseInt(v, 10))
    .option("--host <host>", "Host to bind")
    .option("--open", "Open the preview in the browser", false)
    .option("--no-hmr", "Disable the HMR socket push")
    .action(async (options: DevCliOptions) => {
      await devCommand(options);
    });
}
