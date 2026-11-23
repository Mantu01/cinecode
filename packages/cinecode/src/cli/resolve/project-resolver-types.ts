import type { CinecodeConfig, Composition } from "../../core/types/index.js";
import type { ConfigSource } from "../../config/project.js";
import type { ProjectContext } from "./project-context.js";
import type { createMediaCache } from "../../media/cache.js";
import type { MediaCatalog, MediaIndex } from "../../media/index.js";
import type {
  ManifestProject,
  ManifestValidationResult,
  ResolvedTarget,
} from "../../manifest/index.js";
import type { CompositionValidation } from "../../core/validation/index.js";
import type { PluginRegistry } from "../../plugin/registry.js";
import type { RegisteredPlugin } from "../../plugin/types.js";
import type { ProjectMode, ProjectSelection } from "./project-selection.js";

export interface MediaAccess {
  readonly index: MediaIndex;
  readonly catalog: MediaCatalog;
  readonly cache: ReturnType<typeof createMediaCache>;
  readonly root: string;
}

export interface ProjectResolution {
  readonly mode: ProjectMode;
  readonly root: string;
  readonly configPath: string;
  readonly config: CinecodeConfig;
  readonly source: ConfigSource | "standalone";
  /** Absolute roots and explicit key set shared by every command. */
  readonly context: ProjectContext;
  readonly manifestPath: string;
  readonly manifest: ManifestProject | null;
  readonly validation?: ManifestValidationResult;
  readonly selection: ProjectSelection;
  /** Compositions loaded from an explicit file; empty in project mode. */
  readonly compositions: readonly Composition[];
  /** Media index handle; the scan runs once per invocation. */
  readonly media: () => Promise<MediaAccess>;
  /** Compositions for the resolved selection (timeline, scene or file). */
  readonly selected: () => Promise<readonly Composition[]>;
  /** Every timeline and scene in the manifest, for project-wide validation. */
  readonly all: () => Promise<readonly Composition[]>;
  /** Shared timeline validation for every composition, cached per invocation. */
  readonly validateCompositions: () => Promise<readonly CompositionValidation[]>;
  /** Populated by validateCompositions() so every command reads the same result. */
  readonly compositionValidation?: readonly CompositionValidation[];
  readonly targets: () => Promise<readonly ResolvedTarget[]>;
  readonly plugins?: readonly RegisteredPlugin[];
  readonly pluginRegistry?: PluginRegistry;
}
