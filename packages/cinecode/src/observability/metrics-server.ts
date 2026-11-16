import http from "node:http";
import { globalMetrics, type MetricsRegistry } from "./metrics.js";
import { logger } from "./logger.js";

export interface MetricsServerOptions {
  readonly port: number;
  readonly host?: string;
  readonly registry?: MetricsRegistry;
}

export interface MetricsServerHandle {
  readonly port: number;
  readonly close: () => Promise<void>;
}

/** Starts a small HTTP server exposing Prometheus /metrics and /health. */
export async function startMetricsServer(options: MetricsServerOptions): Promise<MetricsServerHandle> {
  const registry = options.registry ?? globalMetrics;
  const server = http.createServer((req, res) => {
    if (req.url === "/metrics") {
      registry
        .getMetricsText()
        .then((text) => {
          res.writeHead(200, { "Content-Type": registry.contentType });
          res.end(text);
        })
        .catch(() => {
          res.writeHead(500);
          res.end();
        });
      return;
    }
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", uptimeSeconds: Math.round(process.uptime()) }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        logger.warn("metrics", `metrics port ${options.port} already in use — metrics server not started`);
        resolve(-1);
        return;
      }
      reject(error);
    });
    server.listen(options.port, options.host, () => resolve(options.port));
  });

  if (port === -1) {
    server.close();
    return { port: -1, close: async () => undefined };
  }

  logger.info("metrics", `Prometheus metrics available at http://${options.host ?? "localhost"}:${port}/metrics`);

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
