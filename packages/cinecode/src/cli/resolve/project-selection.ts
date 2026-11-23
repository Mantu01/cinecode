import type {
  Composition,
  QualitySetting,
  RenderFormat,
  VideoCodec,
} from "../../core/types/index.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { findEntry, type ManifestProject } from "../../manifest/index.js";
import { selectComposition } from "./composition-loader.js";
import { runReport } from "../output/run-report.js";
import type { ProjectResolution } from "./project-resolver-types.js";

export type ProjectMode = "project" | "file";
export type SelectionKind = "timeline" | "scene" | "composition" | "all" | "none";

export interface ProjectSelection {
  readonly kind: SelectionKind;
  readonly id?: string;
  readonly ids: readonly string[];
}

export interface ResolveProjectOptions {
  readonly root?: string;
  readonly config?: string;
  readonly cwd?: string;
  readonly fresh?: boolean;
  readonly file?: string;
  readonly composition?: string;
  readonly timeline?: string;
  readonly scene?: string;
  readonly all?: boolean;
  readonly requireSelection?: boolean;
  readonly allowAll?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly format?: RenderFormat;
  readonly codec?: VideoCodec;
  readonly quality?: QualitySetting;
  readonly alpha?: boolean;
  readonly forValidation?: boolean;
}

export function invalid(reason: string, path?: string): never {
  throw createError(
    ErrorCode.CC0001,
    { reason },
    path ? { location: { file: path } } : {},
  );
}

export function assertSelectors(options: ResolveProjectOptions): void {
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

export function selectFromProject(
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
  if (options.requireSelection) {
    if (timelines.length === 0) {
      throw createError(ErrorCode.CC1010, {
        path: project.entryPath,
        reason: `manifest at ${project.entryPath} (read from config at ${configPath}) registers no timelines`,
      }, { location: { file: project.entryPath } });
    }
    if (timelines.length === 1) {
      return { kind: "timeline", id: timelines[0]!.id, ids: [timelines[0]!.id] };
    }
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

export function selectFromFile(
  compositions: readonly Composition[],
  options: ResolveProjectOptions,
): ProjectSelection {
  const selected = selectComposition([...compositions], options.composition);
  return { kind: "composition", id: selected.name, ids: [selected.name] };
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
  runReport.diagnostic(`Project:   ${resolution.root}`);
  runReport.diagnostic(`Config:    ${resolution.configPath || "none (standalone)"} (${resolution.source})`);
  runReport.diagnostic(`Manifest:  ${resolution.manifestPath}`);
  runReport.diagnostic(`Mode:      ${resolution.mode}`);
  runReport.diagnostic(`Selection: ${selectionLabel(resolution.selection)}`);
}
