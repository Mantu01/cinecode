import type { Command } from "commander";
import { formatCapabilityReport } from "../../media/formats.js";
import { runReport } from "../output/run-report.js";

export function formatsCommand(): void {
  const report = formatCapabilityReport();
  runReport.result({ ...report });
  if (runReport.isMachine()) return;
  const print = (title: string, entries: readonly { format: string; kind: string; status: string; direction: string; note?: string }[]): void => {
    runReport.diagnostic(`${title}\n`);
    for (const entry of entries) {
      runReport.diagnostic(`  ${entry.format.padEnd(14)} ${entry.kind.padEnd(9)} ${entry.status.padEnd(10)} ${entry.direction}${entry.note ? ` — ${entry.note}` : ""}`);
    }
    runReport.diagnostic("");
  };
  print("Output formats", report.output);
  print("Input formats", report.input);
  if (report.helpers.length > 0) print("Command-produced formats", report.helpers);
  if (report.planned.length > 0) print("Planned formats (not accepted by any command)", report.planned);
}

