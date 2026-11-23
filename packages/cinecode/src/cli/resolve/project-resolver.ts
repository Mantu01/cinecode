import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { Composition } from "../../core/types/index.js";
import { loadProjectContext, type ProjectContext } from "./project-context.js";
import { createMediaCache } from "../../media/cache.js";
import { createMediaResolver } from "../../media/index.js";
import { createError, ErrorCode, isCinecodeError } from "../../errors/index.js";
import { recordDegradation } from "../../errors/degradations.js";
import {
  assembleTimelineComposition,
  composeSceneComposition,
  loadManifestProject,
  resolveEntryFile,
  validateManifestDocument,
  resolveTarget,
  type ManifestProject,
  type ResolvedTarget,
} from "../../manifest/index.js";
import { mediaIgnore } from "../shared/shared.js";
import { loadComposition } from "./composition-loader.js";
import { outputPlanFor } from "../../core/output-plan.js";
import { validateComposition, type CompositionValidation } from "../../core/validation/index.js";
import { setPluginRegistry, PluginRegistry } from "../../plugin/registry.js";
import { loadProjectPlugins } from "../../plugin/loader.js";
import {
  assertSelectors,
  invalid,
  selectFromFile,
  selectFromProject,
  describeResolution,
  type ResolveProjectOptions,
} from "./project-selection.js";
import type { MediaAccess, ProjectResolution } from "./project-resolver-types.js";

export * from "./project-selection.js";
export * from "./project-resolver-types.js";

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

function loadProjectConfig(options: ResolveProjectOptions, allowStandalone: boolean): Promise<ProjectContext> {
  return loadProjectContext({
    root: options.root,
    config: options.config,
    cwd: options.cwd,
    fresh: options.fresh,
    allowStandalone,
    allowErrors: options.forValidation === true,
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
      return selected.map((comp) => {
        const dur = (typeof comp.duration === "number" ? comp.duration : comp.contentDuration) ?? 0;
        const fps = comp.fps || 30;
        return {
          id: comp.name,
          kind: "timeline" as const,
          entry: { id: comp.name },
          composition: comp,
          geometry: {
            width: comp.width,
            height: comp.height,
            fps,
            background: typeof comp.background === "string" ? comp.background : "#000000",
            duration: dur,
            contentDuration: comp.contentDuration ?? (typeof comp.duration === "number" ? comp.duration : 0),
            totalFrames: Math.round(dur * fps),
            truncate: false,
            format: "mp4" as const,
            quality: "medium" as const,
            outputPlan: { format: "mp4" as const, plan: outputPlanFor("mp4"), alpha: false, inputPixFmt: "rgb0" as const },
          },
          outputPlan: { format: "mp4" as const, plan: outputPlanFor("mp4"), alpha: false, inputPixFmt: "rgb0" as const },
          audioPlacement: comp.audioPlacements ?? [],
          format: "mp4" as const,
          codec: undefined,
          quality: "medium" as const,
        };
      });
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
    if (selection.kind === "none") return [];
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
      if (!options.forValidation) {
        manifestFailure(error, resolveEntryFile(config.project?.entry ?? "./main.ts", context.root));
      }
      project = { rootDir: context.root, entryPath: resolveEntryFile(config.project?.entry ?? "./main.ts", context.root), config, manifest: { images: [], audio: [], scenes: [], timelines: [] }, hasManifest: false };
    }

    if (!project.hasManifest && !options.forValidation) {
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

    if (!validation.valid && validation.errors.length > 0 && !options.forValidation) {
      const first = validation.errors[0]!;
      Object.assign(first, { issues: validation.errors }); // Note: attach aggregate issues array to primary error
      throw first;
    }

    const manifest = project.manifest;
    const populated = [manifest.timelines, manifest.scenes, manifest.images, manifest.audio].some(
      (entries) => (entries?.length ?? 0) > 0,
    );
    if (!populated && !options.forValidation) {
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
      selection: options.forValidation && !options.timeline && !options.scene && !options.all
        ? { kind: "all", ids: (project.manifest.timelines ?? []).map((t) => t.id) }
        : selectFromProject(project, options, context.configPath),
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

export function createProjectResolver(options: ResolveProjectOptions): ProjectResolver {
  return new ProjectResolver(options);
}

export async function resolveProject(options: ResolveProjectOptions): Promise<ProjectResolution> {
  return createProjectResolver(options).resolve();
}
