import { accessSync, constants, existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, statfs } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { checkRuntime } from "../loader/index.js";
import { validateConfig } from "../config/validator.js";
import { resolveProjectRoots, authoredRoots } from "../config/roots.js";
import { ensureGitignoreEntries } from "../config/gitignore.js";
import { createError, ErrorCode, isCinecodeError } from "../errors/index.js";
import { pendingNotes } from "../errors/degradations.js";
import { referenceWarnings } from "../manifest/references.js";
import { allClips } from "../core/types/tracks.js";
import { validateKeyframes } from "../core/keyframes/index.js";
import { checkMissingGlyphs } from "../renderer/text/engine.js";
import { registerProjectFonts } from "../renderer/text/fonts.js";
import { resolveBinary } from "../binary/resolver.js";
import { scanSourceForNonDeterminism } from "../core/validation/timeline.js";
import type { Composition } from "../core/types/index.js";
import type { CompositionValidation } from "../core/validation/composition.js";
import type { ProjectResolution } from "./project-resolver.js";

export type ValidationGate =
  | "runtime"
  | "config"
  | "manifest"
  | "modules"
  | "media"
  | "fonts"
  | "determinism"
  | "capability"
  | "resources";

export type ValidateMode = "all" | "authoring-only" | "media" | "fonts";

export interface ValidationIssue {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly gate: ValidationGate;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly message: string;
  readonly fix?: string;
  readonly fixHint?: string;
}

export interface ProjectContractSummary {
  readonly roots: {
    readonly source: { path: string; exists: boolean; writable: boolean };
    readonly media: { path: string; exists: boolean; writable: boolean };
    readonly output: { path: string; exists: boolean; writable: boolean };
    readonly cache: { path: string; exists: boolean; writable: boolean };
  };
  readonly entry: { path: string; exists: boolean; readable: boolean };
  readonly manifest: { path: string; exists: boolean; readable: boolean };
}

export interface ValidationReport {
  readonly ok: boolean;
  readonly mode: ValidateMode;
  readonly stoppedAtGate?: ValidationGate;
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
  readonly notes: readonly string[];
  readonly contract: ProjectContractSummary;
  readonly categories: Readonly<Record<ValidationGate, { errors: number; warnings: number }>>;
}

export interface ValidationEngineOptions {
  readonly mode?: ValidateMode;
  readonly strict?: boolean;
}

export const ORDERED_GATES: readonly ValidationGate[] = [
  "runtime",
  "config",
  "manifest",
  "modules",
  "media",
  "fonts",
  "determinism",
  "capability",
  "resources",
];

const GATES_FOR_MODE: Readonly<Record<ValidateMode, readonly ValidationGate[]>> = {
  "all": ORDERED_GATES,
  "authoring-only": ["runtime", "config", "manifest", "modules", "media", "fonts", "determinism"],
  "media": ["runtime", "config", "manifest", "media"],
  "fonts": ["runtime", "config", "fonts"],
};

export const SAFE_FIX_KINDS = ["gitignore", "mkdir-output", "mkdir-cache"] as const;

export interface SafeFixResult {
  readonly applied: readonly string[];
}

export async function applySafeFixes(resolution: ProjectResolution): Promise<SafeFixResult> {
  const applied: string[] = [];
  const roots = resolveProjectRoots(resolution.root, resolution.config);
  const authored = authoredRoots(resolution.config);

  const addedGitignore = await ensureGitignoreEntries({
    sourceDir: authored.source,
    mediaDir: authored.media,
    outputDir: authored.output,
    cacheDir: authored.cache,
    projectRoot: resolution.root,
    enabled: resolution.config.gitignore ?? true,
  });
  if (addedGitignore.length > 0) {
    applied.push(`Added ${addedGitignore.join(", ")} to .gitignore`);
  }

  if (!existsSync(roots.output)) {
    mkdirSync(roots.output, { recursive: true });
    applied.push(`Created output directory: ${roots.output}`);
  }

  if (!existsSync(roots.cache)) {
    mkdirSync(roots.cache, { recursive: true });
    applied.push(`Created cache directory: ${roots.cache}`);
  }

  return { applied };
}

