import type { ProjectResolution } from "../../resolve/project-resolver.js";
import type { HealthSection } from "./types.js";

export function collectManifestHealth(
  resolution: ProjectResolution | null | undefined,
  issues: string[],
): HealthSection {
  if (!resolution) {
    return {
      name: "Manifest",
      status: "SKIPPED",
      message: "No manifest (project-free mode)",
    };
  }
  if (!resolution.manifest) {
    return {
      name: "Manifest",
      status: "INFO",
      message: `Standalone file entry: ${resolution.manifestPath}`,
      details: { valid: true, standalone: true },
    };
  }
  const valid = resolution.manifest.validation?.valid ?? true;
  const errors = resolution.manifest.validation?.errors ?? [];
  if (valid) {
    return {
      name: "Manifest",
      status: "PASS",
      message: `Manifest valid (${resolution.manifest.entryPath})`,
      details: {
        valid: true,
        entryPath: resolution.manifest.entryPath,
        scenes: resolution.manifest.manifest.scenes?.length ?? 0,
        timelines: resolution.manifest.manifest.timelines?.length ?? 0,
      },
    };
  }
  const msgs = errors.map((e) => e.message);
  issues.push(...msgs);
  return {
    name: "Manifest",
    status: "FAIL",
    message: msgs.join(" | "),
    details: { valid: false, errors: msgs },
    fixHint: "Correct manifest definitions in entry file",
  };
}
