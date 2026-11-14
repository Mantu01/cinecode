import type { CinecodeConfig } from "../core/types/index.js";

export type Subsystem =
  | "audio_mixer"
  | "motion_timing"
  | "canvas_geometry"
  | "encoder_settings"
  | "dev_server"
  | "render_cache"
  | "full_reboot";

export interface ConfigDiffReport {
  changedPaths: string[];
  affectedSubsystems: Subsystem[];
  requiresFullRestart: boolean;
}

export class ConfigDependencyTracker {
  static mapPathToSubsystem(path: string): Subsystem {
    if (path.startsWith("dev.")) return "dev_server";
    if (path.startsWith("audio.")) return "audio_mixer";
    if (path === "video.fps") return "motion_timing";
    if (path === "video.background" || path === "video.width" || path === "video.height") return "canvas_geometry";
    if (path.startsWith("render.")) return "encoder_settings";
    if (path.startsWith("plugins") || path.startsWith("project.entry")) return "full_reboot";
    return "render_cache";
  }

  static diff(oldConfig: Record<string, any>, newConfig: Record<string, any>): ConfigDiffReport {
    const changedPaths: string[] = [];
    const subsystems = new Set<Subsystem>();

    function compareObjects(a: Record<string, any>, b: Record<string, any>, prefix = ""): void {
      const allKeys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
      for (const key of allKeys) {
        const fullPath = prefix ? `${prefix}.${key}` : key;
        const valA = a ? a[key] : undefined;
        const valB = b ? b[key] : undefined;

        if (typeof valA === "object" && valA !== null && typeof valB === "object" && valB !== null && !Array.isArray(valA) && !Array.isArray(valB)) {
          compareObjects(valA, valB, fullPath);
        } else if (JSON.stringify(valA) !== JSON.stringify(valB)) {
          changedPaths.push(fullPath);
          subsystems.add(ConfigDependencyTracker.mapPathToSubsystem(fullPath));
        }
      }
    }

    compareObjects(oldConfig, newConfig);

    const requiresFullRestart = subsystems.has("full_reboot");

    return {
      changedPaths,
      affectedSubsystems: [...subsystems],
      requiresFullRestart,
    };
  }
}