export function summarizeProjectContract(resolution: ProjectResolution): ProjectContractSummary {
  const roots = resolveProjectRoots(resolution.root, resolution.config);
  const checkAccess = (p: string, mode: number): boolean => {
    try {
      accessSync(p, mode);
      return true;
    } catch {
      return false;
    }
  };

  const entryPath = resolution.manifest?.entryPath ?? resolve(roots.source, "main.ts");
  const manifestPath = resolution.manifestPath;

  return {
    roots: {
      source: { path: roots.source, exists: existsSync(roots.source), writable: checkAccess(roots.source, constants.W_OK) },
      media: { path: roots.media, exists: existsSync(roots.media), writable: checkAccess(roots.media, constants.W_OK) },
      output: { path: roots.output, exists: existsSync(roots.output), writable: checkAccess(roots.output, constants.W_OK) },
      cache: { path: roots.cache, exists: existsSync(roots.cache), writable: checkAccess(roots.cache, constants.W_OK) },
    },
    entry: { path: entryPath, exists: existsSync(entryPath), readable: checkAccess(entryPath, constants.R_OK) },
    manifest: { path: manifestPath, exists: existsSync(manifestPath), readable: checkAccess(manifestPath, constants.R_OK) },
  };
}

function emptyCategories(): Record<ValidationGate, { errors: number; warnings: number }> {
  const out = {} as Record<ValidationGate, { errors: number; warnings: number }>;
  for (const gate of ORDERED_GATES) out[gate] = { errors: 0, warnings: 0 };
  return out;
}

interface GateResult {
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
}

async function runRuntimeGate(): Promise<GateResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const runtime = checkRuntime();
  if (!runtime.supported) {
    errors.push({
      code: ErrorCode.CC1010,
      severity: "error",
      gate: "runtime",
      message: `Node.js ${runtime.version} is not supported (minimum: ${runtime.minimum})`,
      fix: `Upgrade Node.js to >= ${runtime.minimum}`,
      fixHint: `Upgrade Node.js to >= ${runtime.minimum}`,
    });
  }
  return { errors, warnings };
}

async function runConfigGate(resolution: ProjectResolution): Promise<GateResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const validation = validateConfig(resolution.config, resolution.configPath, resolution.root);

  for (const err of validation.errors) {
    errors.push({
      code: err.code,
      severity: "error",
      gate: "config",
      file: err.location?.file ?? resolution.configPath,
      line: err.location?.line,
      column: err.location?.column,
      message: err.message,
      fix: err.fixHint ?? "Fix configuration schema in cinecode.config.ts",
      fixHint: err.fixHint ?? "Fix configuration schema in cinecode.config.ts",
    });
  }
  for (const warn of validation.warnings) {
    warnings.push({
      code: warn.code,
      severity: "warning",
      gate: "config",
      file: warn.location?.file ?? resolution.configPath,
      line: warn.location?.line,
      column: warn.location?.column,
      message: warn.message,
      fix: warn.fixHint ?? "Update configuration property",
      fixHint: warn.fixHint ?? "Update configuration property",
    });
  }
  return { errors, warnings };
}

async function runManifestGate(resolution: ProjectResolution): Promise<GateResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  for (const err of resolution.validation?.errors ?? []) {
    errors.push({
      code: err.code,
      severity: "error",
      gate: "manifest",
      file: err.location?.file ?? resolution.manifestPath,
      line: err.location?.line,
      column: err.location?.column,
      message: err.message,
      fix: err.fixHint ?? "Fix manifest declaration",
      fixHint: err.fixHint ?? "Fix manifest declaration",
    });
  }
  for (const warn of resolution.validation?.warnings ?? []) {
    warnings.push({
      code: warn.code,
      severity: "warning",
      gate: "manifest",
      file: warn.location?.file ?? resolution.manifestPath,
      line: warn.location?.line,
      column: warn.location?.column,
      message: warn.message,
      fix: warn.fixHint ?? "Check manifest reference",
      fixHint: warn.fixHint ?? "Check manifest reference",
    });
  }

  if (resolution.manifest) {
    for (const warn of referenceWarnings(resolution.manifest.manifest)) {
      warnings.push({
        code: warn.code,
        severity: "warning",
        gate: "manifest",
        file: warn.location?.file ?? resolution.manifestPath,
        line: warn.location?.line,
        column: warn.location?.column,
        message: warn.message,
        fix: warn.fixHint ?? "Check reference in manifest",
        fixHint: warn.fixHint ?? "Check reference in manifest",
      });
    }
  }

  return { errors, warnings };
}

