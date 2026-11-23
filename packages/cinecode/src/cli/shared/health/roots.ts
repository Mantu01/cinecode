import { access, constants } from "node:fs/promises";
import type { ProjectResolution } from "../../resolve/project-resolver.js";
import type { HealthSection } from "./types.js";

export async function collectRootsHealth(
  resolution: ProjectResolution | null | undefined,
): Promise<HealthSection> {
  if (!resolution) {
    return {
      name: "Roots",
      status: "SKIPPED",
      message: "No project roots (project-free mode)",
    };
  }
  const roots = resolution.context.roots;
  const unwritable: string[] = [];
  for (const dir of [roots.source, roots.media, roots.output, roots.cache]) {
    try {
      await access(dir, constants.W_OK);
    } catch {
      unwritable.push(dir);
    }
  }
  if (unwritable.length === 0) {
    return {
      name: "Roots",
      status: "PASS",
      message: "sourceDir, mediaDir, outputDir, cacheDir exist and writable",
      details: { ...roots, writable: true },
    };
  }
  return {
    name: "Roots",
    status: "FAIL",
    message: `Folders not existing or not writable: ${unwritable.join(", ")}`,
    details: { ...roots, writable: false, unwritable },
    fixHint: "Ensure project directories exist and have write permissions",
  };
}
