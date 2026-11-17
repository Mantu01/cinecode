import type { ErrorCode } from "./codes.js";

export interface Degradation {
  readonly code: string;
  readonly what: string;
  readonly reason: string;
  readonly input?: string;
  readonly instead: string;
}

export interface WarningRecord {
  readonly code: string;
  readonly message: string;
  readonly input?: string;
}

const degradations: Degradation[] = [];
const warnings: WarningRecord[] = [];

export function recordDegradation(degradation: Degradation): void {
  degradations.push(degradation);
}

export function recordWarning(warning: WarningRecord): void {
  warnings.push(warning);
}

export function pendingDegradations(): readonly Degradation[] {
  return [...degradations];
}

export function pendingWarnings(): readonly WarningRecord[] {
  return [...warnings];
}

export function takeDegradations(): Degradation[] {
  return degradations.splice(0, degradations.length);
}

export function takeWarnings(): WarningRecord[] {
  return warnings.splice(0, warnings.length);
}

export function resetDiagnostics(): void {
  degradations.length = 0;
  warnings.length = 0;
}

export function degradationCode(message: string): string {
  return message.match(/\[?(CC\d{4})\]?/)?.[1] ?? "CC9001";
}

/** Runs `fallback` and records exactly why the primary result was not used. */
export function degrade<T>(
  record: Omit<Degradation, "code"> & { readonly code: string | ErrorCode },
  fallback: T,
): T {
  recordDegradation({ ...record, code: String(record.code) });
  return fallback;
}
