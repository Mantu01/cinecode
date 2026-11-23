import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { resolveProjectRoots, authoredRoots } from "../../config/roots.js";
import { ensureGitignoreEntries } from "../../config/gitignore.js";
import { pendingNotes } from "../../errors/degradations.js";
import { runSingleGate } from "./validation-gates.js";
import type { ProjectResolution } from "../resolve/project-resolver.js";
import type { ValidationGate, ValidationIssue, ValidateMode, ProjectContractSummary, ValidationReport } from "./validation-types.js";
export type { ValidationGate, ValidateMode, ValidationIssue, ProjectContractSummary, ValidationReport } from "./validation-types.js";

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

export const GATES_FOR_MODE: Readonly<Record<ValidateMode, readonly ValidationGate[]>> = {
  "all": ORDERED_GATES,
  "authoring-only": ["runtime", "config", "manifest", "modules", "media", "fonts", "determinism"],
  "media": ["runtime", "config", "manifest", "modules", "media"],
  "fonts": ["runtime", "config", "manifest", "fonts"],
};

export const GATE_PREREQUISITES: Readonly<Record<ValidationGate, readonly ValidationGate[]>> = {
  runtime: [],
  config: ["runtime"],
  manifest: ["config"],
  modules: ["manifest"],
  media: ["runtime"],
  fonts: ["runtime"],
  determinism: ["manifest"],
  capability: ["runtime"],
  resources: ["runtime"],
};

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

export async function runValidation(
  resolution: ProjectResolution,
  options: ValidationEngineOptions = {},
): Promise<ValidationReport> {
  const mode = options.mode ?? "all";
  const gates = GATES_FOR_MODE[mode] ?? ORDERED_GATES;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const notes: string[] = [];
  const categories = emptyCategories();
  const failedGates = new Set<ValidationGate>();
  const reportedFailedPrereqs = new Set<ValidationGate>();
  let stoppedAtGate: ValidationGate | undefined;

  for (const gate of gates) {
    const prereqs = GATE_PREREQUISITES[gate] ?? [];
    const failedPrereq = prereqs.find((p) => failedGates.has(p));
    if (failedPrereq) {
      failedGates.add(gate);
      stoppedAtGate ??= gate;
      if (!reportedFailedPrereqs.has(failedPrereq)) {
        reportedFailedPrereqs.add(failedPrereq);
        notes.push(`dependent gates skipped: prerequisite "${failedPrereq}" failed`);
      }
      continue;
    }

    const result = await runSingleGate(gate, resolution);
    for (const w of result.warnings) {
      warnings.push(w);
      categories[gate].warnings += 1;
    }
    if (result.errors.length > 0) {
      failedGates.add(gate);
      for (const e of result.errors) {
        errors.push(e);
        categories[gate].errors += 1;
      }
    }
  }

  const contract = summarizeProjectContract(resolution);
  const ok = errors.length === 0 && (!options.strict || warnings.length === 0);

  return {
    ok,
    mode,
    stoppedAtGate,
    errors,
    warnings,
    notes: [...notes, ...pendingNotes()],
    contract,
    categories,
  };
}
