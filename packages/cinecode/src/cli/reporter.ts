import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createError, ErrorCode, type CinecodeError } from "../errors/codes.js";
import {
  pendingDegradations,
  pendingWarnings,
  recordDegradation,
  recordWarning,
  resetDiagnostics,
  type Degradation,
  type WarningRecord,
} from "../errors/degradations.js";
import { MACHINE_SCHEMA_VERSION } from "../contracts.js";
import { getInstrumentationCounters } from "../media/instrumentation.js";
import type { CommandOutcome } from "./command-registry.js";
import { findCommand } from "./command-registry.js";

export interface CommandDescriptor {
  readonly name: string;
  readonly outcome: CommandOutcome;
  readonly network: boolean;
  readonly destructive: boolean;
}

export interface ProjectRecord {
  readonly root: string;
  readonly config?: string;
  readonly manifest?: string;
  readonly source?: "root-flag" | "config-flag" | "discovered" | "standalone";
  readonly mode?: "project" | "file";
  readonly selection?: string;
  readonly resolution?: Record<string, unknown>;
}

export interface TargetSummary {
  readonly id: string;
  readonly kind: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: number;
}

export interface ArtifactRecord {
  readonly kind: string;
  readonly path: string;
  readonly units?: number;
  readonly unit?: string;
  readonly expectedExtension?: string;
  sha256?: string;
}

export interface MachineErrorRecord {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly location?: unknown;
  readonly fixHint?: string;
  readonly cause?: string;
  readonly issues?: readonly unknown[];
}

export interface ProgressEvent {
  readonly phase?: string;
  readonly current: number;
  readonly total: number;
  readonly percent?: number;
  readonly unit?: string;
  readonly message?: string;
  readonly targetId?: string;
}

export interface ResourceUsageRecord {
  readonly memoryRssMb?: number;
  readonly cpuPercent?: number;
  readonly wallClockMs?: number;
  readonly processSpawns?: number;
  readonly framesDecoded?: number;
  readonly framesFromCache?: number;
  readonly bytesTransferred?: number;
}

export interface MachineEnvelope {
  readonly schemaVersion: typeof MACHINE_SCHEMA_VERSION;
  readonly command: string;
  readonly ok: boolean;
  readonly exitCode: number;
  readonly timing: {
    readonly startedAt: string;
    readonly durationMs: number;
  };
  readonly project: ProjectRecord | null;
  readonly selection: readonly TargetSummary[] | null;
  readonly result: Record<string, unknown>;
  readonly artifacts: readonly ArtifactRecord[];
  readonly warnings: readonly WarningRecord[];
  readonly degradations: readonly Degradation[];
  readonly issues: readonly unknown[];
  readonly resourceUsage: ResourceUsageRecord | null;
  readonly explain: unknown | null;
  readonly degraded: boolean;
  readonly descriptor?: CommandDescriptor | null;
  readonly error?: MachineErrorRecord;
}

