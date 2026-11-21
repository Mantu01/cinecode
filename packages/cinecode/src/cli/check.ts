import { Command } from "commander";
import { recordDegradation } from "../errors/degradations.js";
import { runReport } from "./run-report.js";
import { resolve } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { Composition } from "../core/types/index.js";
import { validateConfig as validateConfigShape } from "../config/validator.js";
import { createConversion, type FrameConversion } from "../core/time/index.js";
import { scanSourceForNonDeterminism, type CompositionValidation } from "../core/validation/index.js";
import { validateKeyframes } from "../core/keyframes/index.js";
import { allClips } from "../core/types/tracks.js";
import { checkMissingGlyphs } from "../renderer/text/engine.js";
import { createError, ErrorCode, isCinecodeError, type CinecodeError } from "../errors/index.js";
import { pendingNotes } from "../errors/degradations.js";
import { referenceWarnings } from "../manifest/references.js";
import { createProjectResolver, reportResolution, type ProjectResolution } from "./project-resolver.js";

/**
 * `cinecode check` — the canonical code-first pre-render gate.
 *
 * Validates the authoring side only: config schema, manifest/composition
 * loading, timeline spans, keyframes, determinism, media references, fonts,
 * and glyphs. It never renders a frame and never spawns an encoder/muxer, so
 * it is fast relative to a render and safe to run in CI before `render`.
 *
 * Output is grouped by category (config, authoring, media, fonts,
 * determinism), with `--json` for machine-readable results and `--strict` to
 * escalate warnings to errors. It shares validation primitives with HMR so an
 * edit that fails `check` also fails the dev server.
 */

export type CheckCategory = "config" | "authoring" | "media" | "fonts" | "determinism";

export interface CheckIssue {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly category: CheckCategory;
  readonly fixHint?: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
}

export interface CheckReport {
  readonly ok: boolean;
  readonly errors: readonly CheckIssue[];
  readonly warnings: readonly CheckIssue[];
  readonly notes: readonly string[];
  readonly categories: Readonly<Record<CheckCategory, { errors: number; warnings: number }>>;
}

export interface CheckOptions {
  readonly config?: string;
  readonly root?: string;
  readonly strict?: boolean;
  readonly json?: boolean;
}

const CATEGORIES: readonly CheckCategory[] = ["config", "authoring", "media", "fonts", "determinism"];

function emptyCategories(): Record<CheckCategory, { errors: number; warnings: number }> {
  const out = {} as Record<CheckCategory, { errors: number; warnings: number }>;
  for (const category of CATEGORIES) out[category] = { errors: 0, warnings: 0 };
  return out;
}

function toIssue(error: CinecodeError, category: CheckCategory): CheckIssue {
  return {
    code: error.code,
    severity: error.severity,
    message: error.message,
    category,
    fixHint: error.fixHint,
    file: error.location?.file,
    line: error.location?.line,
    column: error.location?.column,
  };
}

function issueFromValidation(issue: { code: string; message: string; severity: "error" | "warning"; hint?: string; position?: { file: string; line: number; column: number } }, category: CheckCategory): CheckIssue {
  return {
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    category,
    fixHint: issue.hint,
    file: issue.position?.file,
    line: issue.position?.line,
    column: issue.position?.column,
  };
}

/**
 * Run every check category and return a structured report. This is the shared
 * entry point used by the CLI command and (later) HMR, so results stay
 * consistent between `check` and the dev server.
 */
