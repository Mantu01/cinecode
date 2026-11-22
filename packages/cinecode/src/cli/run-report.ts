import { recordNote } from "../errors/degradations.js";
import { MACHINE_SCHEMA_VERSION } from "../contracts.js";
import {
  Reporter,
  type ArtifactRecord,
  type CommandDescriptor,
  type MachineEnvelope,
  type MachineErrorRecord,
  type ProjectRecord,
  type ResourceUsageRecord,
  type TargetSummary,
} from "./reporter.js";

export { MACHINE_SCHEMA_VERSION } from "../contracts.js";
export type {
  ArtifactRecord,
  CommandDescriptor,
  MachineErrorRecord,
  ProjectRecord,
  ResourceUsageRecord,
  TargetSummary,
} from "./reporter.js";

export type MachineReport = MachineEnvelope;

export class RunReport {
  private activeReporter: Reporter | undefined = undefined;

  setReporter(reporter: Reporter): void {
    this.activeReporter = reporter;
  }

  getReporter(): Reporter {
    if (!this.activeReporter) {
      this.activeReporter = new Reporter();
    }
    return this.activeReporter;
  }

  reset(): void {
    this.getReporter().reset();
  }

  start(command: string, machine = false): void {
    this.getReporter().start(command, machine);
  }

  relabel(command: string): void {
    this.getReporter().relabel(command);
  }

  describe(spec: CommandDescriptor): void {
    this.getReporter().describe(spec);
  }

  descriptor(): CommandDescriptor | null {
    return this.getReporter().descriptor();
  }

  note(message: string): void {
    recordNote(message);
    this.getReporter().note(message);
  }

  writeRawStdout(text: string): void {
    this.getReporter().writeRawStdout(text);
  }

  setMachine(machine: boolean): void {
    this.getReporter().setMachine(machine);
  }

  isMachine(): boolean {
    return this.getReporter().isMachine();
  }

  setCacheDir(dir: string): void {
    this.getReporter().setCacheDir(dir);
  }

  cacheDir(): string | undefined {
    return this.getReporter().cacheDir();
  }

  setProject(project: ProjectRecord): void {
    this.getReporter().setProject(project);
  }

  project(): ProjectRecord | null {
    return this.getReporter().project();
  }

  resolution(record: Record<string, unknown> | undefined): void {
    this.getReporter().resolution(record);
  }

  explain(explainTree: unknown): void {
    this.getReporter().setExplain(explainTree);
  }

  result(payload: Record<string, unknown>): void {
    this.getReporter().result(payload);
  }

  resourceUsage(usage: Partial<ResourceUsageRecord>): void {
    this.getReporter().setResourceUsage(usage);
  }

  warn(code: string, message: string, input?: string): void {
    this.getReporter().warn(code, message, input);
  }

  expectArtifact(kind: string): void {
    this.getReporter().expectArtifact(kind);
  }

  artifact(artifact: ArtifactRecord, options?: { readonly checksum?: boolean }): void {
    this.getReporter().artifact(artifact, options);
  }

  artifactCount(): number {
    return this.getReporter().artifactCount();
  }

  artifactList(): readonly ArtifactRecord[] {
    return this.getReporter().artifactList();
  }

  finish(exitCode = 0): MachineReport {
    return this.getReporter().finish(exitCode);
  }

  errorReport(error: MachineErrorRecord, exitCode?: number): MachineReport {
    return this.getReporter().errorReport(error, exitCode);
  }

  degradationSummary(): string {
    return this.getReporter().degradationSummary();
  }

  summary(report: MachineReport): string {
    return this.getReporter().summary(report);
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
  const descriptor = report.descriptor as Record<string, unknown> | null | undefined;
  if (descriptor !== null && descriptor !== undefined) {
    if (typeof descriptor.name !== "string" || !["none", "artifact", "report"].includes(String(descriptor.outcome))) {
      problems.push("descriptor must carry a name and a known outcome kind");
    }
    if (typeof descriptor.network !== "boolean" || typeof descriptor.destructive !== "boolean") {
      problems.push("descriptor must carry the network and destructive flags");
    }
  }
  if (report.ok === false) {
    const error = report.error as Record<string, unknown> | undefined;
    if (!error || typeof error.code !== "string" || typeof error.message !== "string") problems.push("failed report must carry error.code and error.message");
    if (report.exitCode !== undefined && typeof report.exitCode !== "number") problems.push("exitCode must be a number");
    if (report.issues !== undefined && !Array.isArray(report.issues)) problems.push("issues must be an array");
  }
  return problems;
}
