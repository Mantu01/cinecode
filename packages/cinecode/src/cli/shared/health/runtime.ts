import { arch, platform } from "node:os";
import { checkRuntime } from "../../../loader/index.js";
import type { HealthSection } from "./types.js";

export interface RuntimeHealth {
  readonly section: HealthSection;
  readonly version: string;
  readonly compatible: boolean;
  readonly minimum: string;
  readonly loaderMode: string;
}

export function collectRuntimeHealth(issues: string[]): RuntimeHealth {
  try {
    const runtime = checkRuntime();
    const plat = platform();
    const architecture = arch();
    if (!runtime.supported) {
      issues.push(`Node.js ${runtime.version} is below required ${runtime.minimum}`);
    }
    return {
      version: runtime.version,
      compatible: runtime.supported,
      minimum: runtime.minimum,
      loaderMode: runtime.loaderMode,
      section: {
        name: "Runtime",
        status: runtime.supported ? "PASS" : "FAIL",
        message: `Node.js ${runtime.version} (${runtime.supported ? "supported" : "unsupported"}, ${runtime.loaderMode}, ${plat} ${architecture})`,
        details: {
          nodeVersion: runtime.version,
          compatible: runtime.supported,
          minimum: runtime.minimum,
          loaderMode: runtime.loaderMode,
          authoringContract: runtime.authoringContract,
          platform: plat,
          arch: architecture,
        },
        fixHint: runtime.supported ? undefined : `Upgrade Node.js to >= ${runtime.minimum}`,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    issues.push(`Runtime check error: ${msg}`);
    return {
      version: process.version,
      compatible: true,
      minimum: "22.18.0",
      loaderMode: "esm",
      section: {
        name: "Runtime",
        status: "FAIL",
        message: `Runtime check failed: ${msg}`,
        fixHint: "Ensure Node.js environment is valid",
      },
    };
  }
}
