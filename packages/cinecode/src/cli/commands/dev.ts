import { runPreviewHost, type DevCliOptions, type DevPreflightContext } from "../pipeline/preview-host.js";

export async function devCommand(
  options: DevCliOptions,
  preflightCtx?: DevPreflightContext,
): Promise<void> {
  await runPreviewHost(options, "dev", preflightCtx);
}
