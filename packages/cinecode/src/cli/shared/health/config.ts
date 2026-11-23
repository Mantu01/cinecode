import { validateConfig } from "../../../config/validator.js";
import type { ProjectResolution } from "../../resolve/project-resolver.js";
import type { HealthSection } from "./types.js";

export function collectConfigHealth(
  resolution: ProjectResolution | null | undefined,
  issues: string[],
): HealthSection {
  if (!resolution) {
    return {
      name: "Config",
      status: "SKIPPED",
      message: "No configuration file (project-free mode)",
    };
  }
  try {
    const validation = validateConfig(resolution.config, resolution.configPath, resolution.root);
    if (validation.errors.length === 0) {
      return {
        name: "Config",
        status: "PASS",
        message: `Configuration valid (${resolution.configPath})`,
        details: { valid: true, path: resolution.configPath, errors: [] },
      };
    }
    const errorMsgs = validation.errors.map((e) => e.message);
    issues.push(...errorMsgs);
    return {
      name: "Config",
      status: "FAIL",
      message: errorMsgs.join(" | "),
      details: { valid: false, path: resolution.configPath, errors: errorMsgs },
      fixHint: "Correct invalid configuration properties in cinecode.config.ts",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    issues.push(`Config check error: ${msg}`);
    return {
      name: "Config",
      status: "FAIL",
      message: `Config check failed: ${msg}`,
      fixHint: "Fix syntax or type errors in configuration file",
    };
  }
}