async function runModulesGate(resolution: ProjectResolution): Promise<GateResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  let compositions: readonly Composition[] = [];
  try {
    compositions = await resolution.all();
  } catch (error) {
    const coded = isCinecodeError(error)
      ? error
      : createError(ErrorCode.CC1010, { path: resolution.configPath, reason: error instanceof Error ? error.message : String(error) });
    errors.push({
      code: coded.code,
      severity: "error",
      gate: "modules",
      file: coded.location?.file ?? resolution.configPath,
      line: coded.location?.line,
      column: coded.location?.column,
      message: coded.message,
      fix: coded.fixHint ?? "Ensure module exports valid defineScene or defineTimeline",
      fixHint: coded.fixHint ?? "Ensure module exports valid defineScene or defineTimeline",
    });
    return { errors, warnings };
  }

  let timelineResults: readonly CompositionValidation[] = [];
  try {
    timelineResults = await resolution.validateCompositions();
  } catch (error) {
    const coded = isCinecodeError(error)
      ? error
      : createError(ErrorCode.CC1010, { path: resolution.configPath, reason: error instanceof Error ? error.message : String(error) });
    errors.push({
      code: coded.code,
      severity: "error",
      gate: "modules",
      file: coded.location?.file ?? resolution.configPath,
      line: coded.location?.line,
      column: coded.location?.column,
      message: coded.message,
      fix: coded.fixHint,
      fixHint: coded.fixHint,
    });
    return { errors, warnings };
  }

  for (const result of timelineResults) {
    for (const issue of result.errors) {
      errors.push({
        code: issue.code,
        severity: "error",
        gate: "modules",
        file: issue.position?.file ?? resolution.configPath,
        line: issue.position?.line,
        column: issue.position?.column,
        message: issue.message,
        fix: issue.hint ?? "Correct clip timing or placement",
        fixHint: issue.hint ?? "Correct clip timing or placement",
      });
    }
    for (const issue of result.warnings) {
      warnings.push({
        code: issue.code,
        severity: "warning",
        gate: "modules",
        file: issue.position?.file ?? resolution.configPath,
        line: issue.position?.line,
        column: issue.position?.column,
        message: issue.message,
        fix: issue.hint ?? "Review clip timing or placement",
        fixHint: issue.hint ?? "Review clip timing or placement",
      });
    }
  }

  for (const composition of compositions) {
    for (const clip of allClips(composition.rootTimeline)) {
      const kfProps = (clip as { keyframes?: readonly (readonly [string, readonly (readonly [number, unknown])[]])[] }).keyframes;
      if (Array.isArray(kfProps)) {
        for (const [property, tuples] of kfProps) {
          const engineKeyframes = tuples.map((t: readonly [number, unknown]) => ({ atFrames: t[0], value: t[1] }));
          try {
            validateKeyframes(property, engineKeyframes, { file: resolution.configPath, line: 0, column: 0 });
          } catch (error) {
            errors.push({
              code: ErrorCode.CC3004,
              severity: "error",
              gate: "modules",
              file: resolution.configPath,
              message: error instanceof Error ? error.message : String(error),
              fix: "Sort keyframes by time and remove duplicate times",
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
            gate: "modules",
            message: `Text clip may be missing glyphs: ${missing.join(", ")}`,
            file: resolution.configPath,
            fix: "Register a font covering these glyphs",
            fixHint: "Register a font covering these glyphs",
          });
        }
      }
    }
  }

  return { errors, warnings };
}

