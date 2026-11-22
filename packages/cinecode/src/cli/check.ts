import { Command } from "commander";
import { findCommand, buildCommanderCommand } from "./command-registry.js";
import {
  runValidation,
  type ValidationReport,
  type ValidationIssue,
  type ValidationGate,
} from "./validation-engine.js";
import { validateCommand, type ValidateOptions } from "./validate.js";
import type { ProjectResolution } from "./project-resolver.js";

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

export interface CheckOptions {
  readonly config?: string;
  readonly root?: string;
  readonly strict?: boolean;
  readonly json?: boolean;
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

/**
 * Run authoring checks using the unified validation engine.
 */
export async function runCheck(project: ProjectResolution): Promise<CheckReport> {
  const report = await runValidation(project, { mode: "authoring-only" });

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

  return {
    ok: report.ok,
    errors,
    warnings,
    notes: report.notes,
    categories,
  };
}

export async function checkCommand(options: CheckOptions): Promise<void> {
  await validateCommand({
    config: options.config,
    root: options.root,
    strict: options.strict,
    json: options.json,
    mode: "authoring-only",
  });
}

export function createCheckCommand(): Command {
  const spec = findCommand("check") ?? findCommand("validate");
  if (!spec) throw new Error("Command 'check' not found in registry");
  return buildCommanderCommand(spec);
}
