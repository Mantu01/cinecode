import { checkGitignoreEntries } from "../../../config/gitignore.js";
import { authoredRoots } from "../../../config/roots.js";
import type { CinecodeConfig } from "../../../core/types/index.js";
import type { HealthSection } from "./types.js";

export async function collectGitignoreHealth(
  config: CinecodeConfig | undefined,
  projectRoot: string,
  isProject: boolean,
): Promise<HealthSection> {
  if (!isProject || !config) {
    return {
      name: ".gitignore",
      status: "SKIPPED",
      message: "No project .gitignore check (project-free mode)",
    };
  }
  try {
    const authored = authoredRoots(config);
    const res = await checkGitignoreEntries({
      sourceDir: authored.source,
      mediaDir: authored.media,
      outputDir: authored.output,
      cacheDir: authored.cache,
      projectRoot,
      enabled: config.gitignore ?? true,
    });
    if (res.missing.length === 0) {
      return {
        name: ".gitignore",
        status: "PASS",
        message: "All required managed entries present",
        details: { missing: [], present: res.present },
        fixable: false,
      };
    }
    return {
      name: ".gitignore",
      status: "WARN",
      message: `Missing entries: ${res.missing.join(", ")}`,
      details: { missing: res.missing, present: res.present },
      fixHint: "Run `cinecode doctor --fix` to add missing entries to .gitignore",
      fixable: true,
    };
  } catch {
    return {
      name: ".gitignore",
      status: "WARN",
      message: "Could not read .gitignore",
      fixable: true,
    };
  }
}