async function runMediaGate(resolution: ProjectResolution): Promise<GateResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  try {
    const media = await resolution.media();
    for (const item of await media.catalog.listMedia()) {
      try {
        await media.catalog.resolve(item.name);
      } catch (error) {
        errors.push({
          code: ErrorCode.CC2003,
          severity: "error",
          gate: "media",
          file: item.path,
          message: `Media file unreadable: ${item.path}. ${error instanceof Error ? error.message : "unknown"}`,
          fix: "Ensure the file exists in the media directory and has supported format",
          fixHint: "Ensure the file exists in the media directory and has supported format",
        });
      }
    }
  } catch (error) {
    warnings.push({
      code: ErrorCode.CC2003,
      severity: "warning",
      gate: "media",
      message: `Media resolution skipped: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Configure a valid media directory in cinecode.config.ts",
      fixHint: "Configure a valid media directory in cinecode.config.ts",
    });
  }

  return { errors, warnings };
}

async function runFontsGate(resolution: ProjectResolution): Promise<GateResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const fontResult = registerProjectFonts(resolution.config.fonts, {
    projectRoot: resolution.root,
    mediaDir: resolution.config.mediaDir ?? "media",
  });

  for (const font of fontResult.errors) {
    errors.push({
      code: font.code ?? ErrorCode.CC3006,
      severity: "error",
      gate: "fonts",
      file: font.path,
      message: font.message,
      fix: "Fix font path or provide supported font (.ttf, .otf, .ttc) in media directory",
      fixHint: "Fix font path or provide supported font (.ttf, .otf, .ttc) in media directory",
    });
  }
  for (const font of fontResult.warnings) {
    warnings.push({
      code: font.code ?? ErrorCode.CC3006,
      severity: "warning",
      gate: "fonts",
      file: font.path,
      message: font.message,
      fix: "Remove duplicate font family definition",
      fixHint: "Remove duplicate font family definition",
    });
  }

  return { errors, warnings };
}

function resolveLocalImport(sourceFile: string, specifier: string, projectRoot: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(sourceFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.tsx`,
    `${base}.jsx`,
    join(base, "index.ts"),
    join(base, "index.js"),
    join(base, "index.mjs"),
  ];
  for (const cand of candidates) {
    if (existsSync(cand) && statSync(cand).isFile()) {
      const rel = relative(projectRoot, cand);
      if (!rel.startsWith("..") && !isAbsolute(rel) && !cand.includes("node_modules")) {
        return cand;
      }
    }
  }
  return undefined;
}

async function runDeterminismGate(resolution: ProjectResolution): Promise<GateResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const seedFiles = new Set<string>();
  if (resolution.configPath && existsSync(resolution.configPath)) seedFiles.add(resolution.configPath);
  if (resolution.manifest?.entryPath && existsSync(resolution.manifest.entryPath)) seedFiles.add(resolution.manifest.entryPath);
  if (resolution.manifest?.manifest) {
    const entries = [
      ...(resolution.manifest.manifest.scenes ?? []),
      ...(resolution.manifest.manifest.timelines ?? []),
      ...(resolution.manifest.manifest.images ?? []),
      ...(resolution.manifest.manifest.audio ?? []),
    ];
    for (const entry of entries) {
      if (entry.file) {
        const full = resolve(resolution.manifest.rootDir, entry.file);
        if (existsSync(full)) seedFiles.add(full);
      }
    }
  }

  const visited = new Set<string>();
  const queue = [...seedFiles];

  const importRegex = /(?:import|export)\s+(?:(?:[^"'\n]+from\s+)?["'](\.[^"']+)["']|["'](\.[^"']+)["'])|import\s*\(\s*["'](\.[^"']+)["']\s*\)|require\s*\(\s*["'](\.[^"']+)["']\s*\)/g;

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);

    let source = "";
    try {
      source = await readFile(file, "utf-8");
    } catch {
      continue;
    }

    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(source)) !== null) {
      const spec = match[1] || match[2] || match[3] || match[4];
      if (spec) {
        const resolved = resolveLocalImport(file, spec, resolution.root);
        if (resolved && !visited.has(resolved)) {
          queue.push(resolved);
        }
      }
    }

    const fileIssues = scanSourceForNonDeterminism(source, file);
    for (const issue of fileIssues) {
      errors.push({
        code: issue.code,
        severity: "error",
        gate: "determinism",
        file: issue.position?.file ?? file,
        line: issue.position?.line,
        column: issue.position?.column,
        message: issue.message,
        fix: issue.hint ?? "Replace non-deterministic call with deterministic seed API",
        fixHint: issue.hint ?? "Replace non-deterministic call with deterministic seed API",
      });
    }
  }

  return { errors, warnings };
}

