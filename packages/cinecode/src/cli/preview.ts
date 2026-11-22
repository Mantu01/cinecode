import { Command } from "commander";
import { runPreviewHost, type DevCliOptions } from "./dev.js";
import { buildCommanderCommand, findCommand } from "./command-registry.js";

export type PreviewCliOptions = DevCliOptions;

export async function previewCommand(
  options: PreviewCliOptions,
  preflightCtx?: { config: import("../core/types/index.js").CinecodeConfig; root: string; configPath?: string },
): Promise<void> {
  await runPreviewHost(options, "preview", preflightCtx);
}

export function createPreviewCommand(): Command {
  return buildCommanderCommand(findCommand("preview")!);
}
