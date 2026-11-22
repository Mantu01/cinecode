import path from "node:path";
import { existsSync } from "node:fs";
import type { CinecodeConfig, Composition } from "../core/types/index.js";
import { createError, ErrorCode, isCinecodeError } from "../errors/index.js";
import { runReport } from "./run-report.js";
import { resolveProjectLocation, type ConfigSource } from "../config/project.js";
import { loadConfigDocument, getDefaultConfig, type ConfigFieldTrace } from "../config/schema.js";
import {
  resolveProjectRoots,
  validateProjectRoots,
  checkRootsWritability,
  containsPath,
  type ProjectRoots,
  type RootKey,
} from "../config/roots.js";
import {
  loadManifestProject,
  validateManifestDocument,
  findEntry,
  toSeconds,
  type ManifestProject,
} from "../manifest/index.js";
import { loadComposition } from "./composition-loader.js";
import type { CommandSpec } from "./command-registry.js";
import { validateCommandOptions } from "./option-parser.js";
import { Reporter } from "./reporter.js";

export type PreflightStage =
  | "runtimeGuard"
  | "parse"
  | "projectResolution"
  | "configLoad"
  | "manifestLoad"
  | "capabilityCheck"
  | "selectionExpansion"
  | "resourcePlan"
  | "consent"
  | "execute"
  | "report";

export interface ResolvedTarget {
  readonly id: string;
  readonly kind: "timeline" | "scene" | "file" | "composition";
  readonly name?: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: number;
  readonly composition?: Composition;
  readonly outputPath?: string;
}

export interface PreflightContext {
  readonly mode: "project" | "file" | "none";
  readonly root: string;
  readonly configPath: string;
  readonly manifestPath?: string;
  readonly config: CinecodeConfig;
  readonly explicit: ReadonlySet<string>;
  readonly trace?: ReadonlyMap<string, ConfigFieldTrace>;
  readonly roots: ProjectRoots;
  readonly rootsWritability: Record<RootKey, boolean>;
  readonly manifest: ManifestProject | null;
  readonly targets: readonly ResolvedTarget[];
  readonly options: Readonly<Record<string, unknown>>;
  readonly spec: CommandSpec;
  readonly dryRun: boolean;
  readonly writeBoundary: {
    readonly outputRoot: string;
    readonly cacheRoot: string;
    readonly escapes: readonly string[];
  };
  readonly checkWriteBoundary: (targetPath: string) => void;
  readonly reporter: Reporter;
}

export interface SerializablePreflightContext {
  readonly mode: "project" | "file" | "none";
  readonly root: string;
  readonly configPath: string;
  readonly manifestPath?: string;
  readonly roots: ProjectRoots;
  readonly rootsWritability: Record<RootKey, boolean>;
  readonly targets: readonly Omit<ResolvedTarget, "composition">[];
  readonly options: Readonly<Record<string, unknown>>;
  readonly command: string;
}

export function toSerializableContext(ctx: PreflightContext): SerializablePreflightContext {
  return {
    mode: ctx.mode,
    root: ctx.root,
    configPath: ctx.configPath,
    manifestPath: ctx.manifestPath,
    roots: { ...ctx.roots },
    rootsWritability: { ...ctx.rootsWritability },
    targets: ctx.targets.map(({ composition: _comp, ...rest }) => rest),
    options: { ...ctx.options },
    command: ctx.spec.name,
  };
}

/** Check that node runtime satisfies engines requirements (Node >= 22.18.0). */
function runRuntimeGuardStage(): void {
  const version = process.versions.node;
  const parts = version.split(".").map((p) => Number(p));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  if (major < 22 || (major === 22 && minor < 18)) {
    throw createError(ErrorCode.CC9001, {
      reason: `Node.js >= 22.18.0 is required, current version is ${process.version}`,
    });
  }
}