export async function runCheck(project: ProjectResolution): Promise<CheckReport> {
  const errors: CheckIssue[] = [];
  const warnings: CheckIssue[] = [];
  const configPath = project.configPath;
  const config = project.config;

  // --- config ---
  const shape = validateConfigShape(config, configPath, project.root);
  for (const error of shape.errors) errors.push(toIssue(error, "config"));
  for (const warning of shape.warnings) warnings.push(toIssue(warning, "config"));

  // --- authoring (compositions, timelines, keyframes, props, glyphs) ---
  const seen = new Set<string>();
  const pushCategorized = (issue: CheckIssue): void => {
    const key = `${issue.code}:${issue.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    (issue.severity === "error" ? errors : warnings).push(issue);
  };
  const pushAssemblyError = (error: unknown): void => {
    const coded = isCinecodeError(error)
      ? error
      : createError(ErrorCode.CC1010, { path: configPath, reason: error instanceof Error ? error.message : String(error) });
    pushCategorized(toIssue(coded, "authoring"));
  };

  let compositions: readonly Composition[] = [];
  try {
    compositions = await project.all();
  } catch (error) {
    pushAssemblyError(error);
  }

  let timelineResults: readonly CompositionValidation[] = [];
  try {
    timelineResults = await project.validateCompositions();
  } catch (error) {
    pushAssemblyError(error);
  }
  for (const composition of compositions) {
    if (typeof composition?.fps !== "number" || composition.fps <= 0) continue;
    const conversion: FrameConversion = createConversion(composition.fps);
    const result = timelineResults.find((entry) => entry.composition === composition.name);
    for (const issue of [...(result?.errors ?? []), ...(result?.warnings ?? [])]) {
      pushCategorized(issueFromValidation(issue, "authoring"));
    }

    for (const clip of allClips(composition.rootTimeline)) {
      const kfProps = (clip as { keyframes?: readonly (readonly [string, readonly (readonly [number, unknown])[]])[] }).keyframes;
      if (Array.isArray(kfProps)) {
        for (const [property, tuples] of kfProps) {
          const engineKeyframes = tuples.map((tuple: readonly [number, unknown]) => ({ atFrames: tuple[0], value: tuple[1] }));
          try {
            validateKeyframes(property, engineKeyframes, { file: configPath, line: 0, column: 0 });
          } catch (error) {
            const message = error instanceof Error
              ? error.message
              : typeof error === "object" && error !== null && "message" in error
                ? String((error as { message: unknown }).message)
                : String(error);
            errors.push({
              code: ErrorCode.CC3004,
              severity: "error",
              message,
              category: "authoring",
              file: configPath,
              fixHint: "Sort keyframes by time and remove duplicate times",
            });
          }
        }
      }
      if (clip.type === "text") {
        const missing = checkMissingGlyphs(clip.content, {
          fontFamily: clip.fontFamily ?? "sans-serif",
          fontWeight: clip.fontWeight ?? "normal",
          fontStyle: clip.fontStyle ?? "normal",
          fontSize: clip.fontSize,
          lineHeight: clip.lineHeight ?? 1.2,
          letterSpacing: clip.letterSpacing ?? 0,
          align: clip.align ?? "left",
        });
        if (missing.length > 0) {
          warnings.push({
            code: ErrorCode.CC3006,
            severity: "warning",
            message: `Text clip may be missing glyphs: ${missing.join(", ")}`,
            category: "fonts",
            file: configPath,
            fixHint: "Register a font covering these glyphs",
          });
        }
      }
    }
  }

  // --- determinism (scan authored source: config + manifest entry + asset modules) ---
  const scanTargets = new Set<string>([configPath]);
  const manifest = project.manifest;
  if (manifest) {
    scanTargets.add(manifest.entryPath);
    const entries = [
      ...(manifest.manifest.images ?? []),
      ...(manifest.manifest.audio ?? []),
      ...(manifest.manifest.scenes ?? []),
      ...(manifest.manifest.timelines ?? []),
    ];
    for (const entry of entries) {
      if (entry.file) scanTargets.add(resolve(manifest.rootDir, entry.file));
    }
  }
  for (const target of scanTargets) {
    try {
      const source = await readFile(target, "utf-8");
      for (const issue of scanSourceForNonDeterminism(source, target)) {
        (issue.severity === "error" ? errors : warnings).push(issueFromValidation(issue, "determinism"));
      }
    } catch (error) {
      recordDegradation({
        code: ErrorCode.CC1005,
        what: "authored source scan skipped",
        reason: error instanceof Error ? error.message : String(error),
        input: target,
        instead: "non-determinism checks do not cover this file",
      });
    }
  }

  // --- references (dead assets and file-overridden sceneRefs) ---
  if (project.manifest) {
    for (const warning of referenceWarnings(project.manifest.manifest)) {
      warnings.push(toIssue(warning, "authoring"));
    }
  }

  // --- media (references resolve) ---
  try {
    const media = await project.media();
    for (const item of await media.catalog.listMedia()) {
      try {
        await media.catalog.resolve(item.name);
      } catch (error) {
        errors.push(toIssue(createError(ErrorCode.CC2003, { path: item.path, reason: error instanceof Error ? error.message : "unknown" }, { location: { file: item.path } }), "media"));
      }
    }
  } catch (error) {
    warnings.push({
      code: ErrorCode.CC2003,
      severity: "warning",
      message: `Media resolution skipped: ${error instanceof Error ? error.message : String(error)}`,
      category: "media",
    });
  }

  // --- fonts (registered in the real backend) ---
  const { registerProjectFonts } = await import("../renderer/text/fonts.js");
  const fontResult = registerProjectFonts(config.fonts, {
    projectRoot: project.root,
    mediaDir: config.mediaDir ?? "media",
  });
  for (const font of fontResult.errors) {
    errors.push({
      code: ErrorCode.CC3006,
      severity: "error",
      message: font.message,
      category: "fonts",
      file: font.path,
      fixHint: "Fix the font entry path or use a supported .ttf/.otf/.ttc file inside the media root",
    });
  }
  for (const font of fontResult.warnings) {
    warnings.push({
      code: ErrorCode.CC3006,
      severity: "warning",
      message: font.message,
      category: "fonts",
      file: font.path,
      fixHint: "Remove the duplicate family entry; the first configured face wins",
    });
  }

  const categories = emptyCategories();
  for (const issue of errors) categories[issue.category].errors += 1;
  for (const issue of warnings) categories[issue.category].warnings += 1;

  return { ok: errors.length === 0, errors, warnings, notes: pendingNotes(), categories };
}

export async function checkCommand(options: CheckOptions): Promise<void> {
  const resolver = createProjectResolver({ root: options.root, config: options.config });
  const project = await resolver.resolve();
  reportResolution(project, (options as { verbose?: boolean }).verbose === true);
  const report = await runCheck(project);
  runReport.result({ ...report });
  for (const issue of report.warnings) runReport.warn(issue.code, issue.message, issue.file);

  if (!runReport.isMachine()) {
    const groups: Array<[CheckCategory, CheckIssue[]]> = [
      ["config", [...report.errors, ...report.warnings].filter((i) => i.category === "config")],
      ["authoring", [...report.errors, ...report.warnings].filter((i) => i.category === "authoring")],
      ["media", [...report.errors, ...report.warnings].filter((i) => i.category === "media")],
      ["fonts", [...report.errors, ...report.warnings].filter((i) => i.category === "fonts")],
      ["determinism", [...report.errors, ...report.warnings].filter((i) => i.category === "determinism")],
    ];
    for (const [category, issues] of groups) {
      if (issues.length === 0) continue;
      console.log(`\n${category}`);
      for (const issue of issues) {
        const line = [
          issue.severity === "error" ? "  error" : "  warn ",
          `[${issue.code}]`,
          issue.message,
          issue.file ? `(${issue.file}${issue.line ? `:${issue.line}` : ""})` : "",
          issue.fixHint ? `\n    fix: ${issue.fixHint}` : "",
        ].filter(Boolean).join(" ");
        console.log(line);
      }
    }
    for (const note of report.notes) console.log(`  note  ${note}`);
    if (report.ok && report.warnings.length === 0) console.log("check passed");
    else if (report.ok) console.log(`\ncheck passed with ${report.warnings.length} warning(s)`);
    else console.log(`\ncheck failed: ${report.errors.length} error(s), ${report.warnings.length} warning(s)`);
  }

  const failed = !report.ok || (options.strict && report.warnings.length > 0);
  if (failed) {
    const count = report.errors.length + (options.strict ? report.warnings.length : 0);
    throw createError(ErrorCode.CC1013, { count }, { location: { file: project.configPath } });
  }
}

export function createCheckCommand(): Command {
  const cmd = new Command("check")
    .description("Validate authoring code before rendering (no frames, no encode) — the CI pre-render gate")
    .option("--strict", "Treat warnings as errors", false)
    .action(async (options: CheckOptions, command: Command) => {
      await checkCommand({ ...command.optsWithGlobals(), ...options });
    });
  return cmd;
}