async function runCapabilityGate(resolution: ProjectResolution): Promise<GateResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  try {
    const canvasModule = await import("@napi-rs/canvas").catch(() => null);
    if (!canvasModule) throw new Error("Canvas module (@napi-rs/canvas) not available");
    const { Canvas } = canvasModule;
    const canvas = new Canvas(10, 10);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 10, 10);
  } catch (error) {
    errors.push({
      code: ErrorCode.CC7004,
      severity: "error",
      gate: "capability",
      message: `Canvas renderer initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Ensure @napi-rs/canvas is installed and supported",
      fixHint: "Ensure @napi-rs/canvas is installed and supported",
    });
  }

  try {
    const execFileAsync = promisify(execFile);
    const ffmpeg = resolveBinary("ffmpeg", { ...resolution.config.binaries, root: resolution.root });
    const { stdout } = await execFileAsync(ffmpeg.path, ["-hide_banner", "-encoders"], { timeout: 3000 });
    const required = ["libx264"];
    const missing = required.filter((name) => !stdout.includes(name));
    if (missing.length > 0) {
      warnings.push({
        code: ErrorCode.CC7002,
        severity: "warning",
        gate: "capability",
        message: `Missing encoder capability: ${missing.join(", ")}`,
        fix: "Install ffmpeg with libx264 support",
        fixHint: "Install ffmpeg with libx264 support",
      });
    }
  } catch (error) {
    warnings.push({
      code: ErrorCode.CC7002,
      severity: "warning",
      gate: "capability",
      message: `Encoder capability probe skipped: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Ensure ffmpeg is installed and configured",
      fixHint: "Ensure ffmpeg is installed and configured",
    });
  }

  return { errors, warnings };
}

async function runResourcesGate(resolution: ProjectResolution): Promise<GateResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const roots = resolveProjectRoots(resolution.root, resolution.config);

  const checkWritable = (dir: string): boolean => {
    try {
      if (existsSync(dir)) {
        accessSync(dir, constants.W_OK);
        return true;
      }
      let current = dirname(dir);
      while (!existsSync(current) && current !== dirname(current)) {
        current = dirname(current);
      }
      accessSync(current, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  };

  for (const [key, dir] of [["outputDir", roots.output], ["cacheDir", roots.cache]] as const) {
    if (!checkWritable(dir)) {
      errors.push({
        code: ErrorCode.CC1003,
        severity: "error",
        gate: "resources",
        file: dir,
        message: `Directory "${key}" is not writable: ${dir}`,
        fix: `Ensure write permissions for ${dir}`,
        fixHint: `Ensure write permissions for ${dir}`,
      });
    }
  }

  try {
    const stats = await statfs(resolution.root);
    const freeGB = (stats.bavail * stats.bsize) / (1024 ** 3);
    if (freeGB < 1) {
      warnings.push({
        code: ErrorCode.CC7003,
        severity: "warning",
        gate: "resources",
        message: `Low disk space on project volume: ${freeGB.toFixed(2)} GB free (< 1 GB)`,
        fix: "Free up disk space on the project volume",
        fixHint: "Free up disk space on the project volume",
      });
    }
  } catch {
    // Note: statfs not available on some environments; omit warning
  }

  return { errors, warnings };
}

async function runSingleGate(gate: ValidationGate, resolution: ProjectResolution): Promise<GateResult> {
  switch (gate) {
    case "runtime":
      return runRuntimeGate();
    case "config":
      return runConfigGate(resolution);
    case "manifest":
      return runManifestGate(resolution);
    case "modules":
      return runModulesGate(resolution);
    case "media":
      return runMediaGate(resolution);
    case "fonts":
      return runFontsGate(resolution);
    case "determinism":
      return runDeterminismGate(resolution);
    case "capability":
      return runCapabilityGate(resolution);
    case "resources":
      return runResourcesGate(resolution);
  }
}

export async function runValidation(
  resolution: ProjectResolution,
  options: ValidationEngineOptions = {},
): Promise<ValidationReport> {
  const mode = options.mode ?? "all";
  const gates = GATES_FOR_MODE[mode] ?? ORDERED_GATES;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const categories = emptyCategories();
  let stoppedAtGate: ValidationGate | undefined;

  for (const gate of gates) {
    const result = await runSingleGate(gate, resolution);
    for (const w of result.warnings) {
      warnings.push(w);
      categories[gate].warnings += 1;
    }
    if (result.errors.length > 0) {
      for (const e of result.errors) {
        errors.push(e);
        categories[gate].errors += 1;
      }
      stoppedAtGate = gate;
      break; // Stop at first gate with errors
    }
  }

  const contract = summarizeProjectContract(resolution);
  const ok = errors.length === 0;

  return {
    ok,
    mode,
    stoppedAtGate,
    errors,
    warnings,
    notes: pendingNotes(),
    contract,
    categories,
  };
}
