import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CinecodeConfig, Composition } from "../core/types/index.js";
import { getDefaultConfig, loadConfig } from "../config/schema.js";
import { resolveProjectLocation, type ConfigSource } from "../config/project.js";
import { createMediaCache } from "../media/cache.js";
import { createMediaResolver } from "../media/resolver.js";
import type { MediaCatalog } from "../media/resolver.js";
import { createError, ErrorCode, isCinecodeError } from "../errors/index.js";
import { recordDegradation } from "../errors/degradations.js";
import {
  assembleTimelineComposition,
  composeSceneComposition,
  findEntry,
  loadManifestProject,
  resolveEntryFile,
  type ManifestProject,
} from "../manifest/index.js";
import { mediaIgnore } from "./shared.js";
import { loadComposition, selectComposition } from "./composition-loader.js";
import { runReport } from "./run-report.js";

export type ProjectMode = "project" | "file";
export type SelectionKind = "timeline" | "scene" | "composition" | "all" | "none";

export interface ProjectSelection {
  readonly kind: SelectionKind;
  readonly id?: string;
  readonly ids: readonly string[];
}

export interface MediaAccess {
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
  readonly manifestPath: string;
  readonly manifest: ManifestProject | null;
  readonly selection: ProjectSelection;
  /** Compositions loaded from an explicit file; empty in project mode. */
  readonly compositions: readonly Composition[];
  /** Media index handle; the scan runs once per invocation. */
  readonly media: () => Promise<MediaAccess>;
  /** Compositions for the resolved selection (timeline, scene or file). */
  readonly selected: () => Promise<readonly Composition[]>;
  /** Every timeline and scene in the manifest, for project-wide validation. */
  readonly all: () => Promise<readonly Composition[]>;
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
}

function invalid(reason: string, path?: string): never {
  throw createError(
    ErrorCode.CC1012,
    { reason },
    path ? { location: { file: path } } : {},
  );
}

function manifestFailure(error: unknown, path: string): never {
  if (isCinecodeError(error) && error.code === ErrorCode.CC1010) throw error;
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
  const given = [
    options.timeline !== undefined ? "--timeline" : "",
    options.scene !== undefined ? "--scene" : "",
    options.all === true ? "--all" : "",
  ].filter(Boolean);
  if (given.length > 1) invalid(`Conflicting selectors: ${given.join(" and ")} cannot be combined`);
}

function selectFromProject(
  project: ManifestProject,
  options: ResolveProjectOptions,
): ProjectSelection {
  const timelines = project.manifest.timelines ?? [];
  const scenes = project.manifest.scenes ?? [];
  if (options.all) {
    if (!options.allowAll) {
      invalid("--all rerenders every timeline and is not valid for this command; pass one selector");
    }
    if (timelines.length === 0) {
      invalid(`--all has nothing to render. Register a timeline in ${project.entryPath}`, project.entryPath);
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

async function loadProjectConfig(options: ResolveProjectOptions): Promise<{
  root: string;
  configPath: string;
  source: ConfigSource | "standalone";
  config: CinecodeConfig;
}> {
  const explicit = options.root ?? options.config;
  if (!explicit) {
    return {
      root: resolve(options.cwd ?? process.cwd()),
      configPath: "",
      source: "standalone",
      config: getDefaultConfig(),
    };
  }
  const location = resolveProjectLocation({
    root: options.root,
    config: options.config,
    cwd: options.cwd,
  });
  const config = await loadConfig(location.configPath, { fresh: options.fresh });
  return { ...location, config };
}

/** One resolution per invocation; repeated reads reuse the same promises. */
export class ProjectResolver {
  private pending: Promise<ProjectResolution> | undefined;
  private mediaPending: Promise<MediaAccess> | undefined;
  private selectedPending: Promise<readonly Composition[]> | undefined;
  private allPending: Promise<readonly Composition[]> | undefined;
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

  all(): Promise<readonly Composition[]> {
    this.allPending ??= this.buildAll();
    return this.allPending;
  }

  private async buildMedia(): Promise<MediaAccess> {
    const project = await this.resolve();
    const cache = createMediaCache(resolve(project.root, project.config.cacheDir));
    await cache.initialize();
    const catalog = createMediaResolver({
      sourceDir: resolve(project.root, project.config.sourceDir),
      cache,
      cloudMedia: project.config.cloudMedia,
      ignore: mediaIgnore(project.config),
    });
    await catalog.initialize();
    return { catalog, cache, root: project.root };
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
      const base = await loadProjectConfig(options);
      const filePath = resolve(options.cwd ?? process.cwd(), options.file);
      if (!existsSync(filePath)) {
        throw createError(ErrorCode.CC1009, { path: filePath }, { location: { file: filePath } });
      }
      const compositions = await loadComposition(filePath);
      const resolution: ProjectResolution = {
        mode: "file",
        root: base.root,
        configPath: base.configPath,
        config: base.config,
        source: base.source,
        manifestPath: filePath,
        manifest: null,
        selection: selectFromFile(compositions, options),
        compositions,
        media: () => this.media(),
        selected: () => this.selected(),
        all: () => this.all(),
      };
      this.resolved = resolution;
      return resolution;
    }

    if (options.composition !== undefined) {
      invalid("--composition selects a composition inside --file; it cannot be used without --file");
    }

    const location = resolveProjectLocation({
      root: options.root,
      config: options.config,
      cwd: options.cwd,
    });
    const config = await loadConfig(location.configPath, { fresh: options.fresh });

    let project: ManifestProject;
    try {
      project = await loadManifestProject(config, location.root);
    } catch (error) {
      manifestFailure(error, resolveEntryFile(config.project?.entry ?? "./main.ts", location.root));
    }

    if (!project.hasManifest) {
      throw createError(ErrorCode.CC1009, { path: project.entryPath }, {
        location: { file: project.entryPath },
        fixHint: `Create ${project.entryPath} exporting defineMain({ timelines, scenes }), or render a standalone file with --file <path>`,
      });
    }

    const manifest = project.manifest;
    const populated = [manifest.timelines, manifest.scenes, manifest.images, manifest.audio].some(
      (entries) => (entries?.length ?? 0) > 0,
    );
    if (!populated) {
      throw createError(ErrorCode.CC1010, {
        path: project.entryPath,
        reason: "manifest registers no timelines, scenes, images or audio; export defineMain(...) or use --file",
      }, { location: { file: project.entryPath } });
    }

    const resolution: ProjectResolution = {
      mode: "project",
      root: location.root,
      configPath: location.configPath,
      config,
      source: location.source,
      manifestPath: project.entryPath,
      manifest: project,
      selection: selectFromProject(project, options),
      compositions: [],
      media: () => this.media(),
      selected: () => this.selected(),
      all: () => this.all(),
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