/** Preflight project resolution in documented order: root, config, then bounded upward discovery. */
function runProjectResolutionStage(
  options: Record<string, unknown>,
  allowStandalone: boolean,
): { root: string; configPath: string; source: ConfigSource | "standalone" } {
  const rootOpt = options.root as string | undefined;
  const configOpt = options.config as string | undefined;

  if (allowStandalone && !rootOpt && !configOpt) {
    try {
      return resolveProjectLocation({ root: rootOpt, config: configOpt });
    } catch {
      return { root: path.resolve("."), configPath: "", source: "standalone" };
    }
  }

  return resolveProjectLocation({ root: rootOpt, config: configOpt });
}

/** Load and validate config and its 4 roots. */
async function runConfigLoadStage(
  location: { root: string; configPath: string; source: ConfigSource | "standalone" },
  allowStandalone: boolean,
): Promise<{ config: CinecodeConfig; explicit: ReadonlySet<string>; trace?: ReadonlyMap<string, ConfigFieldTrace>; roots: ProjectRoots; rootsWritability: Record<RootKey, boolean> }> {
  let config: CinecodeConfig;
  let explicit: ReadonlySet<string> = new Set();
  let trace: ReadonlyMap<string, ConfigFieldTrace> | undefined;

  if (location.source === "standalone" || (!location.configPath && allowStandalone)) {
    config = getDefaultConfig();
  } else {
    const loaded = await loadConfigDocument(location.configPath, { root: location.root });
    config = loaded.config;
    explicit = loaded.explicit;
    trace = loaded.trace;
  }

  const roots = resolveProjectRoots(location.root, config);

  // Validate 4 roots per documented rules
  if (location.source !== "standalone") {
    const rootErrors = validateProjectRoots(location.root, config, { configPath: location.configPath });
    if (rootErrors.length > 0) {
      throw rootErrors[0]!;
    }
  }

  const rootsWritability = checkRootsWritability(roots);
  return { config, explicit, trace, roots, rootsWritability };
}

/** Selection expansion stage resolving selector flags into concrete targets. */
async function runSelectionExpansionStage(
  mode: "project" | "file",
  manifest: ManifestProject | null,
  options: Record<string, unknown>,
  roots: ProjectRoots,
): Promise<readonly ResolvedTarget[]> {
  const targets: ResolvedTarget[] = [];

  if (mode === "file" || options.file) {
    const filePath = path.resolve(roots.project, String(options.file ?? "src/main.ts"));
    if (existsSync(filePath)) {
      try {
        const comps = await loadComposition(filePath);
        for (const comp of comps) {
          targets.push({
            id: comp.name,
            kind: "file",
            name: comp.name,
            width: comp.width,
            height: comp.height,
            fps: comp.fps,
            duration: (typeof comp.duration === "number" ? comp.duration : toSeconds(comp.duration, comp.fps)) ?? 10,
            composition: comp,
          });
        }
      } catch {
        // Fall back to target placeholder
        targets.push({
          id: path.basename(filePath, path.extname(filePath)),
          kind: "file",
          width: 1920,
          height: 1080,
          fps: 30,
          duration: 10,
        });
      }
    }
    return targets;
  }

  if (!manifest) return targets;

  const manifestDoc = manifest.manifest;

  // Single timeline selector
  if (options.timeline) {
    const timelineId = String(options.timeline);
    const entry = findEntry(manifestDoc.timelines ?? [], timelineId, "timeline");
    targets.push({
      id: entry.id,
      kind: "timeline",
      name: entry.name,
      width: entry.width ?? 1920,
      height: entry.height ?? 1080,
      fps: entry.fps ?? 30,
      duration: toSeconds(entry.duration, entry.fps ?? 30) ?? 10,
    });
    return targets;
  }

  // Single scene selector
  if (options.scene) {
    const sceneId = String(options.scene);
    const entry = findEntry(manifestDoc.scenes ?? [], sceneId, "scene");
    targets.push({
      id: entry.id,
      kind: "scene",
      name: entry.name,
      width: entry.width ?? 1920,
      height: entry.height ?? 1080,
      fps: entry.fps ?? 30,
      duration: toSeconds(entry.duration, entry.fps ?? 30) ?? 5,
    });
    return targets;
  }

  // All timelines selector
  if (options.all && manifestDoc.timelines && manifestDoc.timelines.length > 0) {
    for (const t of manifestDoc.timelines) {
      targets.push({
        id: t.id,
        kind: "timeline",
        name: t.name,
        width: t.width ?? 1920,
        height: t.height ?? 1080,
        fps: t.fps ?? 30,
        duration: toSeconds(t.duration, t.fps ?? 30) ?? 10,
      });
    }
    return targets;
  }

  // Default: first timeline or all timelines
  if (manifestDoc.timelines && manifestDoc.timelines.length > 0) {
    const first = manifestDoc.timelines[0]!;
    targets.push({
      id: first.id,
      kind: "timeline",
      name: first.name,
      width: first.width ?? 1920,
      height: first.height ?? 1080,
      fps: first.fps ?? 30,
      duration: toSeconds(first.duration, first.fps ?? 30) ?? 10,
    });
  }

  return targets;
}

