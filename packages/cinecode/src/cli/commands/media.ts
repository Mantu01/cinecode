import { Command } from "commander";
import { mediaListCommand, type MediaListOptions } from "../pipeline/media-list.js";
import { mediaDownloadCommand, type MediaDownloadOptions } from "../pipeline/media-download.js";

export async function mediaCommand(
  action = "list",
  ...rest: unknown[]
): Promise<void> {
  const options = (rest.find((r) => typeof r === "object" && r !== null && !Array.isArray(r)) ?? {}) as Record<string, unknown>;

  if (action === "download") {
    await mediaDownloadCommand(options as MediaDownloadOptions);
  } else {
    await mediaListCommand(options as MediaListOptions);
  }
}

