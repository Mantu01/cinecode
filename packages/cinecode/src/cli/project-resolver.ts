import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type {
  CinecodeConfig,
  Composition,
  QualitySetting,
  RenderFormat,
  VideoCodec,
} from "../core/types/index.js";
import type { ConfigSource } from "../config/project.js";
import { loadProjectContext, type ProjectContext } from "./project-context.js";
import { createMediaCache } from "../media/cache.js";
import { createMediaResolver, type MediaCatalog, type MediaIndex } from "../media/index.js";
import { createError, ErrorCode, isCinecodeError } from "../errors/index.js";
import { recordDegradation } from "../errors/degradations.js";
import {
  assembleTimelineComposition,
  composeSceneComposition,
  findEntry,
  loadManifestProject,
  resolveEntryFile,
  validateManifestDocument,
  resolveTarget,
  type ManifestProject,
  type ManifestValidationResult,
  type ResolvedTarget,
} from "../manifest/index.js";
import { mediaIgnore } from "./shared.js";
import { loadComposition, selectComposition } from "./composition-loader.js";
import { runReport } from "./run-report.js";
import { getOutputPlan } from "../core/output-plan.js";
import { validateComposition, type CompositionValidation } from "../core/validation/index.js";
import { getPluginRegistry, setPluginRegistry, PluginRegistry } from "../plugin/registry.js";
import { loadProjectPlugins } from "../plugin/loader.js";
import type { RegisteredPlugin } from "../plugin/types.js";

export type ProjectMode = "project" | "file";
export type SelectionKind = "timeline" | "scene" | "composition" | "all" | "none";

export interface ProjectSelection {
  readonly kind: SelectionKind;
  readonly id?: string;
  readonly ids: readonly string[];
}

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

export interface ResolveProjectOptions {
  readonly root?: string;
  readonly config?: string;
  readonly cwd?: string;
  readonly fresh?: boolean;
  /** Standalone composition file. Presence selects file mode. */
  readonly file?: string;
  readonly composition?: string;
  readonly timeline?: string;
  readonly scene?: string;
  readonly all?: boolean;
  /** Fail when project mode has no explicit timeline/scene/all selector. */
  readonly requireSelection?: boolean;
  /** Only render accepts `--all`, because it writes one file per timeline. */
  readonly allowAll?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly format?: RenderFormat;
  readonly codec?: VideoCodec;
  readonly quality?: QualitySetting;
  readonly alpha?: boolean;
}

function invalid(reason: string, path?: string): never {
  throw createError(
    ErrorCode.CC0001,
    { reason },
    path ? { location: { file: path } } : {},
  );
}

function manifestFailure(error: unknown, path: string): never {
  if (isCinecodeError(error)) throw error;
  recordDegradation({
    code: ErrorCode.CC1010,
    what: "project manifest could not be loaded",
    reason: error instanceof Error ? error.message : String(error),
    input: path,
    instead: "no compositions were assembled from the manifest",
  });
  throw createError(
    ErrorCode.CC1010,
    { path, reason: error instanceof Error ? error.message : String(error) },
    { location: { file: path }, cause: error },
  );
}

function assertSelectors(options: ResolveProjectOptions): void {
  const manifestSelectors = [
    options.timeline !== undefined ? "--timeline" : "",
    options.scene !== undefined ? "--scene" : "",
    options.all === true ? "--all" : "",
  ].filter(Boolean);

  if (options.file) {
    if (manifestSelectors.length > 0) {
      invalid("--timeline, --scene and --all select from the manifest and cannot be combined with --file");
    }
    return;
  }

  if (options.composition !== undefined) {
    invalid("--composition selects a composition inside --file; it cannot be used without --file");
  }

  if (manifestSelectors.length > 1) {
    invalid(`Conflicting selectors: ${manifestSelectors.join(" and ")} cannot be combined`);
  }
}