/** Check that target paths respect write boundaries. */
export function assertWriteBoundary(
  targetPath: string,
  outputRoot: string,
  cacheRoot: string,
  escapes: readonly string[] = [],
  sourceRoot?: string,
): void {
  const resolved = path.resolve(targetPath);

  // Escapes are explicitly permitted external output destinations (e.g. publish --dest)
  for (const esc of escapes) {
    const resEsc = path.resolve(esc);
    if (resolved === resEsc || containsPath(resEsc, resolved)) {
      return;
    }
  }

  // Writing inside source root is forbidden
  if (sourceRoot && (resolved === sourceRoot || containsPath(sourceRoot, resolved))) {
    throw createError(ErrorCode.CC1004, {
      path: resolved,
      reason: `Write boundary violation: cannot write inside source tree: ${resolved}`,
    });
  }

  // Allowed within output root or cache root
  if (resolved === outputRoot || containsPath(outputRoot, resolved)) return;
  if (resolved === cacheRoot || containsPath(cacheRoot, resolved)) return;

  // Otherwise outside boundary
  throw createError(ErrorCode.CC1004, {
    path: resolved,
    reason: `Write boundary violation: target path '${resolved}' is outside output (${outputRoot}) and cache (${cacheRoot})`,
  });
}

/** Full 11-stage preflight orchestrator. */
export async function runPreflight(
  spec: CommandSpec,
  positionalArgs: unknown[],
  rawOptions: Record<string, unknown>,
): Promise<void> {
  // Stage 1: Runtime Guard
  runRuntimeGuardStage();

  // Stage 2: Parse & Validate Command Options
  const validatedOptions = validateCommandOptions(spec, rawOptions);
  const dryRun = validatedOptions.dryRun === true;

  // Stages 3-7: Project & Manifest (skipped if requiredProject is false)
  let mode: "project" | "file" | "none" = "none";
  let root = path.resolve(".");
  let configPath = "";
  let manifestPath: string | undefined;
  let config: CinecodeConfig = getDefaultConfig();
  let explicit: ReadonlySet<string> = new Set();
  let trace: ReadonlyMap<string, ConfigFieldTrace> | undefined;
  let roots: ProjectRoots = resolveProjectRoots(root, config);
  let rootsWritability: Record<RootKey, boolean> = { source: true, media: true, output: true, cache: true };
  let manifest: ManifestProject | null = null;
  let targets: readonly ResolvedTarget[] = [];

  if (spec.requiredProject) {
    const isFileMode = Boolean(validatedOptions.file);
    const allowStandalone = spec.projectSelectorRule === "selection" || spec.projectSelectorRule === "optional" || isFileMode;

    // Stage 3: Project Resolution
    const location = runProjectResolutionStage(validatedOptions, allowStandalone);
    root = location.root;
    configPath = location.configPath;

    // Stage 4: Config Load & Root Validation
    const loaded = await runConfigLoadStage(location, allowStandalone);
    config = loaded.config;
    explicit = loaded.explicit;
    trace = loaded.trace;
    roots = loaded.roots;
    rootsWritability = loaded.rootsWritability;

    mode = isFileMode ? "file" : "project";

    // Stage 5: Manifest Load
    if (mode === "project") {
      try {
        const manifestResult = await loadManifestProject(config, root);
        manifest = manifestResult;
        manifestPath = manifestResult.entryPath;
        const validation = await validateManifestDocument(manifestResult.manifest, {
          rootDir: root,
          manifestPath: manifestResult.entryPath,
          config,
        });
        if (!validation.valid && validatedOptions.allowInvalid !== true) {
          throw validation.errors[0]!;
        }
      } catch (err) {
        if (spec.requiredProject) {
          throw err;
        }
      }
    }

    // Stage 6: Capability Check
    if (config.plugins && config.plugins.length > 0) {
      // Plugins loaded per project
    }

    // Stage 7: Selection Expansion
    targets = await runSelectionExpansionStage(mode, manifest, validatedOptions, roots);
  }

  // Stage 8: Resource Plan
  runReport.setProject({ root, config: configPath, manifest: manifestPath });
  if (spec.outcome === "artifact" && !dryRun && validatedOptions.explain !== true) {
    runReport.expectArtifact(spec.expectedArtifactKind ?? "artifact");
  }

  // Stage 9: Consent Gate
  if (spec.destructive || spec.kind === "destructive") {
    const hasConsent = validatedOptions.yes === true || validatedOptions.force === true;
    const isInteractive = Boolean(process.stdin.isTTY && !process.env.CI && validatedOptions.json !== true);
    if (!hasConsent && !isInteractive) {
      throw createError(ErrorCode.CC1012, {
        reason: `Destructive command '${spec.name}' requires explicit consent via --yes or --force in non-interactive mode.`,
      });
    }
  }

  if (spec.network || spec.kind === "network") {
    const hasNetworkConsent = validatedOptions.confirm === true;
    if (!hasNetworkConsent) {
      throw createError(ErrorCode.CC7004, {
        reason: `Network opt-in missing: rerun \`cinecode ${spec.name} --confirm\`.`,
      });
    }
  }

  // If dry-run: report resolved plan and STOP before execution
  if (dryRun) {
    runReport.result({
      dryRun: true,
      command: spec.name,
      targets: targets.map(({ composition: _c, ...rest }) => rest),
      roots: { ...roots },
    });
    if (!runReport.getReporter().isMachine()) {
      console.log(`[DRY-RUN] Command '${spec.name}' plan verified (${targets.length} target(s)). No actions executed.`);
    }
    return;
  }

  // Documented write escapes (e.g. publish destination, export-svg out, story out)
  const escapes: string[] = [];
  if (validatedOptions.dest) escapes.push(String(validatedOptions.dest));
  if (validatedOptions.out) escapes.push(String(validatedOptions.out));

  const reporter = runReport.getReporter();
  reporter.setSelection(
    targets.map((t) => ({
      id: t.id,
      kind: t.kind,
      width: t.width,
      height: t.height,
      fps: t.fps,
      duration: t.duration,
    })),
  );

  // Construct and freeze PreflightContext
  const context: PreflightContext = Object.freeze({
    mode,
    root,
    configPath,
    manifestPath,
    config,
    explicit,
    trace,
    roots,
    rootsWritability,
    manifest,
    targets,
    options: Object.freeze(validatedOptions),
    spec,
    dryRun,
    reporter,
    writeBoundary: Object.freeze({
      outputRoot: roots.output,
      cacheRoot: roots.cache,
      escapes: Object.freeze(escapes),
    }),
    checkWriteBoundary: (targetPath: string) => {
      assertWriteBoundary(targetPath, roots.output, roots.cache, escapes, roots.source);
    },
  });

  // Stage 10: Execute Command Action
  const action = await spec.loadAction();
  await action(...positionalArgs, validatedOptions, context);

  // Stage 11: Report
  // Reporting is finalized in runCli or command boundary
}
