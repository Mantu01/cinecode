import { createError, ErrorCode, type ErrorLocation } from "../errors/codes.js";
import {
  pendingDegradations,
  pendingWarnings,
  recordWarning,
  resetDiagnostics,
  type Degradation,
  type WarningRecord,
} from "../errors/degradations.js";

export const MACHINE_SCHEMA_VERSION = 1;

export interface ProjectRecord {
  readonly root: string;
  readonly config?: string;
  readonly manifest?: string;
  readonly source?: "root-flag" | "config-flag" | "discovered" | "standalone";
  readonly mode?: "project" | "file";
  readonly selection?: string;
  readonly resolution?: Record<string, unknown>;
}

export interface ArtifactRecord {
  readonly kind: string;
  readonly path: string;
  readonly units?: number;
  readonly unit?: string;
}

export interface MachineErrorRecord {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly location?: ErrorLocation;
  readonly fixHint?: string;
  readonly cause?: string;
  readonly issues?: readonly unknown[];
}

export interface MachineReport {
  readonly schemaVersion: typeof MACHINE_SCHEMA_VERSION;
  readonly command: string;
  readonly ok: boolean;
  readonly degraded: boolean;
  readonly project: ProjectRecord | null;
  readonly result: Record<string, unknown>;
  readonly artifacts: readonly ArtifactRecord[];
  readonly warnings: readonly WarningRecord[];
  readonly degradations: readonly Degradation[];
  readonly timing: { readonly startedAt: string; readonly durationMs: number };
  readonly error?: MachineErrorRecord;
}

export class RunReport {
  private command = "cinecode";
  private startedAt = new Date();
  private projectRecord: ProjectRecord | null = null;
  private resolutionRecord: Record<string, unknown> | undefined;
  private resultPayload: Record<string, unknown> = {};
  private artifacts: ArtifactRecord[] = [];
  private expectedArtifacts = 0;
  private expectedArtifactKinds: string[] = [];
  private machine = false;

  start(command: string, machine = false): void {
    resetDiagnostics();
    this.command = command;
    this.startedAt = new Date();
    this.projectRecord = null;
    this.resolutionRecord = undefined;
    this.resultPayload = {};
    this.artifacts = [];
    this.expectedArtifacts = 0;
    this.expectedArtifactKinds = [];
    this.machine = machine;
  }

  setMachine(machine: boolean): void {
    this.machine = machine;
  }

  isMachine(): boolean {
    return this.machine;
  }

  getCommand(): string {
    return this.command;
  }

  setProject(project: ProjectRecord): void {
    this.projectRecord = project;
  }

  project(): ProjectRecord | null {
    return this.projectRecord;
  }

  /** Mode, root, manifest and selection resolved once for this invocation. */
  resolution(record: Record<string, unknown> | undefined): void {
    this.resolutionRecord = record;
  }

  private projectOutput(): ProjectRecord | null {
    if (!this.projectRecord) return null;
    return this.resolutionRecord
      ? { ...this.projectRecord, resolution: this.resolutionRecord }
      : this.projectRecord;
  }

  result(payload: Record<string, unknown>): void {
    this.resultPayload = { ...this.resultPayload, ...payload };
  }

  warn(code: string, message: string, input?: string): void {
    recordWarning({ code, message, input });
  }

  expectArtifact(kind: string): void {
    this.expectedArtifacts += 1;
    this.expectedArtifactKinds.push(kind);
  }

  artifact(artifact: ArtifactRecord): void {
    this.artifacts.push(artifact);
  }

  artifactCount(): number {
    return this.artifacts.length;
  }

  artifactList(): readonly ArtifactRecord[] {
    return this.artifacts;
  }

  finish(): MachineReport {
    if (this.expectedArtifacts > this.artifacts.length) {
      throw createError(
        ErrorCode.CC4004,
        { path: this.expectedArtifactKinds.at(-1) ?? "output" },
        { fixHint: "The command requested an artifact but produced none. Rerun with --verbose for the encoder diagnostics." },
      );
    }
    const degradations = pendingDegradations();
    const warnings = pendingWarnings();
    return {
      schemaVersion: MACHINE_SCHEMA_VERSION,
      command: this.command,
      ok: true,
      degraded: degradations.length > 0,
      project: this.projectOutput(),
      result: this.resultPayload,
      artifacts: [...this.artifacts],
      warnings: [...warnings],
      degradations: [...degradations],
      timing: { startedAt: this.startedAt.toISOString(), durationMs: Date.now() - this.startedAt.getTime() },
    };
  }

  errorReport(error: MachineErrorRecord): MachineReport {
    const degradations = pendingDegradations();
    const warnings = pendingWarnings();
    return {
      schemaVersion: MACHINE_SCHEMA_VERSION,
      command: this.command,
      ok: false,
      degraded: degradations.length > 0,
      project: this.projectOutput(),
      result: this.resultPayload,
      artifacts: [...this.artifacts],
      warnings: [...warnings],
      degradations,
      timing: { startedAt: this.startedAt.toISOString(), durationMs: Date.now() - this.startedAt.getTime() },
      error,
    };
  }

  degradationSummary(): string {
    const degradations = pendingDegradations();
    if (degradations.length === 0) return "";
    return [`⚠ Run degraded: ${degradations.length} item(s)`, ...degradations.map((item) => `  [${item.code}] ${item.what}: ${item.instead}`)].join("\n");
  }

  summary(report: MachineReport): string {
    const lines: string[] = [];
    if (report.artifacts.length === 0) {
      lines.push(`${report.ok ? "✔" : "✗"} ${report.command}: no artifacts produced`);
    } else {
      lines.push(`✔ ${report.command}: ${report.artifacts.length} artifact(s)`);
      for (const artifact of report.artifacts) {
        const units = artifact.units === undefined ? "" : ` (${artifact.units} ${artifact.unit ?? "unit"})`;
        lines.push(`  ${artifact.kind}: ${artifact.path}${units}`);
      }
    }
    if (report.degraded) {
      lines.push(`⚠ Run degraded: ${report.degradations.length} item(s)`);
      for (const degradation of report.degradations) {
        lines.push(`  [${degradation.code}] ${degradation.what}: ${degradation.instead}`);
      }
    }
    return lines.join("\n");
  }
}

export const runReport = new RunReport();

export function validateMachineReport(value: unknown): string[] {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["report must be an object"];
  }
  const report = value as Record<string, unknown>;
  if (report.schemaVersion !== MACHINE_SCHEMA_VERSION) problems.push("schemaVersion must be 1");
  if (typeof report.command !== "string" || report.command.length === 0) problems.push("command must be a non-empty string");
  if (typeof report.ok !== "boolean") problems.push("ok must be boolean");
  if (typeof report.degraded !== "boolean") problems.push("degraded must be boolean");
  if (report.project !== null && (typeof report.project !== "object" || report.project === null)) problems.push("project must be an object or null");
  if (typeof report.result !== "object" || report.result === null || Array.isArray(report.result)) problems.push("result must be an object");
  for (const key of ["artifacts", "warnings", "degradations"] as const) {
    if (!Array.isArray(report[key])) problems.push(`${key} must be an array`);
  }
  const timing = report.timing as Record<string, unknown> | undefined;
  if (!timing || typeof timing.startedAt !== "string" || typeof timing.durationMs !== "number") problems.push("timing must carry startedAt and durationMs");
  if (report.ok === false) {
    const error = report.error as Record<string, unknown> | undefined;
    if (!error || typeof error.code !== "string" || typeof error.message !== "string") problems.push("failed report must carry error.code and error.message");
  }
  return problems;
}
