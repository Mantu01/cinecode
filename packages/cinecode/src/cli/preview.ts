import { Command } from "commander";
import { devCommand } from "./dev.js";

export interface PreviewCliOptions {
  config?: string;
  root?: string;
  port?: number;
  host?: string;
  open?: boolean;
  hmr?: boolean;
}

export async function previewCommand(options: PreviewCliOptions): Promise<void> {
  await devCommand({
    ...options,
    open: options.open ?? true,
  });
}

export function createPreviewCommand(): Command {
  const cmd = new Command("preview")
    .description("Start the read-only preview server and open viewer")
    .option("-p, --port <number>", "Port to listen on", (v) => parseInt(v, 10))
    .option("--host <host>", "Host to bind")
    .option("--open", "Open the preview in the browser", true)
    .option("--no-open", "Do not automatically open browser", false)
    .option("--no-hmr", "Disable the HMR socket push")
    .action(async (options: PreviewCliOptions, command: Command) => {
      await previewCommand({ ...command.optsWithGlobals(), ...options });
    });

  return cmd;
}