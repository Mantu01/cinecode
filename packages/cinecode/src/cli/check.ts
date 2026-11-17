import { Command } from "commander";
import { recordDegradation } from "../errors/degradations.js";
import { runReport } from "./run-report.js";
import { resolve } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { CinecodeConfig, Composition } from "../core/types/index.js";
import { loadConfig } from "../config/schema.js";
import { resolveProjectLocation } from "../config/project.js";
import { validateConfig as validateConfigShape } from "../config/validator.js";
import { createConversion, type FrameConversion } from "../core/time/index.js";
import { validateTimeline, scanSourceForNonDeterminism } from "../core/validation/index.js";
import { validateKeyframes } from "../core/keyframes/index.js";
import { allClips } from "../core/types/tracks.js";
import { checkMissingGlyphs } from "../renderer/text/engine.js";
import { createMediaResolver } from "../media/resolver.js";
import { mediaIgnore, printProjectContext } from "./shared.js";
import { createMediaCache } from "../media/cache.js";
import { createError, ErrorCode, isCinecodeError, type CinecodeError } from "../errors/index.js";
import { loadComposition } from "./still.js";
import { assembleTimelineComposition, loadManifestProject } from "../manifest/index.js";

/** Load renderable compositions the same way `render` does: manifest-aware,
 * with a fallback to direct composition modules. */
async function loadCheckCompositions(config: CinecodeConfig): Promise<Composition[]> {
  try {
    const project = await loadManifestProject(config, process.cwd());
    const timelineEntries = project.manifest.timelines;
    if (project.hasManifest && (timelineEntries?.length ?? 0) > 0) {
      const compositions: Composition[] = [];
      for (const entry of timelineEntries ?? []) {
        compositions.push(await assembleTimelineComposition(project, entry.id));
      }
      return compositions;
    }
  } catch (error) {
    recordDegradation({
      code: ErrorCode.CC1010,
      what: "manifest composition assembly skipped",
      reason: error instanceof Error ? error.message : String(error),
      input: config.project?.entry,
      instead: "direct composition loading from the configured entry",
    });
  }
  const entry = config.project?.entry ?? "cinecode.config.js";
  return await loadComposition(entry);
}

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
export async function runCheck(configPath: string): Promise<CheckReport> {
  const errors: CheckIssue[] = [];
  const warnings: CheckIssue[] = [];

  // --- config ---
  let config: CinecodeConfig | null = null;
  try {
    config = await loadConfig(configPath);
    const shape = validateConfigShape(config, configPath);
    for (const e of shape.errors) errors.push(toIssue(e, "config"));
    for (const w of shape.warnings) warnings.push(toIssue(w, "config"));
  } catch (error) {
    if (isCinecodeError(error)) throw error;
    throw createError(
      ErrorCode.CC1005,
      { path: configPath, reason: error instanceof Error ? error.message : String(error) },
      { location: { file: configPath }, cause: error },
    );
  }

  // --- authoring (compositions, timelines, keyframes, props, glyphs) ---
  let compositions: Composition[] = [];
  if (config) {
    try {
      compositions = await loadCheckCompositions(config);
    } catch (error) {
      errors.push({
        code: ErrorCode.CC3001,
        severity: "error",
        message: `Composition could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
        category: "authoring",
        file: configPath,
        fixHint: "Ensure the entry exports a composition or array of compositions",
      });
    }
  }

  for (const composition of compositions) {
    if (typeof composition?.fps !== "number" || composition.fps <= 0) continue;
    const conversion: FrameConversion = createConversion(composition.fps);
    const issues = validateTimeline(composition.rootTimeline, {
      conversion,
      compositionWidth: composition.width,
      compositionHeight: composition.height,
    });
    for (const issue of issues) errors.push(issueFromValidation(issue, "authoring"));

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
  if (config) {
    try {
      const project = await loadManifestProject(config, process.cwd());
      if (project.hasManifest) scanTargets.add(project.entryPath);
      // Scan every referenced asset module so a non-deterministic image,
      // audio, scene, or timeline file is caught here, not at render time.
      const entries = [
        ...(project.manifest.images ?? []),
        ...(project.manifest.audio ?? []),
        ...(project.manifest.scenes ?? []),
        ...(project.manifest.timelines ?? []),
      ];
      for (const entry of entries) {
        if (entry.file) scanTargets.add(resolve(process.cwd(), entry.file));
      }
    } catch (error) {
      recordDegradation({
        code: ErrorCode.CC1010,
        what: "manifest determinism scan skipped",
        reason: error instanceof Error ? error.message : String(error),
        input: configPath,
        instead: "only the config file is scanned for non-deterministic APIs",
      });
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

  // --- media (references resolve) ---
  if (config) {
    try {
      const cache = createMediaCache(config.cacheDir ?? ".cinecode/cache");
      await cache.initialize();
      const resolver = createMediaResolver({ sourceDir: resolve(configPath, "..", config.sourceDir), cache, cloudMedia: config.cloudMedia ?? [], ignore: mediaIgnore(config) });
      await resolver.initialize();
      for (const m of await resolver.listMedia()) {
        try {
          await resolver.resolve(m.name);
        } catch (error) {
          errors.push(toIssue(createError(ErrorCode.CC2003, { path: m.path, reason: error instanceof Error ? error.message : "unknown" }, { location: { file: m.path } }), "media"));
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

    // --- fonts (loadable) ---
    for (const font of config.fonts ?? []) {
      try {
        await stat(font.src);
      } catch {
        warnings.push({
          code: ErrorCode.CC3006,
          severity: "warning",
          message: `Font file not found: ${font.src} (family "${font.family}")`,
          category: "fonts",
          file: font.src,
          fixHint: "Verify the font path in your config",
        });
      }
    }
  }

  const categories = emptyCategories();
  for (const issue of errors) categories[issue.category].errors += 1;
  for (const issue of warnings) categories[issue.category].warnings += 1;

  return { ok: errors.length === 0, errors, warnings, categories };
}

export async function checkCommand(options: CheckOptions): Promise<void> {
  const location = resolveProjectLocation({ root: options.root, config: options.config });
  printProjectContext(location, (options as { verbose?: boolean }).verbose === true);
  runReport.setProject({ root: location.root, config: location.configPath, source: location.source });
  const report = await runCheck(location.configPath);
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
    if (report.ok && report.warnings.length === 0) console.log("check passed");
    else if (report.ok) console.log(`\ncheck passed with ${report.warnings.length} warning(s)`);
    else console.log(`\ncheck failed: ${report.errors.length} error(s), ${report.warnings.length} warning(s)`);
  }

  const failed = !report.ok || (options.strict && report.warnings.length > 0);
  if (failed) {
    const count = report.errors.length + (options.strict ? report.warnings.length : 0);
    throw createError(ErrorCode.CC1013, { count }, { location: { file: location.configPath } });
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
