import {
  runValidation,
  type ValidationReport,
  type ValidationIssue,
  type ValidationGate,
} from "./validation-engine.js";
import type { ProjectResolution } from "../resolve/project-resolver.js";

/**
 * `cinecode check` — authoring-only mode of the validation engine.
 *
 * Runs the single validation engine with mode="authoring-only".
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

function mapGateToCategory(gate: ValidationGate): CheckCategory {
  switch (gate) {
    case "config":
      return "config";
    case "manifest":
    case "modules":
    case "runtime":
      return "authoring";
    case "media":
      return "media";
    case "fonts":
      return "fonts";
    case "determinism":
      return "determinism";
    case "capability":
    case "resources":
      return "authoring";
  }
}

function toCheckIssue(issue: ValidationIssue): CheckIssue {
  return {
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    category: mapGateToCategory(issue.gate),
    fixHint: issue.fixHint ?? issue.fix,
    file: issue.file,
    line: issue.line,
    column: issue.column,
  };
}

/** Run authoring checks using the unified validation engine. */
export async function runCheck(project: ProjectResolution): Promise<CheckReport> {
  const report: ValidationReport = await runValidation(project, { mode: "authoring-only" });

  const categories: Record<CheckCategory, { errors: number; warnings: number }> = {
    config: { errors: 0, warnings: 0 },
    authoring: { errors: 0, warnings: 0 },
    media: { errors: 0, warnings: 0 },
    fonts: { errors: 0, warnings: 0 },
    determinism: { errors: 0, warnings: 0 },
  };

  const errors = report.errors.map((e) => {
    const issue = toCheckIssue(e);
    categories[issue.category].errors += 1;
    return issue;
  });

  const warnings = report.warnings.map((w) => {
    const issue = toCheckIssue(w);
    categories[issue.category].warnings += 1;
    return issue;
  });

  return { ok: report.ok, errors, warnings, notes: report.notes, categories };
}