function selectFromProject(
  project: ManifestProject,
  options: ResolveProjectOptions,
  configPath: string,
): ProjectSelection {
  const timelines = project.manifest.timelines ?? [];
  const scenes = project.manifest.scenes ?? [];
  if (options.all) {
    if (!options.allowAll) {
      invalid("--all rerenders every timeline and is not valid for this command; pass one selector");
    }
    if (timelines.length === 0) {
      throw createError(ErrorCode.CC1010, {
        path: project.entryPath,
        reason: `manifest at ${project.entryPath} (read from config at ${configPath}) has no timelines to render`,
      }, { location: { file: project.entryPath } });
    }
    return { kind: "all", ids: timelines.map((timeline) => timeline.id) };
  }
  if (options.timeline !== undefined) {
    findEntry(timelines, options.timeline, "timeline");
    return { kind: "timeline", id: options.timeline, ids: [options.timeline] };
  }
  if (options.scene !== undefined) {
    findEntry(scenes, options.scene, "scene");
    return { kind: "scene", id: options.scene, ids: [options.scene] };
  }
  if (options.allowAll && !options.requireSelection) {
    if (timelines.length === 0) {
      throw createError(ErrorCode.CC1010, {
        path: project.entryPath,
        reason: `manifest at ${project.entryPath} (read from config at ${configPath}) has no timelines to render`,
      }, { location: { file: project.entryPath } });
    }
    return { kind: "all", ids: timelines.map((timeline) => timeline.id) };
  }
  if (options.requireSelection) {
    const available = [
      `timelines: ${timelines.map((entry) => entry.id).join(", ") || "none"}`,
      `scenes: ${scenes.map((entry) => entry.id).join(", ") || "none"}`,
    ].join("; ");
    throw createError(ErrorCode.CC1012, {
      reason: `No selection. Pass --timeline <id>, --scene <id>${options.allowAll ? ", or --all" : ""}. Available ${available}`,
    }, { location: { file: project.entryPath } });
  }
  return { kind: "none", ids: [] };
}

function selectFromFile(
  compositions: readonly Composition[],
  options: ResolveProjectOptions,
): ProjectSelection {
  const selected = selectComposition([...compositions], options.composition);
  return { kind: "composition", id: selected.name, ids: [selected.name] };
}

function loadProjectConfig(options: ResolveProjectOptions, allowStandalone: boolean): Promise<ProjectContext> {
  return loadProjectContext({
    root: options.root,
    config: options.config,
    cwd: options.cwd,
    fresh: options.fresh,
    allowStandalone,
  });
}

/** One resolution per invocation; repeated reads reuse the same promises. */
export class ProjectResolver {
  private readonly moduleCache = new Map<string, unknown>();
  private pending: Promise<ProjectResolution> | undefined;
  private mediaPending: Promise<MediaAccess> | undefined;
  private selectedPending: Promise<readonly Composition[]> | undefined;
  private allPending: Promise<readonly Composition[]> | undefined;
  private targetsPending: Promise<readonly ResolvedTarget[]> | undefined;
  private validationPending: Promise<readonly CompositionValidation[]> | undefined;
  private resolved: ProjectResolution | undefined;

  constructor(private readonly options: ResolveProjectOptions) {}

  resolve(): Promise<ProjectResolution> {
    this.pending ??= this.build();
    return this.pending;
  }

  media(): Promise<MediaAccess> {
    this.mediaPending ??= this.buildMedia();
    return this.mediaPending;
  }

  selected(): Promise<readonly Composition[]> {
    this.selectedPending ??= this.buildSelected();
    return this.selectedPending;
  }

  targets(): Promise<readonly ResolvedTarget[]> {
    this.targetsPending ??= this.buildTargets();
    return this.targetsPending;
  }

  private async buildTargets(): Promise<readonly ResolvedTarget[]> {
    const resolution = await this.resolve();
    if (resolution.mode === "file") {
      const selected = await this.selected();
      return selected.map((comp) => ({
        id: comp.name,
        kind: "timeline" as const,
        entry: { id: comp.name },
        composition: comp,
        geometry: {
          width: comp.width,
          height: comp.height,
          fps: comp.fps,
          background: typeof comp.background === "string" ? comp.background : "#000000",
          duration: (typeof comp.duration === "number" ? comp.duration : comp.contentDuration) ?? 0,
          contentDuration: comp.contentDuration ?? (typeof comp.duration === "number" ? comp.duration : 0),
          truncate: false,
          format: "mp4" as const,
          quality: "medium" as const,
          outputPlan: { format: "mp4" as const, plan: getOutputPlan("mp4")!, alpha: false, inputPixFmt: "rgb0" as const },
        },
        outputPlan: { format: "mp4" as const, plan: getOutputPlan("mp4")!, alpha: false, inputPixFmt: "rgb0" as const },
        audioPlacement: comp.audioPlacements ?? [],
        format: "mp4" as const,
        codec: undefined,
        quality: "medium" as const,
      }));
    }
    const project = resolution.manifest!;
    const selection = resolution.selection;
    const flags = {
      width: this.options.width,
      height: this.options.height,
      fps: this.options.fps,
      format: this.options.format,
      codec: this.options.codec,
      quality: this.options.quality,
      alpha: this.options.alpha,
    };
    if (selection.kind === "all") {
      return Promise.all(selection.ids.map((id) => resolveTarget(project, id, { flags })));
    }
    if (selection.id) {
      return [await resolveTarget(project, selection.id, { flags })];
    }
    return [];
  }

