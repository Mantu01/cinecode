import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export type AuditAction =
  | "RENDER_OVERWRITE"
  | "CACHE_PURGE"
  | "PLUGIN_INSTALL"
  | "PLUGIN_REMOVE"
  | "CONFIG_MUTATION";

export interface AuditEntry {
  timestamp: string;
  actor: string;
  action: AuditAction;
  target: string;
  status: "SUCCESS" | "FAILURE";
  clientIp?: string;
  metadata?: Record<string, unknown>;
  previousHash: string;
  entryHash: string;
}

export class AuditLogger {
  private readonly logPath: string;
  private lastHash = "0000000000000000000000000000000000000000000000000000000000000000";

  constructor(workspaceDir = process.cwd()) {
    const dir = path.resolve(workspaceDir, ".cinecode");
    fs.mkdirSync(dir, { recursive: true });
    this.logPath = path.join(dir, "audit.log");
    this.initLastHash();
  }

  private initLastHash(): void {
    if (fs.existsSync(this.logPath)) {
      const content = fs.readFileSync(this.logPath, "utf8").trim();
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length > 0) {
        try {
          const lastEntry = JSON.parse(lines[lines.length - 1]!) as AuditEntry;
          if (lastEntry.entryHash) {
            this.lastHash = lastEntry.entryHash;
          }
        } catch {
          void 0;
        }
      }
    }
  }

  log(action: AuditAction, target: string, status: "SUCCESS" | "FAILURE" = "SUCCESS", metadata?: Record<string, unknown>, clientIp?: string): AuditEntry {
    const timestamp = new Date().toISOString();
    const actor = process.env.USER || process.env.USERNAME || "system";

    const hashInput = `${timestamp}|${actor}|${action}|${target}|${status}|${this.lastHash}`;
    const entryHash = createHash("sha256").update(hashInput).digest("hex");

    const entry: AuditEntry = {
      timestamp,
      actor,
      action,
      target,
      status,
      clientIp,
      metadata,
      previousHash: this.lastHash,
      entryHash,
    };

    this.lastHash = entryHash;
    fs.appendFileSync(this.logPath, JSON.stringify(entry) + "\n", "utf8");
    return entry;
  }

  verifyChain(): { valid: boolean; totalEntries: number; tamperedIndex?: number } {
    if (!fs.existsSync(this.logPath)) {
      return { valid: true, totalEntries: 0 };
    }

    const lines = fs.readFileSync(this.logPath, "utf8").trim().split("\n").filter((l) => l.trim().length > 0);
    let expectedPrev = "0000000000000000000000000000000000000000000000000000000000000000";

    for (let i = 0; i < lines.length; i++) {
      const entry = JSON.parse(lines[i]!) as AuditEntry;
      if (entry.previousHash !== expectedPrev) {
        return { valid: false, totalEntries: lines.length, tamperedIndex: i };
      }

      const hashInput = `${entry.timestamp}|${entry.actor}|${entry.action}|${entry.target}|${entry.status}|${expectedPrev}`;
      const computed = createHash("sha256").update(hashInput).digest("hex");
      if (computed !== entry.entryHash) {
        return { valid: false, totalEntries: lines.length, tamperedIndex: i };
      }

      expectedPrev = entry.entryHash;
    }

    return { valid: true, totalEntries: lines.length };
  }
}

export const auditLogger = new AuditLogger();
