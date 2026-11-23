import type { CinecodeConfig } from "../../../core/types/index.js";
import type { HealthSection } from "./types.js";

export async function collectFontsHealth(
  config: CinecodeConfig | undefined,
  projectRoot: string,
  isProject: boolean,
  issues: string[],
): Promise<HealthSection> {
  if (!isProject || !config) {
    return {
      name: "Fonts",
      status: "SKIPPED",
      message: "No project configured (project-free mode)",
    };
  }
  if (!config.fonts || config.fonts.length === 0) {
    return {
      name: "Fonts",
      status: "PASS",
      message: "No custom fonts configured",
      details: { count: 0, families: [], errors: [], warnings: [] },
    };
  }
  try {
    const { registerProjectFonts, describeRegisteredFonts } = await import("../../../renderer/text/fonts.js");
    const result = registerProjectFonts(config.fonts, {
      projectRoot,
      mediaDir: config.mediaDir ?? "media",
    });
    if (result.errors.length > 0) {
      const first = result.errors[0]!;
      issues.push(`Font registration failed for "${first.family}": ${first.message}`);
      return {
        name: "Fonts",
        status: "FAIL",
        message: `Font registration failed for "${first.family}": ${first.message}`,
        details: {
          count: 0,
          families: [],
          errors: result.errors.map((e) => e.message),
          warnings: result.warnings,
        },
        fixHint: "Ensure custom font files exist at the configured paths",
      };
    }
    const desc = describeRegisteredFonts();
    return {
      name: "Fonts",
      status: result.warnings.length > 0 ? "WARN" : "PASS",
      message: `${desc.count} font(s) registered: ${desc.families.join(", ")}${result.warnings.length > 0 ? ` (${result.warnings.length} duplicate family entry ignored)` : ""}`,
      details: {
        count: desc.count,
        families: desc.families,
        errors: [],
        warnings: result.warnings,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    issues.push(`Font loading error: ${msg}`);
    return {
      name: "Fonts",
      status: "FAIL",
      message: `Font check failed: ${msg}`,
      fixHint: "Verify font files and configuration",
    };
  }
}
