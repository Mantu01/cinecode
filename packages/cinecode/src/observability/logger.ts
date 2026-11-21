import pc from "picocolors";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "text" | "json";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  traceId?: string;
  component: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface LoggerOptions {
  level?: LogLevel;
  format?: LogFormat;
  service?: string;
  traceId?: string;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class StructuredLogger {
  private level: LogLevel;
  private format: LogFormat;
  private service: string;
  private traceId?: string;

  constructor(options: LoggerOptions = {}) {
    const verbose = process.env.CINECODE_VERBOSE === "1" || process.env.CINECODE_LOG_LEVEL === "debug";
    this.level = options.level ?? (process.env.CINECODE_LOG_LEVEL as LogLevel) ?? (verbose ? "debug" : "info");
    this.format = options.format ?? (process.env.CINECODE_LOG_FORMAT as LogFormat) ?? "text";
    this.service = options.service ?? "cinecode";
    this.traceId = options.traceId;
  }

  setFormat(format: LogFormat): void {
    this.format = format;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setTraceId(traceId: string): void {
    this.traceId = traceId;
  }

  debug(component: string, message: string, metadata?: Record<string, unknown>): void {
    this.log("debug", component, message, metadata);
  }

  info(component: string, message: string, metadata?: Record<string, unknown>): void {
    this.log("info", component, message, metadata);
  }

  warn(component: string, message: string, metadata?: Record<string, unknown>): void {
    this.log("warn", component, message, metadata);
  }

  error(component: string, message: string, metadata?: Record<string, unknown>): void {
    this.log("error", component, message, metadata);
  }

  private log(level: LogLevel, component: string, message: string, metadata?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      traceId: this.traceId,
      component,
      message,
      metadata,
    };

    if (this.format === "json") {
      process.stderr.write(JSON.stringify(entry) + "\n");
    } else {
      const time = pc.dim(entry.timestamp.substring(11, 19));
      const comp = pc.cyan(`[${component}]`);
      let lvlStr = pc.blue("INFO");
      if (level === "debug") lvlStr = pc.dim("DEBUG");
      else if (level === "warn") lvlStr = pc.yellow("WARN");
      else if (level === "error") lvlStr = pc.red("ERROR");

      let metaStr = "";
      if (metadata && Object.keys(metadata).length > 0) {
        metaStr = " " + pc.dim(JSON.stringify(metadata));
      }

      process.stderr.write(`${time} ${lvlStr} ${comp} ${message}${metaStr}\n`);
    }
  }
}

export const logger = new StructuredLogger();

export interface StructuredLog {
  ts: string;
  level: LogLevel;
  code?: string;
  message: string;
  durationMs?: number;
}

export function setJsonMode(enabled: boolean): void {
  logger.setFormat(enabled ? "json" : "text");
}

export function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (level === "error") logger.error("cli", message, meta);
  else if (level === "warn") logger.warn("cli", message, meta);
  else if (level === "debug") logger.debug("cli", message, meta);
  else logger.info("cli", message, meta);
}
