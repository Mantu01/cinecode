export class UsageError extends Error {
  readonly code = "CLI_USAGE";

  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function assertExclusive(flags: ReadonlyArray<readonly [string, boolean]>): void {
  const given = flags.filter(([, present]) => present).map(([flag]) => flag);
  if (given.length < 2) return;
  throw new UsageError(`Conflicting flags: ${given.join(" and ")} cannot be used together.`);
}

const ALPHA_CODECS: Readonly<Record<string, string>> = {
  "webm-alpha": "vp9",
  "prores-alpha": "prores",
};

/** Alpha containers only carry the codec that supports an alpha channel. */
export function assertAlphaFormat(format: string | undefined, codec: string | undefined): void {
  const required = format ? ALPHA_CODECS[format] : undefined;
  if (required === undefined) return;
  if (codec === undefined) throw new UsageError(`--format ${format} requires --codec ${required}.`);
  if (codec !== required) {
    throw new UsageError(`Conflicting flags: --format ${format} cannot be used with --codec ${codec}; use --codec ${required}.`);
  }
}
