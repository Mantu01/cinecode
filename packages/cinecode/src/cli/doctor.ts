import { Command } from "commander";
import pc from "picocolors";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";
import { createProjectResolver, type ProjectResolution } from "./project-resolver.js";
import { loadProjectContext, type ProjectContext } from "./project-context.js";
import { ensureGitignoreEntries } from "../config/gitignore.js";
import { authoredRoots } from "../config/roots.js";
import {
  collectHealthReport,
  type HealthReport,
  type HealthSection,
  type HealthSectionStatus,
} from "./health-collector.js";
import { findCommand, buildCommanderCommand } from "./command-registry.js";

export type { HealthReport, HealthSection, HealthSectionStatus };
export type DoctorCheck = HealthSection;
export { collectHealthReport };

export interface DoctorCommandOptions {
  readonly config?: string;
  readonly root?: string;
  readonly fix?: boolean;
  readonly json?: boolean;
  readonly strict?: boolean;
  readonly verbose?: boolean;
  readonly cache?: string;
  readonly noColor?: boolean;
}

function isColorEnabled(noColorOption?: boolean): boolean {
  if (noColorOption) return false;
  if (Boolean(process.env.NO_COLOR)) return false;
  if (process.argv.includes("--no-color")) return false;
  return Boolean(process.stdout?.isTTY) && pc.isColorSupported;
}

function formatStatus(status: HealthSectionStatus, useColor: boolean): string {
  if (!useColor) return `[${status}]`;
  switch (status) {
    case "PASS":
      return pc.green("[PASS]");
    case "WARN":
      return pc.yellow("[WARN]");
    case "FAIL":
      return pc.red("[FAIL]");
    case "INFO":
      return pc.cyan("[INFO]");
    case "SKIPPED":
      return pc.dim("[SKIP]");
  }
}

export async function doctorCommand(options: DoctorCommandOptions = {}): Promise<void> {
  let context: ProjectContext | null = null;
  let resolution: ProjectResolution | null = null;

  try {
    context = await loadProjectContext({ root: options.root, config: options.config });
  } catch {
    context = null;
  }

  if (context) {
    try {
      const resolver = createProjectResolver({ root: options.root, config: options.config });
      resolution = await resolver.resolve();
    } catch {
      resolution = null;
    }
  }

  const activeProject = resolution ?? (context ? {
    root: context.root,
    configPath: context.configPath,
    config: context.config,
    context,
    manifest: null,
    manifestPath: "",
  } : null);

  if (options.fix && activeProject) {
    const authored = authoredRoots(activeProject.config);
    const added = await ensureGitignoreEntries({
      sourceDir: authored.source,
      mediaDir: authored.media,
      outputDir: authored.output,
      cacheDir: authored.cache,
      projectRoot: activeProject.root,
      enabled: activeProject.config.gitignore ?? true,
    });
    if (added.length > 0) {
      console.log(`Fixed: Added managed .gitignore entries: ${added.join(", ")}`);
    }
  }

  const report = await collectHealthReport(activeProject, { cacheDir: options.cache });

  runReport.result({
    ...report,
  });

  for (const issue of report.issues) {
    runReport.warn(ErrorCode.CC7004, issue);
  }

  const isMachine = runReport.isMachine() || options.json === true;

  if (!isMachine) {
    const useColor = isColorEnabled(options.noColor);
    console.log(useColor ? pc.bold("Cinecode Doctor") : "Cinecode Doctor");
    console.log(useColor ? pc.dim("---------------") : "---------------");

    for (const note of report.notes) {
      console.log(useColor ? pc.cyan(`ℹ ${note}`) : `ℹ ${note}`);
    }

    for (const check of report.checks) {
      const statusBadge = formatStatus(check.status, useColor);
      const fixableStr = check.fixable ? (useColor ? pc.dim(" (fixable)") : " (fixable)") : "";
      console.log(`${statusBadge} ${check.name}: ${check.message}${fixableStr}`);
      if (check.status === "FAIL" && check.fixHint) {
        console.log(useColor ? pc.dim(`       Hint: ${check.fixHint}`) : `       Hint: ${check.fixHint}`);
      }
    }
  }

  if (!report.passed) {
    throw createError(ErrorCode.CC7004, {
      reason: report.issues.join("; ") || "One or more health checks failed",
    });
  }

  if (options.strict && report.checks.some((c) => c.status === "WARN")) {
    const warnings = report.checks.filter((c) => c.status === "WARN").map((c) => `${c.name}: ${c.message}`);
    throw createError(ErrorCode.CC7004, {
      reason: `Strict mode failed with warnings: ${warnings.join("; ")}`,
    });
  }
}

export function createDoctorCommand(): Command {
  const spec = findCommand("doctor");
  if (!spec) throw new Error("Command 'doctor' not found in registry");
  return buildCommanderCommand(spec);
}
