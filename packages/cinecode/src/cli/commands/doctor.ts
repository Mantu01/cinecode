import { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { pc } from "../output/palette.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { runReport } from "../output/run-report.js";
import { createProjectResolver, type ProjectResolution } from "../resolve/project-resolver.js";
import { ensureGitignoreEntries } from "../../config/gitignore.js";
import { authoredRoots } from "../../config/roots.js";
import { collectHealthReport } from "../shared/health/collect.js";
import type { HealthSectionStatus } from "../shared/health/types.js";
import { colorEnabled } from "../../observability/invocation-context.js";


export interface DoctorFixOutcome {
  readonly created: readonly string[];
  readonly gitignoreAdded: readonly string[];
  readonly changed: readonly { readonly name: string; readonly from: HealthSectionStatus; readonly to: HealthSectionStatus }[];
}

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
  if (!colorEnabled()) return false;
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

export async function doctorCommand(
  options: DoctorCommandOptions = {},
  preflightContext?: import("../gate/preflight.js").PreflightContext,
): Promise<void> {
  let activeProject: ProjectResolution | null = preflightContext?.resolution ?? null;

  if (!activeProject) {
    try {
      const resolver = createProjectResolver({ root: options.root, config: options.config });
      activeProject = await resolver.resolve();
    } catch {
      activeProject = null;
    }
  }

  const before = await collectHealthReport(activeProject, { cacheDir: options.cache });
  let fix: DoctorFixOutcome | undefined;

  if (options.fix && activeProject) {
    const created: string[] = [];
    for (const dir of [activeProject.context.roots.output, activeProject.context.roots.cache]) {
      const rel = relative(activeProject.root, dir);
      if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) continue;
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
        created.push(dir);
      }
    }
    const authored = authoredRoots(activeProject.config);
    const gitignoreAdded = await ensureGitignoreEntries({
      sourceDir: authored.source,
      mediaDir: authored.media,
      outputDir: authored.output,
      cacheDir: authored.cache,
      projectRoot: activeProject.root,
      enabled: activeProject.config.gitignore ?? true,
    });
    if (!runReport.isMachine()) {
      if (created.length > 0) runReport.diagnostic(`Fixed: created ${created.join(", ")}`);
      if (gitignoreAdded.length > 0) runReport.diagnostic(`Fixed: added managed .gitignore entries: ${gitignoreAdded.join(", ")}`);
    }
    fix = { created, gitignoreAdded, changed: [] };
  }

  const report = fix ? await collectHealthReport(activeProject, { cacheDir: options.cache }) : before;
  if (fix) {
    fix = {
      ...fix,
      changed: report.checks.flatMap((check, index) => {
        const previous = before.checks[index];
        return previous && previous.status !== check.status
          ? [{ name: check.name, from: previous.status, to: check.status }]
          : [];
      }),
    };
    if (!runReport.isMachine()) {
      for (const change of fix.changed) runReport.diagnostic(`Fixed: ${change.name} ${change.from} -> ${change.to}`);
    }
  }

  runReport.result({
    ...report,
    ...(fix ? { fix } : {}),
  });

  for (const issue of report.issues) {
    runReport.warn(ErrorCode.CC7004, issue);
  }

  const isMachine = runReport.isMachine() || options.json === true;

  if (!isMachine) {
    const useColor = isColorEnabled(options.noColor);
    runReport.diagnostic(useColor ? pc.bold("Cinecode Doctor") : "Cinecode Doctor");
    runReport.diagnostic(useColor ? pc.dim("---------------") : "---------------");

    for (const note of report.notes) {
      runReport.diagnostic(useColor ? pc.cyan(`ℹ ${note}`) : `ℹ ${note}`);
    }

    for (const check of report.checks) {
      const statusBadge = formatStatus(check.status, useColor);
      const fixableStr = check.fixable ? (useColor ? pc.dim(" (fixable)") : " (fixable)") : "";
      runReport.diagnostic(`${statusBadge} ${check.name}: ${check.message}${fixableStr}`);
      if (check.status === "FAIL" && check.fixHint) {
        runReport.diagnostic(useColor ? pc.dim(`       Hint: ${check.fixHint}`) : `       Hint: ${check.fixHint}`);
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

