import { Command } from "commander";
import pc from "picocolors";
import { runSecurityAudit } from "./security/scanner.js";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";

export function createAuditCommand(): Command {
  const cmd = new Command("audit")
    .description("Scan dependencies, plugins, and media assets for licenses and security vulnerabilities")
    .option("--allow-copyleft", "Do not fail on copyleft licenses (e.g. GPL, AGPL)", false)
    .action(async (options) => {
      console.log("Running Cinecode security and license audit...\n");
      const report = await runSecurityAudit();
      runReport.result({ ...report });
      for (const issue of report.issues) runReport.warn(`CC${issue.severity === "critical" || issue.severity === "high" ? "8002" : "8003"}`, issue.title, issue.packageOrFile);

      if (options.json) {
        if (report.status === "fail" && !options.allowCopyleft) {
          throw createError(ErrorCode.CC1013, { count: report.issues.length });
        }
        return;
      }

      console.log(`Scanned ${report.scannedDependencies} dependencies and ${report.scannedAssets} assets.`);
      console.log(`Status: ${report.status === "pass" ? pc.green(pc.bold("PASSED")) : report.status === "warn" ? pc.yellow(pc.bold("WARNING")) : pc.red(pc.bold("FAILED"))}\n`);

      if (report.issues.length === 0) {
        console.log(pc.green("✔ No vulnerabilities or license incompatibilities detected."));
        return;
      }

      console.log("SEVERITY".padEnd(12) + "TARGET".padEnd(30) + "ISSUE");
      console.log("-".repeat(80));

      for (const issue of report.issues) {
        const sevStr =
          issue.severity === "high" || issue.severity === "critical"
            ? pc.red(issue.severity.toUpperCase())
            : issue.severity === "moderate"
            ? pc.yellow(issue.severity.toUpperCase())
            : pc.cyan(issue.severity.toUpperCase());

        console.log(
          sevStr.padEnd(20) +
          issue.packageOrFile.slice(0, 28).padEnd(30) +
          issue.title,
        );
        if (issue.remediation) {
          console.log(pc.dim(`  └─ Remediation: ${issue.remediation}`));
        }
      }

      console.log();
      if (report.status === "fail" && !options.allowCopyleft) {
        throw createError(ErrorCode.CC1013, { count: report.issues.length }, { fixHint: "Audit failed due to high-risk issues or copyleft licenses; use --allow-copyleft to report without failing." });
      }
    });

  return cmd;
}
