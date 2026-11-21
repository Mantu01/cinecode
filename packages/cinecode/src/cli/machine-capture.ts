import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Incidental stdout larger than this is kept in its file and named in the document. */
export const MACHINE_INLINE_LIMIT = 64 * 1024;

/**
 * Captures stdout during a machine-mode run. Output is spooled to a file in the
 * project cache, never to an unbounded in-memory buffer: the document carries the
 * text while it fits, otherwise the byte count and the path of the spool file.
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

  /** Raw text, for informational commands that print rather than report. */
  text(): string {
    if (this.fd === undefined) return this.chunks.join("");
    closeSync(this.fd);
    this.fd = undefined;
    return readFileSync(this.file!, "utf8");
  }

  /** Fields for the machine document; empty when nothing was captured. */
  drain(): Record<string, unknown> {
    if (this.size === 0) return {};
    const text = this.text();
    if (this.size <= MACHINE_INLINE_LIMIT) {
      if (this.file !== undefined) rmSync(this.file, { force: true });
      return { capturedOutput: text };
    }
    return {
      capturedOutput: `<truncated: captured stdout is ${this.size} bytes, full text at ${this.file}>`,
      outputFile: this.file,
      outputBytes: this.size,
    };
  }
}
