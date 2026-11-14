export interface TelemetryConfig {
  enabled?: boolean;
  endpoint?: string;
  debug?: boolean;
}

export interface TelemetryRecord {
  event: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface TelemetryStatus {
  enabled: boolean;
  endpoint: string;
  bufferedRecordsCount: number;
  recentRecords: TelemetryRecord[];
}

const PATH_REGEX = /(?:[a-zA-Z]:\\|\/)[^\s"']+/g;
const IP_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const EMAIL_REGEX = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g;
const SECRET_REGEX = /(?:key|token|secret|password|auth|apikey|pass)\s*[:=]\s*["']?([^"'\s]+)["']?/gi;

export function scrubPii(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(SECRET_REGEX, "$1: [REDACTED]")
      .replace(EMAIL_REGEX, "[EMAIL]")
      .replace(IP_REGEX, "[IP]")
      .replace(PATH_REGEX, "[PATH]");
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubPii(v));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const lower = k.toLowerCase();
      if (lower.includes("secret") || lower.includes("token") || lower.includes("key") || lower.includes("password")) {
        result[k] = "[REDACTED]";
      } else {
        result[k] = scrubPii(v);
      }
    }
    return result;
  }
  return value;
}

export class TelemetryBroker {
  private static instance?: TelemetryBroker;
  private enabled = false;
  private endpoint = "https://telemetry.cinecode.dev/v1/events";
  private records: TelemetryRecord[] = [];
  private maxBuffered = 100;

  public static getInstance(): TelemetryBroker {
    if (!TelemetryBroker.instance) {
      TelemetryBroker.instance = new TelemetryBroker();
    }
    return TelemetryBroker.instance;
  }

  public configure(config: TelemetryConfig): void {
    if (config.enabled !== undefined) {
      this.enabled = config.enabled;
    }
    if (config.endpoint) {
      this.endpoint = config.endpoint;
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public record(event: string, payload: Record<string, unknown> = {}): boolean {
    if (!this.enabled) return false;

    const sanitized = scrubPii(payload) as Record<string, unknown>;
    const record: TelemetryRecord = {
      event,
      timestamp: Date.now(),
      payload: sanitized,
    };

    this.records.push(record);
    if (this.records.length > this.maxBuffered) {
      this.records.shift();
    }

    return true;
  }

  public getStatus(): TelemetryStatus {
    return {
      enabled: this.enabled,
      endpoint: this.endpoint,
      bufferedRecordsCount: this.records.length,
      recentRecords: [...this.records].slice(-10),
    };
  }

  public clear(): void {
    this.records = [];
  }
}

export const telemetryBroker = TelemetryBroker.getInstance();
