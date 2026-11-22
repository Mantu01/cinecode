import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export {
  MAX_SPOOL_AGE_MS,
  MAX_SPOOL_FILES,
  MAX_SPOOL_TOTAL_BYTES,
  sweepSpools,
  type SpoolSweepResult,
} from "./spool.js";

/** Incidental stdout larger than this is kept in its file and named in the document. */
export const MACHINE_INLINE_LIMIT = 64 * 1024;

/**
 * Spool utility for non-stream captures.
 * Note: stdout monkey-patching has been removed per Phase 08.
 */
export class StdoutCapture {
  private size = 0;
  private file: string | undefined;
  private fd: number | undefined;
  private readonly chunks: string[] = [];

  constructor(private readonly cacheDir: string | (() => string | undefined) = () => undefined) {}

  private spoolDir(): string {
    const configured = typeof this.cacheDir === "string" ? join(this.cacheDir, ".cinecode", "cache") : this.cacheDir();
    return configured ?? join(tmpdir(), "cinecode");
  }

  write(chunk: string): void {
    const buffer = Buffer.from(chunk, "utf8");
    if (this.fd === undefined) {
      try {
        const dir = this.spoolDir();
        mkdirSync(dir, { recursive: true });
        this.file = join(dir, `machine-stdout-${process.pid}-${Date.now()}.log`);
        this.fd = openSync(this.file, "w");
      } catch {
        this.chunks.push(chunk);
        this.size += buffer.length;
        return;
      }
    }
    writeSync(this.fd, buffer);
    this.size += buffer.length;
  }

  bytes(): number {
    return this.size;
  }

  text(): string {
    if (this.fd === undefined) return this.chunks.join("");
    closeSync(this.fd);
    this.fd = undefined;
    return readFileSync(this.file!, "utf8");
  }

  drain(): Record<string, unknown> {
    if (this.size === 0) return {};
    const text = this.text();
    if (this.size <= MACHINE_INLINE_LIMIT) {
      if (this.file !== undefined) rmSync(this.file, { force: true });
      return { output: text, capturedOutput: text };
    }
    return {
      output: `<truncated: captured stdout is ${this.size} bytes, full text at ${this.file}>`,
      capturedOutput: `<truncated: captured stdout is ${this.size} bytes, full text at ${this.file}>`,
      outputFile: this.file,
      outputBytes: this.size,
    };
  }
}
