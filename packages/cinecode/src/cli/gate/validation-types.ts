export type ValidationGate =
  | "runtime"
  | "config"
  | "manifest"
  | "modules"
  | "media"
  | "fonts"
  | "determinism"
  | "capability"
  | "resources";

export type ValidateMode = "all" | "authoring-only" | "media" | "fonts";

export interface ValidationIssue {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly gate: ValidationGate;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly message: string;
  readonly fix?: string;
  readonly fixHint?: string;
}

export interface ProjectContractSummary {
  readonly roots: {
    readonly source: { path: string; exists: boolean; writable: boolean };
    readonly media: { path: string; exists: boolean; writable: boolean };
    readonly output: { path: string; exists: boolean; writable: boolean };
    readonly cache: { path: string; exists: boolean; writable: boolean };
  };
  readonly entry: { path: string; exists: boolean; readable: boolean };
  readonly manifest: { path: string; exists: boolean; readable: boolean };
}

export interface ValidationReport {
  readonly ok: boolean;
  readonly mode: ValidateMode;
  readonly stoppedAtGate?: ValidationGate;
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
  readonly notes: readonly string[];
  readonly contract: ProjectContractSummary;
  readonly categories: Readonly<Record<ValidationGate, { errors: number; warnings: number }>>;
}
