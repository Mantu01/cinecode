import { runPreviewHost, type DevCliOptions, type DevPreflightContext } from "../pipeline/preview-host.js";

export async function previewCommand(
  options: DevCliOptions,
  preflightCtx?: DevPreflightContext,
): Promise<void> {
  await runPreviewHost(options, "preview", preflightCtx);
}
