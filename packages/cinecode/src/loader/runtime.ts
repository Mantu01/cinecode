export const MIN_NODE_VERSION = "22.18.0";

export const RUNTIME_UNSUPPORTED = "CINECODE_RUNTIME_UNSUPPORTED";

export const AUTHORING_CONTRACT = "erasable TypeScript syntax only";

export type LoaderMode = "native-type-stripping";

export interface RuntimeCheck {
  readonly version: string;
  readonly minimum: string;
  readonly supported: boolean;
  readonly loaderMode: LoaderMode;
  readonly authoringContract: string;
}

function parse(version: string): number[] {
  return version
    .replace(/^v/, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function checkRuntime(version: string = process.version): RuntimeCheck {
  const actual = parse(version);
  const minimum = parse(MIN_NODE_VERSION);
  let supported = true;
  for (let index = 0; index < 3; index += 1) {
    if ((actual[index] ?? 0) > (minimum[index] ?? 0)) break;
    if ((actual[index] ?? 0) < (minimum[index] ?? 0)) {
      supported = false;
      break;
    }
  }
  return {
    version,
    minimum: `>=${MIN_NODE_VERSION}`,
    supported,
    loaderMode: "native-type-stripping",
    authoringContract: AUTHORING_CONTRACT,
  };
}

export function formatUnsupportedRuntime(check: RuntimeCheck): string {
  return [
    `[${RUNTIME_UNSUPPORTED}] Node.js ${check.version} is not supported.`,
    `required: ${check.minimum}`,
    `actual:   ${check.version}`,
    `authoring: ${check.authoringContract} (${check.loaderMode})`,
    `Install Node.js ${MIN_NODE_VERSION} or newer: https://nodejs.org/en/download`,
  ].join("\n");
}

export class UnsupportedRuntimeError extends Error {
  readonly code = RUNTIME_UNSUPPORTED;
  readonly runtime: RuntimeCheck;

  constructor(check: RuntimeCheck) {
    super(formatUnsupportedRuntime(check));
    this.name = "UnsupportedRuntimeError";
    this.runtime = check;
  }
}

export function runtimeVersion(): string {
  const override = process.env.CINECODE_TEST_NODE_VERSION;
  if (process.env.NODE_ENV === "test" && override) {
    try {
      return override;
    } finally {
      // keep this branch testable under node --test
    }
  }
  return process.version;
}

export function assertSupportedRuntime(version: string = runtimeVersion()): RuntimeCheck {
  const check = checkRuntime(version);
  if (!check.supported) throw new UnsupportedRuntimeError(check);
  return check;
}
