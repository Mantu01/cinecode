import { Command } from "commander";
import { formatCapabilityReport } from "../media/formats.js";
import { runReport } from "./run-report.js";

export function createFormatsCommand(): Command {
  return new Command("formats")
    .description("List input, output and planned media formats")
    .action(() => {
      const report = formatCapabilityReport();
      runReport.result({ ...report });
      if (runReport.isMachine()) return;
      const print = (title: string, entries: readonly { format: string; kind: string; status: string; direction: string; note?: string }[]): void => {
        console.log(`${title}\n`);
        for (const entry of entries) {
          console.log(`  ${entry.format.padEnd(14)} ${entry.kind.padEnd(9)} ${entry.status.padEnd(10)} ${entry.direction}${entry.note ? ` — ${entry.note}` : ""}`);
        }
        console.log("");
      };
      print("Output formats", report.output);
      print("Input formats", report.input);
      if (report.helpers.length > 0) print("Command-produced formats", report.helpers);
      if (report.planned.length > 0) print("Planned formats (not accepted by any command)", report.planned);
    });
}
