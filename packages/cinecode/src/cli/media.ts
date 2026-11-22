import { Command } from "commander";
import { mediaListCommand, type MediaListOptions } from "./media-list.js";
import { mediaDownloadCommand, type MediaDownloadOptions } from "./media-download.js";
import { findCommand, buildCommanderCommand } from "./command-registry.js";

export async function mediaCommand(
  actionOrOptions?: string | Record<string, unknown>,
  maybeOptions?: Record<string, unknown>,
): Promise<void> {
  const isActionString = typeof actionOrOptions === "string";
  const action = isActionString ? actionOrOptions : "list";
  const options = ((isActionString ? maybeOptions : actionOrOptions) ?? {}) as Record<string, unknown>;

  if (action === "download") {
    await mediaDownloadCommand(options as MediaDownloadOptions);
  } else {
    await mediaListCommand(options as MediaListOptions);
  }
}

export function createMediaCommand(): Command {
  const spec = findCommand("media");
  if (!spec) throw new Error("Command 'media' not found in registry");
  return buildCommanderCommand(spec);
}
