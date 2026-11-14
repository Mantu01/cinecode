export type OutputMode = "text" | "json" | "ndjson";

export interface ProgressEventPayload {
  frame: number;
  total: number;
  fps?: number;
  etaSeconds?: number;
  percent?: number;
}

export interface WarningEventPayload {
  code: string;
  message: string;
  frame?: number;
}

export interface CompleteEventPayload {
  outputPath?: string;
  renderTimeMs?: number;
  fileSizeBytes?: number;
  [key: string]: unknown;
}

export class OutputFormatter {
  private mode: OutputMode = "text";

  constructor(mode: OutputMode = "text") {
    this.mode = mode;
  }

  public setMode(mode: OutputMode): void {
    this.mode = mode;
  }

  public getMode(): OutputMode {
    return this.mode;
  }

  public isJson(): boolean {
    return this.mode === "json" || this.mode === "ndjson";
  }

  public emitProgress(data: ProgressEventPayload): void {
    if (this.mode === "ndjson") {
      process.stdout.write(`${JSON.stringify({ type: "progress", ...data })}\n`);
    } else if (this.mode === "text") {
      const pct = data.percent !== undefined ? data.percent : Math.round((data.frame / (data.total || 1)) * 100);
      const fpsStr = data.fps !== undefined ? ` | ${data.fps.toFixed(1)} fps` : "";
      const etaStr = data.etaSeconds !== undefined ? ` | ETA: ${data.etaSeconds.toFixed(1)}s` : "";
      process.stdout.write(`\rRender: ${data.frame}/${data.total} (${pct}%)${fpsStr}${etaStr}`);
    }
  }

  public emitWarning(data: WarningEventPayload): void {
    if (this.mode === "ndjson") {
      process.stdout.write(`${JSON.stringify({ type: "warning", ...data })}\n`);
    } else if (this.mode === "text") {
      console.warn(`[WARN ${data.code}] ${data.message}${data.frame !== undefined ? ` (frame ${data.frame})` : ""}`);
    }
  }

  public emitComplete(data: CompleteEventPayload): void {
    if (this.mode === "ndjson") {
      process.stdout.write(`${JSON.stringify({ type: "complete", ...data })}\n`);
    } else if (this.mode === "json") {
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    } else {
      if (data.outputPath) console.log(`\n✔ Render complete: ${data.outputPath}`);
      if (data.renderTimeMs !== undefined) console.log(`  Duration: ${(data.renderTimeMs / 1000).toFixed(2)}s`);
      if (data.fileSizeBytes !== undefined) console.log(`  Size: ${(data.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`);
    }
  }

  public emitData(data: unknown): void {
    if (this.mode === "json") {
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    } else if (this.mode === "ndjson") {
      process.stdout.write(`${JSON.stringify(data)}\n`);
    }
  }
}

export const defaultFormatter = new OutputFormatter("text");