export function verifyArtifact(
  artifact: ArtifactRecord,
  options?: { readonly checksum?: boolean; readonly expectedExtension?: string },
): void {
  const resolvedPath = path.resolve(artifact.path);
  if (!existsSync(resolvedPath)) {
    throw createError(ErrorCode.CC4004, {
      path: artifact.path,
      reason: `Artifact file does not exist on disk: ${artifact.path}`,
    });
  }

  const stat = statSync(resolvedPath);
  if (stat.isDirectory()) {
    if (artifact.kind === "sequence") {
      const files = readdirSync(resolvedPath);
      if (files.length === 0) {
        throw createError(ErrorCode.CC4004, {
          path: artifact.path,
          reason: `Artifact sequence directory is empty (0 frames): ${artifact.path}`,
        });
      }
      if (artifact.units !== undefined && files.length !== artifact.units) {
        throw createError(ErrorCode.CC4004, {
          path: artifact.path,
          reason: `Artifact sequence directory frame count mismatch: expected ${artifact.units} frames, found ${files.length}`,
        });
      }
    }
  } else if (stat.size === 0) {
    throw createError(ErrorCode.CC4004, {
      path: artifact.path,
      reason: `Artifact file is empty (0 bytes): ${artifact.path}`,
    });
  }

  const expectedExt = artifact.expectedExtension ?? options?.expectedExtension;
  if (expectedExt && !stat.isDirectory()) {
    const ext = path.extname(resolvedPath).toLowerCase();
    const cleanExpected = expectedExt.startsWith(".") ? expectedExt.toLowerCase() : `.${expectedExt.toLowerCase()}`;
    if (ext !== cleanExpected) {
      throw createError(ErrorCode.CC4004, {
        path: artifact.path,
        reason: `Artifact extension mismatch: expected ${cleanExpected}, got ${ext}`,
      });
    }
  }

  if (options?.checksum === true) {
    try {
      const buffer = readFileSync(resolvedPath);
      artifact.sha256 = createHash("sha256").update(buffer).digest("hex");
    } catch (err) {
      throw createError(ErrorCode.CC4004, {
        path: artifact.path,
        reason: `Failed to compute artifact checksum: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
}

export function validateCommandResult(commandName: string, result: Record<string, unknown>): void {
  const spec = findCommand(commandName);
  if (!spec || !spec.machineResult || !spec.machineResult.properties) return;
  const allowed = new Set([
    ...Object.keys(spec.machineResult.properties),
    "explain",
    "dryRun",
    "command",
    "targets",
    "roots",
  ]);
  for (const key of Object.keys(result)) {
    if (!allowed.has(key)) {
      throw createError(ErrorCode.CC9002, {
        reason: `Result key '${key}' is not declared in machineResult schema for command '${commandName}'`,
      });
    }
  }
}

export function serializeEnvelope(doc: MachineEnvelope): string {
  validateCommandResult(doc.command, doc.result);

  // Exact stable key order: schemaVersion, command, ok, exitCode, timing, project, selection, result, artifacts, warnings, degradations, issues, resourceUsage, explain
  const envelope: Record<string, unknown> = {
    schemaVersion: doc.schemaVersion,
    command: doc.command,
    ok: doc.ok,
    exitCode: doc.exitCode ?? (doc.ok ? 0 : 1),
    timing: doc.timing,
    project: doc.project ?? null,
    selection: doc.selection ?? null,
    result: doc.result ?? {},
    artifacts: doc.artifacts ?? [],
    warnings: doc.warnings ?? [],
    degradations: doc.degradations ?? [],
    issues: doc.issues ?? (doc.error ? [doc.error] : []),
    resourceUsage: doc.resourceUsage ?? null,
    explain: doc.explain ?? null,
    degraded: doc.degraded ?? false,
  };

  if (doc.descriptor !== undefined) envelope.descriptor = doc.descriptor;
  if (doc.error !== undefined) envelope.error = doc.error;

  return JSON.stringify(envelope, null, 2);
}

export interface ReporterOptions {
  readonly machine?: boolean;
  readonly quiet?: boolean;
  readonly verbose?: boolean;
  readonly noColor?: boolean;
  readonly stdoutWrite?: (text: string) => void;
  readonly stderrWrite?: (text: string) => void;
}

export class Reporter {
  private command = "cinecode";
  private startedAt = new Date();
  private machine = false;
  private quiet = false;
  private verbose = false;
  private noColor = false;
  private stdoutWrite: (text: string) => void;
  private stderrWrite: (text: string) => void;
  private documentsWritten = 0;

  private projectRecord: ProjectRecord | null = null;
  private selectionTargets: TargetSummary[] | null = null;
  private resultPayload: Record<string, unknown> = {};
  private artifacts: ArtifactRecord[] = [];
  private expectedArtifacts = 0;
  private expectedArtifactKinds: string[] = [];
  private warnings: WarningRecord[] = [];
  private degradations: Degradation[] = [];
  private issues: unknown[] = [];
  private resourceUsage: ResourceUsageRecord | null = null;
  private explainTree: unknown | null = null;
  private descriptorRecord: CommandDescriptor | null = null;
  private informationalNote?: string;
  private cacheDirRecord?: string;
  private progressEvents: ProgressEvent[] = [];
  private lastReportedDecade = -1;

  constructor(options: ReporterOptions = {}) {
    this.machine = options.machine ?? false;
    this.quiet = options.quiet ?? false;
    this.verbose = options.verbose ?? false;
    this.noColor = options.noColor ?? false;
    this.stdoutWrite = options.stdoutWrite ?? ((text: string) => void process.stdout.write(text));
    this.stderrWrite = options.stderrWrite ?? ((text: string) => void process.stderr.write(text));
  }

  reset(): void {
    resetDiagnostics();
    this.startedAt = new Date();
    this.projectRecord = null;
    this.selectionTargets = null;
    this.resultPayload = {};
    this.artifacts = [];
    this.expectedArtifacts = 0;
    this.expectedArtifactKinds = [];
    this.warnings = [];
    this.degradations = [];
    this.issues = [];
    this.resourceUsage = null;
    this.explainTree = null;
    this.descriptorRecord = null;
    this.informationalNote = undefined;
    this.progressEvents = [];
    this.lastReportedDecade = -1;
    this.documentsWritten = 0;
  }

  start(command: string, machine = false): void {
    this.command = command;
    this.machine = machine;
    this.startedAt = new Date();
  }

  relabel(command: string): void {
    this.command = command;
  }

  setMachine(machine: boolean): void {
    this.machine = machine;
  }

  isMachine(): boolean {
    return this.machine;
  }

  setResourceUsage(usage: Partial<ResourceUsageRecord>): void {
    this.resourceUsage = { ...this.resourceUsage, ...usage };
  }

  setQuiet(quiet: boolean): void {
    this.quiet = quiet;
  }

  isQuiet(): boolean {
    return this.quiet;
  }

  describe(spec: CommandDescriptor): void {
    this.descriptorRecord = { ...spec };
  }

  descriptor(): CommandDescriptor | null {
    return this.descriptorRecord;
  }

  setExplain(explain: unknown): void {
    this.explainTree = explain;
  }

  setCacheDir(dir: string): void {
    this.cacheDirRecord = dir;
  }

  cacheDir(): string | undefined {
    return this.cacheDirRecord;
  }

  setProject(project: ProjectRecord): void {
    this.projectRecord = project;
  }

  project(): ProjectRecord | null {
    return this.projectRecord;
  }

  setSelection(targets: readonly TargetSummary[]): void {
    this.selectionTargets = [...targets];
  }

  resolution(record: Record<string, unknown> | undefined): void {
    if (this.projectRecord && record) {
      this.projectRecord = { ...this.projectRecord, resolution: record };
    }
  }

  note(message: string): void {
    this.informationalNote = message;
  }

  writeRawStdout(text: string): void {
    this.stdoutWrite(text);
  }

  // --- Channel 1: Result ---
  result(payload: Record<string, unknown>): void {
    this.resultPayload = { ...this.resultPayload, ...payload };
  }

  // --- Channel 2: Progress (stderr only) ---
  progress(event: ProgressEvent): void {
    this.progressEvents.push(event);
    if (this.quiet) return;

    const pct =
      event.percent !== undefined
        ? event.percent
        : Math.min(100, Math.max(0, Math.round((event.current / (event.total || 1)) * 100)));
    const phase = event.phase ? `[${event.phase}] ` : "";
    const unit = event.unit ? ` ${event.unit}` : "";
    const msg = event.message ? ` - ${event.message}` : "";
    const line = `${phase}${event.current}/${event.total}${unit} (${pct}%)${msg}`;

    if (process.stderr.isTTY) {
      this.stderrWrite(`\r${line}`);
    } else {
      const decade = Math.floor(pct / 10);
      if (decade !== this.lastReportedDecade) {
        this.lastReportedDecade = decade;
        this.stderrWrite(`${line}\n`);
      }
    }
  }

  // --- Channel 3: Diagnostics (stderr only) ---
  diagnostic(message: string): void {
    this.stderrWrite(`${message}\n`);
  }

  warn(code: string, message: string, input?: string): void {
    const record: WarningRecord = { code, message, input };
    this.warnings.push(record);
    recordWarning(record);
    if (!this.machine) {
      this.stderrWrite(`\u26A0 [${code}] ${message}\n`);
    }
  }

  degrade(degradation: Partial<Degradation> & { code: string; reason: string }): void {
    const fullDegradation: Degradation = {
      code: degradation.code,
      what: degradation.what ?? (degradation.field ? `${degradation.field}` : "degradation"),
      field: degradation.field,
      requested: degradation.requested,
      actual: degradation.actual,
      reason: degradation.reason,
      input: degradation.input,
      instead: degradation.instead ?? degradation.reason,
    };
    this.degradations.push(fullDegradation);
    recordDegradation(fullDegradation);
    if (!this.machine) {
      const fieldDesc = fullDegradation.field
        ? `${fullDegradation.field}: requested ${JSON.stringify(fullDegradation.requested)}, got ${JSON.stringify(fullDegradation.actual)}`
        : fullDegradation.what;
      this.stderrWrite(`\u26A0 Run degraded: [${fullDegradation.code}] ${fieldDesc} (${fullDegradation.reason})\n`);
    }
  }

  expectArtifact(kind: string): void {
    this.expectedArtifacts += 1;
    this.expectedArtifactKinds.push(kind);
  }

  artifact(artifact: ArtifactRecord, options?: { readonly checksum?: boolean }): void {
    verifyArtifact(artifact, options);
    this.artifacts.push(artifact);
  }

  artifactCount(): number {
    return this.artifacts.length;
  }

  artifactList(): readonly ArtifactRecord[] {
    return this.artifacts;
  }

  degradationSummary(): string {
    const degs = pendingDegradations();
    if (degs.length === 0) return "";
    return [
      `\u26A0 Run degraded: ${degs.length} item(s)`,
      ...degs.map((item) => `  [${item.code}] ${item.what ?? item.field}: ${item.instead ?? item.reason}`),
    ].join("\n");
  }

  finish(exitCode = 0): MachineEnvelope {
    if (this.expectedArtifacts > this.artifacts.length) {
      throw createError(
        ErrorCode.CC4004,
        { path: this.expectedArtifactKinds.at(-1) ?? "output" },
        { fixHint: "The command requested an artifact but produced none. Rerun with --verbose for the encoder diagnostics." },
      );
    }

    // Verify all recorded artifacts on disk
    for (const art of this.artifacts) {
      verifyArtifact(art);
    }

    const allDegradations = [...pendingDegradations(), ...this.degradations];
    const uniqueDegradations = allDegradations.filter(
      (deg, idx, arr) => arr.findIndex((d) => d.code === deg.code && d.reason === deg.reason) === idx,
    );

    const allWarnings = [...pendingWarnings(), ...this.warnings];
    const uniqueWarnings = allWarnings.filter(
      (w, idx, arr) => arr.findIndex((item) => item.code === w.code && item.message === w.message) === idx,
    );

    const counters = getInstrumentationCounters();
    const effectiveResourceUsage: ResourceUsageRecord = {
      memoryRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      wallClockMs: Date.now() - this.startedAt.getTime(),
      processSpawns: (this.resourceUsage?.processSpawns ?? 0) + counters.processSpawns,
      framesDecoded: (this.resourceUsage?.framesDecoded ?? 0) + counters.framesDecoded,
      framesFromCache: (this.resourceUsage?.framesFromCache ?? 0) + counters.framesFromCache,
      bytesTransferred: (this.resourceUsage?.bytesTransferred ?? 0) + counters.bytesTransferred,
      ...this.resourceUsage,
    };

    return {
      schemaVersion: MACHINE_SCHEMA_VERSION,
      command: this.command,
      ok: true,
      exitCode,
      degraded: uniqueDegradations.length > 0,
      timing: {
        startedAt: this.startedAt.toISOString(),
        durationMs: Date.now() - this.startedAt.getTime(),
      },
      project: this.projectRecord,
      selection: this.selectionTargets,
      result: this.resultPayload,
      artifacts: [...this.artifacts],
      warnings: uniqueWarnings,
      degradations: uniqueDegradations,
      issues: this.issues,
      resourceUsage: effectiveResourceUsage,
      explain: this.explainTree,
      descriptor: this.descriptorRecord,
    };
  }

  errorReport(error: MachineErrorRecord, exitCode = 1): MachineEnvelope {
    const allDegradations = [...pendingDegradations(), ...this.degradations];
    const allWarnings = [...pendingWarnings(), ...this.warnings];
    const issues = error.issues && error.issues.length > 0 ? error.issues : [error];

    const counters = getInstrumentationCounters();
    const effectiveResourceUsage: ResourceUsageRecord = {
      memoryRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      wallClockMs: Date.now() - this.startedAt.getTime(),
      processSpawns: (this.resourceUsage?.processSpawns ?? 0) + counters.processSpawns,
      framesDecoded: (this.resourceUsage?.framesDecoded ?? 0) + counters.framesDecoded,
      framesFromCache: (this.resourceUsage?.framesFromCache ?? 0) + counters.framesFromCache,
      bytesTransferred: (this.resourceUsage?.bytesTransferred ?? 0) + counters.bytesTransferred,
      ...this.resourceUsage,
    };

    return {
      schemaVersion: MACHINE_SCHEMA_VERSION,
      command: this.command,
      ok: false,
      exitCode,
      degraded: allDegradations.length > 0,
      timing: {
        startedAt: this.startedAt.toISOString(),
        durationMs: Date.now() - this.startedAt.getTime(),
      },
      project: this.projectRecord,
      selection: this.selectionTargets,
      result: this.resultPayload,
      artifacts: [...this.artifacts],
      warnings: allWarnings,
      degradations: allDegradations,
      issues,
      resourceUsage: effectiveResourceUsage,
      explain: this.explainTree,
      descriptor: this.descriptorRecord,
      error,
    };
  }

  // Fixed shape human summary: 1 header line, 1 line per target, 1 artifact line per file, then warnings
  summary(report: MachineEnvelope): string {
    const lines: string[] = [];
    const outcome = report.descriptor?.outcome;

    // Line 1: Header line
    if (!report.ok) {
      lines.push(`\u2717 ${report.command}: failed (exit code ${report.exitCode})`);
    } else if (report.artifacts.length > 0) {
      lines.push(`\u2714 ${report.command}: ${report.artifacts.length} artifact(s)`);
    } else if (outcome === "report") {
      lines.push(`\u2714 ${report.command}: reported`);
    } else if (this.informationalNote !== undefined) {
      lines.push(`\u2714 ${report.command}: ${this.informationalNote}`);
    } else {
      lines.push(`\u2714 ${report.command}: done`);
    }

    // Next: One line per target
    if (report.selection && report.selection.length > 0) {
      for (const target of report.selection) {
        lines.push(`  target: ${target.id} (${target.kind}, ${target.width}x${target.height} @ ${target.fps}fps, ${target.duration}s)`);
      }
    }

    // Next: One artifact line per file
    for (const art of report.artifacts) {
      const units = art.units !== undefined ? ` (${art.units} ${art.unit ?? "unit"})` : "";
      lines.push(`  ${art.kind}: ${art.path}${units}`);
    }

    // Next: Warnings
    for (const warning of report.warnings) {
      lines.push(`\u26A0 [${warning.code}] ${warning.message}`);
    }

    // Next: Degradations
    if (report.degraded && report.degradations.length > 0) {
      lines.push(`\u26A0 Run degraded: ${report.degradations.length} item(s)`);
      for (const deg of report.degradations) {
        const fieldDesc = deg.field ? `${deg.field}: requested ${JSON.stringify(deg.requested)}, got ${JSON.stringify(deg.actual)}` : deg.what;
        lines.push(`  [${deg.code}] ${fieldDesc}: ${deg.reason ?? deg.instead}`);
      }
    }

    return lines.join("\n");
  }

  writeDocument(report: MachineEnvelope): void {
    if (this.documentsWritten > 0) {
      this.stderrWrite("cinecode: document already emitted; refusing second write\n");
      return;
    }

    if (this.machine) {
      const json = serializeEnvelope(report);
      this.documentsWritten += 1;
      this.stdoutWrite(`${json}\n`);
    } else {
      this.documentsWritten += 1;
      const summaryText = this.summary(report);
      this.stdoutWrite(`\n${summaryText}\n`);
    }
  }
}