  all(): Promise<readonly Composition[]> {
    this.allPending ??= this.buildAll();
    return this.allPending;
  }

  validateCompositions(): Promise<readonly CompositionValidation[]> {
    this.validationPending ??= (async () => {
      const results = (await this.all()).map((composition) => validateComposition(composition));
      if (this.resolved) {
        (this.resolved as { compositionValidation?: readonly CompositionValidation[] }).compositionValidation = results;
      }
      return results;
    })();
    return this.validationPending;
  }

  private async buildMedia(): Promise<MediaAccess> {
    const project = await this.resolve();
    const cache = createMediaCache(project.context.roots.cache);
    await cache.initialize();
    const catalog = createMediaResolver({
      sourceDir: project.context.roots.source,
      mediaDir: project.context.roots.media,
      projectRoot: project.root,
      allowCoLocatedMedia: project.config.allowCoLocatedMedia,
      cache,
      cloudMedia: project.config.cloudMedia,
      ignore: mediaIgnore(project.config),
      manifest: project.manifest?.manifest,
      compositions: project.compositions,
    });
    await catalog.initialize();
    return { index: catalog.index, catalog, cache, root: project.root };
  }

  private async buildSelected(): Promise<readonly Composition[]> {
    const resolution = await this.resolve();
    if (resolution.mode === "file") {
      return resolution.compositions.filter((composition) => composition.name === resolution.selection.id);
    }
    const selection = resolution.selection;
    if (selection.kind === "all") {
      return Promise.all(selection.ids.map((id) => assembleTimelineComposition(resolution.manifest!, id)));
    }
    if (selection.kind === "scene") return [await composeSceneComposition(resolution.manifest!, selection.id!)];
    if (selection.kind === "timeline") return [await assembleTimelineComposition(resolution.manifest!, selection.id!)];
    invalid("No timeline or scene selected", resolution.manifestPath);
  }

  private async buildAll(): Promise<readonly Composition[]> {
    const resolution = await this.resolve();
    if (resolution.mode === "file") return resolution.compositions;
    const project = resolution.manifest!;
    const timelines = await Promise.all(
      (project.manifest.timelines ?? []).map((entry) => assembleTimelineComposition(project, entry.id)),
    );
    const scenes = await Promise.all(
      (project.manifest.scenes ?? []).map((entry) => composeSceneComposition(project, entry.id)),
    );
    return [...timelines, ...scenes];
  }

