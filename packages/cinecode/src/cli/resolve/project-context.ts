import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CinecodeConfig } from "../../core/types/index.js";
import { getDefaultConfig, loadConfigDocument, type ConfigFieldTrace } from "../../config/schema.js";
import { resolveProjectLocation, type ConfigSource } from "../../config/project.js";
import { resolveProjectRoots, type ProjectRoots } from "../../config/roots.js";

export { resolveProjectRoots };
export type { ProjectRoots };

export interface ProjectContext {
  readonly root: string;
  readonly configPath: string;
  readonly source: ConfigSource | "standalone";
  readonly config: CinecodeConfig;
  readonly explicit: ReadonlySet<string>;
  readonly trace?: ReadonlyMap<string, ConfigFieldTrace>;
  readonly roots: ProjectRoots;
}

export interface ProjectContextOptions {
  readonly root?: string;
  readonly config?: string;
  readonly cwd?: string;
  readonly fresh?: boolean;
  /** File/API mode without a config: the root is the given cwd. */
  readonly allowStandalone?: boolean;
  readonly allowErrors?: boolean;
}

export function createProjectContext(
  location: { readonly root: string; readonly configPath: string; readonly source: ConfigSource | "standalone" },
  config: CinecodeConfig,
  explicit: ReadonlySet<string> = new Set(),
  trace?: ReadonlyMap<string, ConfigFieldTrace>,
): ProjectContext {
  return {
    root: location.root,
    configPath: location.configPath,
    source: location.source,
    config,
    explicit,
    trace,
    roots: resolveProjectRoots(location.root, config),
  };
}

/** The one place project resolution and config loading join. */
export async function loadProjectContext(options: ProjectContextOptions = {}): Promise<ProjectContext> {
  const canStandalone = options.allowStandalone === true && options.root === undefined && options.config === undefined;
  let location: { root: string; configPath: string; source: ConfigSource | "standalone" };
  if (canStandalone) {
    try {
      location = resolveProjectLocation(options);
    } catch {
      location = { root: resolve(options.cwd ?? process.cwd()), configPath: "", source: "standalone" };
    }
  } else {
    location = resolveProjectLocation(options);
  }
  const hasConfig = location.configPath !== "" && existsSync(location.configPath);
  if (!hasConfig && options.allowStandalone === true) {
    return createProjectContext(location, getDefaultConfig());
  }
  const loaded = await loadConfigDocument(location.configPath, { fresh: options.fresh, root: location.root, allowErrors: options.allowErrors });
  return createProjectContext(location, loaded.config, loaded.explicit, loaded.trace);
}
