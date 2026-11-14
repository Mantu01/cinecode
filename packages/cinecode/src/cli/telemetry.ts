import { Command } from "commander";
import { telemetryBroker } from "../plugin/telemetry.js";

export function createTelemetryCommand(): Command {
  const cmd = new Command("telemetry")
    .description("Manage anonymous telemetry settings and view status");

  cmd
    .command("status")
    .description("Show current telemetry consent status and recent scrubbed records")
    .action(() => {
      const status = telemetryBroker.getStatus();
      console.log("Cinecode Telemetry Status:");
      console.log(`  Consent Enabled:  ${status.enabled ? "YES (Opt-in)" : "NO (Opt-out / Disabled)"}`);
      console.log(`  Endpoint:         ${status.endpoint}`);
      console.log(`  Buffered Records: ${status.bufferedRecordsCount}`);

      if (status.recentRecords.length > 0) {
        console.log("\nRecent Anonymized Payloads (Zero-PII):");
        for (const r of status.recentRecords) {
          const date = new Date(r.timestamp).toISOString();
          console.log(`  [${date}] ${r.event}: ${JSON.stringify(r.payload)}`);
        }
      }
    });

  return cmd;
}
