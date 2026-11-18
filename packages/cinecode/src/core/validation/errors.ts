export type Severity = "error" | "warning";

export interface SourcePosition {
  file: string;
  line: number;
  column: number;
}

export interface ValidationIssue {
  code: string;
  message: string;
  severity: Severity;
  hint?: string;
  position?: SourcePosition;
  clipName?: string;
  trackName?: string;
  timecode?: string;
}

export const AUTHORING_CODES = {
  overlappingClips: "CC3001",
  invalidDuration: "CC3002",
  outsideComposition: "CC3003",
  invalidKeyframes: "CC3004",
  nonDeterministicApi: "CC3005",
  missingGlyph: "CC3006",
  invalidComposition: "CC3007",
  timelineOvershoot: "CC1004",
} as const;

export type AuthoringCode = (typeof AUTHORING_CODES)[keyof typeof AUTHORING_CODES];

export class CinecodeError extends Error {
  readonly code: string;
  readonly issue: ValidationIssue;

  constructor(issue: ValidationIssue) {
    super(`[${issue.code}] ${issue.message}`);
    this.name = "CinecodeError";
    this.code = issue.code;
    this.issue = issue;
  }
}

export function authoringIssue(
  code: AuthoringCode,
  message: string,
  extra: Partial<Omit<ValidationIssue, "code" | "message" | "severity">> = {},
): ValidationIssue {
  return { code, message, severity: "error", ...extra };
}
