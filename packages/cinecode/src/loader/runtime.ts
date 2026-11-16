export const MIN_NODE_VERSION = "22.18.0";

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
  return version.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
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
    `[CINECODE_RUNTIME_UNSUPPORTED] Node.js ${check.version} is not supported.`,
    `required: ${check.minimum}`,
    `actual:   ${check.version}`,
    `authoring: ${check.authoringContract} (${check.loaderMode})`,
    `Install Node.js ${MIN_NODE_VERSION} or newer: https://nodejs.org/en/download`,
  ].join("\n");
}

export function assertSupportedRuntime(version: string = process.version): RuntimeCheck {
  const check = checkRuntime(version);
  if (!check.supported) throw new Error(formatUnsupportedRuntime(check));
  return check;
}
