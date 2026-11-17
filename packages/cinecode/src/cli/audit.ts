import { Command } from "commander";
import pc from "picocolors";
import { runSecurityAudit } from "./security/scanner.js";
import { EXIT_CODES, ExitSignal } from "./exit-codes.js";

export function createAuditCommand(): Command {
  const cmd = new Command("audit")
    .description("Scan dependencies, plugins, and media assets for licenses and security vulnerabilities")
    .option("--allow-copyleft", "Do not fail on copyleft licenses (e.g. GPL, AGPL)", false)
    .action(async (options) => {
      console.log("Running Cinecode security and license audit...\n");
      const report = await runSecurityAudit();

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        if (report.status === "fail" && !options.allowCopyleft) {
          throw new ExitSignal(EXIT_CODES.runtime);
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
        console.error(pc.red("✖ Audit failed due to high-risk issues or copyleft licenses."));
        throw new ExitSignal(EXIT_CODES.runtime);
      }
    });

  return cmd;
}
