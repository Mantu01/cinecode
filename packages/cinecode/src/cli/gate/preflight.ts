import path from "node:path";
import type { CinecodeConfig, Composition, QualitySetting, RenderFormat, VideoCodec } from "../../core/types/index.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { runReport } from "../output/run-report.js";
import { getDefaultConfig, type ConfigFieldTrace } from "../../config/schema.js";
import {
  resolveProjectRoots,
  checkRootsWritability,
  containsPath,
  type ProjectRoots,
  type RootKey,
} from "../../config/roots.js";
import type { ManifestProject } from "../../manifest/index.js";
import type { CommandSpec } from "../registry/types.js";
import { validateCommandOptions } from "../parse/option-parser.js";
import { sweepSpools } from "../shared/spool.js";
import { Reporter } from "../output/reporter.js";
import {
  createProjectResolver,
  reportResolution,
  type ProjectResolver,
  type ProjectResolution,
} from "../resolve/project-resolver.js";

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
  readonly commandNames: ReadonlySet<string>;
  readonly resolution?: ProjectResolution;
  readonly resolver?: ProjectResolver;
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

/** Full preflight orchestrator with single project resolution. */
export async function runPreflight(
  spec: CommandSpec,
  positionalArgs: unknown[],
  rawOptions: Record<string, unknown>,
  knownCommandNames: readonly string[] = [],
): Promise<void> {
  // Stage 1: Runtime Guard
  runRuntimeGuardStage();

  // Stage 2: Parse & Validate Command Options
  const validatedOptions = validateCommandOptions(spec, rawOptions);
  const dryRun = validatedOptions.dryRun === true;

  // Stages 3-7: Single Project Resolution
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
  let resolution: ProjectResolution | undefined;
  let resolver: ProjectResolver | undefined;

  if (spec.requiredProject) {
    const fileArg = validatedOptions.file
      ? String(validatedOptions.file)
      : ((spec.usage?.includes("[file]") || spec.usage?.includes("[entry]")) && typeof positionalArgs[0] === "string")
        ? positionalArgs[0]
        : undefined;

    resolver = createProjectResolver({
      root: validatedOptions.root as string | undefined,
      config: validatedOptions.config as string | undefined,
      file: fileArg,
      composition: validatedOptions.composition as string | undefined,
      timeline: validatedOptions.timeline as string | undefined,
      scene: validatedOptions.scene as string | undefined,
      all: spec.projectSelectorRule === "selection" && validatedOptions.all === true,
      requireSelection: spec.projectSelectorRule === "selection",
      allowAll: spec.name === "render",
      width: validatedOptions.width as number | undefined,
      height: validatedOptions.height as number | undefined,
      fps: validatedOptions.fps as number | undefined,
      format: validatedOptions.format as RenderFormat | undefined,
      codec: validatedOptions.codec as VideoCodec | undefined,
      quality: validatedOptions.quality as QualitySetting | undefined,
      alpha: validatedOptions.alpha as boolean | undefined,
    });

    resolution = await resolver.resolve();
    mode = resolution.mode;
    root = resolution.root;
    configPath = resolution.configPath;
    manifestPath = resolution.manifestPath;
    config = resolution.config;
    explicit = resolution.context.explicit;
    trace = resolution.context.trace;
    roots = resolution.context.roots;
    rootsWritability = checkRootsWritability(roots);
    manifest = resolution.manifest;

    // Report resolution to runReport and reporter
    reportResolution(resolution, validatedOptions.verbose === true);

    // Expand targets deterministically from resolution
    const rawTargets = await resolution.targets();
    targets = rawTargets.map((t) => ({
      id: t.id,
      kind: t.kind === "image" || t.kind === "audio" ? "composition" : t.kind,
      name: t.composition?.name ?? t.id,
      width: t.geometry.width,
      height: t.geometry.height,
      fps: t.geometry.fps,
      duration: t.geometry.duration,
      composition: t.composition,
    }));
  }

  // Sweep spools only for project-scoped commands, after the root is known, never on a dry run.
  if (spec.requiredProject && mode !== "none" && !dryRun) {
    sweepSpools(roots.cache);
  }

  // Stage 8: Resource Plan
  runReport.setProject({ root, config: configPath, manifest: manifestPath });

  // Stage 9: Consent Gate
  if ((spec.destructive || spec.kind === "destructive") && !dryRun && spec.name !== "clean") {
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

  // If dry-run: report resolved plan
  if (dryRun) {
    runReport.result({
      dryRun: true,
      command: spec.name,
      targets: targets.map(({ composition: _c, ...rest }) => rest),
      roots: { ...roots },
    });
    const reporter = runReport.getReporter();
    if (!reporter.isMachine() && !reporter.isQuiet()) {
      runReport.diagnostic(`[DRY-RUN] Command '${spec.name}' plan verified (${targets.length} target(s)). No actions executed.`);
    }
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
    commandNames: new Set(knownCommandNames),
    writeBoundary: Object.freeze({
      outputRoot: roots.output,
      cacheRoot: roots.cache,
      escapes: Object.freeze(escapes),
    }),
    checkWriteBoundary: (targetPath: string) => {
      assertWriteBoundary(targetPath, roots.output, roots.cache, escapes, roots.source);
    },
    resolution,
    resolver,
  });

  // Stage 10: Execute Command Action
  const action = await spec.loadAction();
  await action(...positionalArgs, validatedOptions, context);

  // Stage 11: Report finalized in runCli
}
