import { Command } from "commander";
import { CanvasServer } from "../canvas-interact/server.js";

export interface CanvasCommandOptions {
  readonly port?: number;
  readonly width?: number;
  readonly height?: number;
  readonly historyDepth?: number;
}

export async function canvasServeCommand(options: CanvasCommandOptions = {}): Promise<void> {
  const port = options.port ?? 3001;
  const server = new CanvasServer({
    port,
    defaultWidth: options.width ?? 1920,
    defaultHeight: options.height ?? 1080,
    historyDepth: options.historyDepth,
  });

  const httpServer = server.createHttpServer();
  httpServer.listen(port, () => {
    console.log(`Canvas server running at http://localhost:${port}`);
    console.log(`WebSocket endpoint: ws://localhost:${port}/canvas`);
    console.log(`Health check: http://localhost:${port}/health`);
  });

  process.on("SIGINT", () => {
    console.log("\nShutting down canvas server...");
    httpServer.close(() => process.exit(0));
  });
}

export function createCanvasCommand() {
  const cmd = new Command("canvas")
    .description("Interactive canvas tools");

  cmd
    .command("serve")
    .description("Start the interactive canvas server")
    .option("--port <n>", "Port to listen on", "3001")
    .option("--width <n>", "Default canvas width", "1920")
    .option("--height <n>", "Default canvas height", "1080")
    .option("--history-depth <n>", "Maximum undo snapshots", "50")
    .action(async (opts: { port: string; width: string; height: string; historyDepth: string }) => {
      await canvasServeCommand({
        port: parseInt(opts.port, 10),
        width: parseInt(opts.width, 10),
        height: parseInt(opts.height, 10),
        historyDepth: parseInt(opts.historyDepth, 10),
      });
    });

  return cmd;
}
