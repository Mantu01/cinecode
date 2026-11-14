import { Command } from "commander";
import pc from "picocolors";
import { fetchWithRetry } from "../media/network-resilience.js";

export interface ProbeResult {
  timestamp: string;
  latencyMs: number;
  status: number;
  ok: boolean;
  slaPercent: number;
}

export function createProbeCommand(): Command {
  const cmd = new Command("probe")
    .description("Continuous SLA-grade synthetic uptime monitoring probe")
    .argument("[endpoint]", "Health endpoint URL to monitor", "http://localhost:3000/healthz")
    .option("-i, --interval <seconds>", "Probe polling interval", "5")
    .option("-w, --webhook <url>", "Alert webhook URL (Slack/PagerDuty) on probe failure")
    .option("--max-latency <ms>", "Maximum acceptable latency threshold before alerting", "1000")
    .action(async (endpoint: string, options) => {
      const intervalMs = (parseInt(options.interval, 10) || 5) * 1000;
      const maxLatency = parseInt(options.maxLatency, 10) || 1000;

      console.log(`Starting synthetic SLA probe against: ${pc.cyan(endpoint)} (interval: ${options.interval}s)...`);

      let totalProbes = 0;
      let successfulProbes = 0;

      const runCheck = async () => {
        totalProbes++;
        const started = performance.now();
        let ok = false;
        let status = 0;

        try {
          const res = await fetchWithRetry(endpoint, undefined, { maxRetries: 1 });
          status = res.status;
          ok = res.ok;
          if (ok) successfulProbes++;
        } catch {
          ok = false;
        }

        const latency = Math.round(performance.now() - started);
        const sla = ((successfulProbes / totalProbes) * 100).toFixed(2);
        const time = new Date().toISOString().substring(11, 19);

        if (ok && latency <= maxLatency) {
          console.log(
            `${pc.dim(time)} ${pc.green("UP")} ${latency}ms (HTTP ${status}) · SLA: ${pc.cyan(`${sla}%`)}`,
          );
        } else {
          console.log(
            `${pc.dim(time)} ${pc.red("ALERT / DOWN")} ${latency}ms (HTTP ${status}) · SLA: ${pc.yellow(`${sla}%`)}`,
          );

          if (options.webhook) {
            try {
              await fetch(options.webhook, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  text: `🚨 Cinecode SLA Probe Failure! Endpoint: ${endpoint}, HTTP: ${status}, Latency: ${latency}ms, SLA: ${sla}%`,
                }),
              });
            } catch {
              void 0;
            }
          }
        }
      };

      await runCheck();
      const timer = setInterval(runCheck, intervalMs);

      process.on("SIGINT", () => {
        clearInterval(timer);
        console.log(`\nProbe stopped. Final SLA: ${((successfulProbes / (totalProbes || 1)) * 100).toFixed(2)}%`);
        process.exit(0);
      });
    });

  return cmd;
}
