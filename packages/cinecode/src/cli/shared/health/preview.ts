import type { HealthSection } from "./types.js";

export interface PreviewHealth {
  readonly section: HealthSection;
  readonly canvasOk: boolean;
  readonly backend: string;
}

export async function collectPreviewHealth(issues: string[]): Promise<PreviewHealth> {
  const backend = "software";
  try {
    const canvasModule = await import("@napi-rs/canvas");
    const canvas = new canvasModule.Canvas(8, 8);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 8, 8);
    return {
      canvasOk: true,
      backend,
      section: {
        name: "Preview",
        status: "PASS",
        message: "Canvas renderer available (skia, software)",
        details: { canvasAvailable: true, backend, accelerated: false },
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    issues.push(`Canvas initialization failed: ${msg}`);
    return {
      canvasOk: false,
      backend: "none",
      section: {
        name: "Preview",
        status: "FAIL",
        message: `Canvas initialization failed: ${msg}`,
        details: { canvasAvailable: false, backend: "none" },
        fixHint: "Install or rebuild @napi-rs/canvas for your platform",
      },
    };
  }
}
