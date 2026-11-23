import type { Command } from "commander";
import { pc } from "../output/palette.js";
import { runSecurityAudit } from "../security/scanner.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { runReport } from "../output/run-report.js";
import { resolve } from "node:path";

export async function auditCommand(
  options: { allowCopyleft?: boolean; json?: boolean; root?: string; config?: string } = {},
  context?: import("../gate/preflight.js").PreflightContext,
): Promise<void> {
  if (!runReport.isMachine()) runReport.diagnostic("Running Cinecode security and license audit...\n");
  const root = context?.resolution?.root ?? options.root ?? process.cwd();
  const mediaDir = context?.resolution?.context.roots.media ?? resolve(root, "media");
  const report = await runSecurityAudit({ projectDir: root, mediaDir });
  const licenses = report.issues.filter((issue) => issue.type === "license").map((issue) => ({ package: issue.packageOrFile, title: issue.title, severity: issue.severity }));
  const vulnerabilities = report.issues.filter((issue) => issue.type === "vulnerability");
  runReport.result({ ...report, licenses, vulnerabilities });
  for (const issue of report.issues) runReport.warn(`CC${issue.severity === "critical" || issue.severity === "high" ? "8002" : "8003"}`, issue.title, issue.packageOrFile);

  if (options.json) {
    if (report.status === "fail" && !options.allowCopyleft) {
      throw createError(ErrorCode.CC1013, { count: report.issues.length });
    }
    return;
  }

  runReport.diagnostic(`Scanned ${report.scannedDependencies} dependencies and ${report.scannedAssets} assets.`);
  runReport.diagnostic(`Status: ${report.status === "pass" ? pc.green(pc.bold("PASSED")) : report.status === "warn" ? pc.yellow(pc.bold("WARNING")) : pc.red(pc.bold("FAILED"))}\n`);

  if (report.issues.length === 0) {
    runReport.diagnostic(pc.green("✔ No vulnerabilities or license incompatibilities detected."));
    return;
  }

  runReport.diagnostic("SEVERITY".padEnd(12) + "TARGET".padEnd(30) + "ISSUE");
  runReport.diagnostic("-".repeat(80));

  for (const issue of report.issues) {
    const sevStr =
      issue.severity === "high" || issue.severity === "critical"
        ? pc.red(issue.severity.toUpperCase())
        : issue.severity === "moderate"
        ? pc.yellow(issue.severity.toUpperCase())
        : pc.cyan(issue.severity.toUpperCase());

    runReport.diagnostic(
      sevStr.padEnd(20) +
      issue.packageOrFile.slice(0, 28).padEnd(30) +
      issue.title,
    );
    if (issue.remediation) {
      runReport.diagnostic(pc.dim(`  └─ Remediation: ${issue.remediation}`));
    }
  }

  runReport.diagnostic("");
  if (report.status === "fail" && !options.allowCopyleft) {
    throw createError(ErrorCode.CC1013, { count: report.issues.length }, { fixHint: "Audit failed due to high-risk issues or copyleft licenses; use --allow-copyleft to report without failing." });
  }
}

