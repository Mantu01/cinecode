import { Command } from "commander";
import { createError, ErrorCode, formatError } from "../errors/index.js";
import { createProjectResolver, reportResolution } from "./project-resolver.js";
import { runReport } from "./run-report.js";
import { buildCommanderCommand, findCommand } from "./command-registry.js";
import {
  runValidation,
  applySafeFixes,
  type ValidationReport,
  type ValidateMode,
  type ValidationIssue,
  type ValidationGate,
  type ProjectContractSummary,
} from "./validation-engine.js";

export interface ValidateOptions {
  config?: string;
  root?: string;
  strict?: boolean;
  json?: boolean;
  fix?: boolean;
  mode?: ValidateMode;
  verbose?: boolean;
}

export function printContractTable(contract: ProjectContractSummary): void {
  console.log("Project Contract:");
  console.log(`  source   : ${contract.roots.source.path} [exists: ${contract.roots.source.exists ? "yes" : "no"}, writable: ${contract.roots.source.writable ? "yes" : "no"}]`);
  console.log(`  media    : ${contract.roots.media.path} [exists: ${contract.roots.media.exists ? "yes" : "no"}, writable: ${contract.roots.media.writable ? "yes" : "no"}]`);
  console.log(`  output   : ${contract.roots.output.path} [exists: ${contract.roots.output.exists ? "yes" : "no"}, writable: ${contract.roots.output.writable ? "yes" : "no"}]`);
  console.log(`  cache    : ${contract.roots.cache.path} [exists: ${contract.roots.cache.exists ? "yes" : "no"}, writable: ${contract.roots.cache.writable ? "yes" : "no"}]`);
  console.log(`  entry    : ${contract.entry.path} [exists: ${contract.entry.exists ? "yes" : "no"}, readable: ${contract.entry.readable ? "yes" : "no"}]`);
  console.log(`  manifest : ${contract.manifest.path} [exists: ${contract.manifest.exists ? "yes" : "no"}, readable: ${contract.manifest.readable ? "yes" : "no"}]`);
}

export function printGroupedIssues(issues: readonly ValidationIssue[]): void {
  const byFile = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    const key = issue.file ?? "(project)";
    const list = byFile.get(key) ?? [];
    list.push(issue);
    byFile.set(key, list);
  }

  for (const [file, fileIssues] of byFile) {
    console.log(`\n${file}:`);
    for (const issue of fileIssues) {
      const loc = issue.line !== undefined ? `:${issue.line}${issue.column !== undefined ? `:${issue.column}` : ""}` : "";
      const prefix = issue.severity === "error" ? "  error" : "  warn ";
      console.log(`${prefix} [${issue.code}] ${issue.message}${loc}`);
      if (issue.fix || issue.fixHint) {
        console.log(`    fix: ${issue.fix ?? issue.fixHint}`);
      }
    }
  }
}

export async function validateCommand(options: ValidateOptions = {}): Promise<void> {
  const resolver = createProjectResolver({ root: options.root, config: options.config });
  const resolution = await resolver.resolve();
  reportResolution(resolution, options.verbose === true);

  if (options.fix) {
    const fixResult = await applySafeFixes(resolution);
    if (!runReport.isMachine()) {
      if (fixResult.applied.length > 0) {
        console.log("Safe fixes applied:");
        for (const item of fixResult.applied) console.log(`  - ${item}`);
      } else {
        console.log("No safe fixes needed");
      }
    }
  }

  const report = await runValidation(resolution, {
    mode: options.mode ?? "all",
    strict: options.strict,
  });

  const machineOutput = {
    valid: report.ok,
    mode: report.mode,
    stoppedAtGate: report.stoppedAtGate,
    notes: report.notes,
    contract: report.contract,
    categories: report.categories,
    errors: report.errors.map((e) => ({
      code: e.code,
      severity: e.severity,
      gate: e.gate,
      message: e.message,
      fix: e.fix ?? e.fixHint,
      fixHint: e.fixHint ?? e.fix,
      file: e.file,
      line: e.line,
      column: e.column,
    })),
    warnings: report.warnings.map((w) => ({
      code: w.code,
      severity: w.severity,
      gate: w.gate,
      message: w.message,
      fix: w.fix ?? w.fixHint,
      fixHint: w.fixHint ?? w.fix,
      file: w.file,
      line: w.line,
      column: w.column,
    })),
  };
  runReport.result(machineOutput);
  for (const warning of report.warnings) runReport.warn(warning.code, warning.message, warning.file);

  if (!runReport.isMachine()) {
    printContractTable(report.contract);
    const allIssues = [...report.errors, ...report.warnings];
    if (allIssues.length > 0) {
      printGroupedIssues(allIssues);
    }

    if (report.ok && report.warnings.length === 0) {
      console.log(`\nValidation passed (${report.mode} mode)`);
    } else if (report.ok) {
      console.log(`\nValidation passed with ${report.warnings.length} warning(s) (${report.mode} mode)`);
    } else {
      console.log(`\nValidation failed at gate "${report.stoppedAtGate}": ${report.errors.length} error(s), ${report.warnings.length} warning(s)`);
    }
  }

  const failed = !report.ok || (options.strict && report.warnings.length > 0);
  if (failed) {
    const count = report.errors.length + (options.strict ? report.warnings.length : 0);
    throw createError(ErrorCode.CC1013, { count }, { location: { file: resolution.configPath } });
  }
}

export function createValidateCommand(): Command {
  return buildCommanderCommand(findCommand("validate")!);
}

export {
  runValidation,
  applySafeFixes,
  type ValidationReport,
  type ValidateMode,
  type ValidationIssue,
  type ValidationGate,
};