  private async build(): Promise<ProjectResolution> {
    const { options } = this;
    assertSelectors(options);

    if (options.file) {
      if (options.timeline !== undefined || options.scene !== undefined || options.all) {
        invalid("--timeline, --scene and --all select from the manifest and cannot be combined with --file");
      }
      const base = await loadProjectConfig(options, true);
      const filePath = isAbsolute(options.file) ? options.file : resolve(base.root, options.file);
      if (!existsSync(filePath)) {
        throw createError(ErrorCode.CC1009, { path: filePath }, { location: { file: filePath } });
      }
      const compositions = await loadComposition(filePath);
      const pluginRegistry = new PluginRegistry();
      setPluginRegistry(pluginRegistry);
      await loadProjectPlugins(base.config, pluginRegistry, base.root);
      const resolution: ProjectResolution = {
        mode: "file",
        root: base.root,
        configPath: base.configPath,
        config: base.config,
        source: base.source,
        context: base,
        manifestPath: filePath,
        manifest: null,
        selection: selectFromFile(compositions, options),
        compositions,
        media: () => this.media(),
        selected: () => this.selected(),
        all: () => this.all(),
        targets: () => this.targets(),
        validateCompositions: () => this.validateCompositions(),
        plugins: pluginRegistry.getAll(),
        pluginRegistry,
      };
      this.resolved = resolution;
      return resolution;
    }

    if (options.composition !== undefined) {
      invalid("--composition selects a composition inside --file; it cannot be used without --file");
    }

    const context = await loadProjectConfig(options, false);
    const { config } = context;

    let project: ManifestProject;
    try {
      project = await loadManifestProject(config, context.root);
    } catch (error) {
      manifestFailure(error, resolveEntryFile(config.project?.entry ?? "./main.ts", context.root));
    }

    if (!project.hasManifest) {
      throw createError(ErrorCode.CC1009, { path: project.entryPath }, {
        location: { file: project.entryPath },
        fixHint: `Create ${project.entryPath} exporting defineMain({ timelines, scenes }), or render a standalone file with --file <path>`,
      });
    }

    const validation = await validateManifestDocument(project.rawManifest ?? project.manifest, {
      rootDir: context.root,
      manifestPath: project.entryPath,
      config,
      moduleCache: this.moduleCache,
    });
    project = { ...project, validation, moduleCache: this.moduleCache };

    if (!validation.valid && validation.errors.length > 0) {
      const first = validation.errors[0]!;
      Object.assign(first, { issues: validation.errors }); // Note: attach aggregate issues array to primary error
      throw first;
    }

    const manifest = project.manifest;
    const populated = [manifest.timelines, manifest.scenes, manifest.images, manifest.audio].some(
      (entries) => (entries?.length ?? 0) > 0,
    );
    if (!populated) {
      throw createError(ErrorCode.CC1010, {
        path: project.entryPath,
        reason: `manifest at ${project.entryPath} (read from config at ${context.configPath}) registers no timelines, scenes, images or audio; export defineMain(...) or use --file`,
      }, { location: { file: project.entryPath } });
    }

    const pluginRegistry = new PluginRegistry();
    setPluginRegistry(pluginRegistry);
    await loadProjectPlugins(config, pluginRegistry, context.root);

    const resolution: ProjectResolution = {
      mode: "project",
      root: context.root,
      configPath: context.configPath,
      config,
      source: context.source,
      context,
      manifestPath: project.entryPath,
      manifest: project,
      validation,
      selection: selectFromProject(project, options, context.configPath),
      compositions: [],
      media: () => this.media(),
      selected: () => this.selected(),
      all: () => this.all(),
      targets: () => this.targets(),
      validateCompositions: () => this.validateCompositions(),
      plugins: pluginRegistry.getAll(),
      pluginRegistry,
    };
    this.resolved = resolution;
    return resolution;
  }

  /** Plain record for machine output. */
  describe(): Record<string, unknown> | undefined {
    if (!this.resolved) return undefined;
    return describeResolution(this.resolved);
  }
}

export function describeResolution(resolution: ProjectResolution): Record<string, unknown> {
  return {
    mode: resolution.mode,
    root: resolution.root,
    config: resolution.configPath || null,
    source: resolution.source,
    manifest: resolution.manifestPath,
    roots: resolution.context.roots,
    ...(resolution.compositionValidation
      ? {
          timelineValidation: {
            valid: resolution.compositionValidation.every((result) => result.valid),
            compositions: resolution.compositionValidation.map((result) => ({
              composition: result.composition,
              errors: result.errors.length,
              warnings: result.warnings.length,
            })),
          },
        }
      : {}),
    selection: {
      kind: resolution.selection.kind,
      id: resolution.selection.id ?? null,
      ids: [...resolution.selection.ids],
    },
  };
}

export function selectionLabel(selection: ProjectSelection): string {
  return selection.id === undefined ? selection.kind : `${selection.kind} ${selection.id}`;
}

/** Prints the resolved record and carries the same record into `--json`. */
export function reportResolution(resolution: ProjectResolution, print = false): void {
  runReport.setCacheDir(resolution.context.roots.cache);
  runReport.setProject({
    root: resolution.root,
    config: resolution.configPath || undefined,
    manifest: resolution.manifestPath,
    source: resolution.source,
    mode: resolution.mode,
    selection: selectionLabel(resolution.selection),
  });
  runReport.resolution(describeResolution(resolution));
  if (!print) return;
  console.log(`Project:   ${resolution.root}`);
  console.log(`Config:    ${resolution.configPath || "none (standalone)"} (${resolution.source})`);
  console.log(`Manifest:  ${resolution.manifestPath}`);
  console.log(`Mode:      ${resolution.mode}`);
  console.log(`Selection: ${selectionLabel(resolution.selection)}`);
}

export function createProjectResolver(options: ResolveProjectOptions): ProjectResolver {
  return new ProjectResolver(options);
}

export async function resolveProject(options: ResolveProjectOptions): Promise<ProjectResolution> {
  return createProjectResolver(options).resolve();
}
