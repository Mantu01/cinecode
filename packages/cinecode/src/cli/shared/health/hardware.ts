import { detectHardwareAcceleration } from "../../../core/quality.js";
import type { HealthSection } from "./types.js";

export function collectHardwareHealth(): HealthSection {
  try {
    const backend = detectHardwareAcceleration();
    return {
      name: "Hardware Acceleration",
      status: "PASS",
      message: backend !== "software" ? `Detected hardware encoder: ${backend}` : "Using software encoder (no hardware acceleration detected)",
      details: { detected: backend !== "software", backend },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "Hardware Acceleration",
      status: "WARN",
      message: `Hardware acceleration probe error: ${msg}`,
    };
  }
}
