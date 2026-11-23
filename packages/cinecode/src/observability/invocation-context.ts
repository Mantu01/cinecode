export interface InvocationState {
  verbose: boolean;
  noColor: boolean;
  machine: boolean;
  quiet: boolean;
}

let state: InvocationState = { verbose: false, noColor: false, machine: false, quiet: false };

export function setInvocationState(patch: Partial<InvocationState>): void {
  state = { ...state, ...patch };
}

export function resetInvocationState(): void {
  state = { verbose: false, noColor: false, machine: false, quiet: false };
}

export function invocationState(): InvocationState {
  return state;
}

export function isVerbose(): boolean {
  return state.verbose || process.env.CINECODE_VERBOSE === "1" || process.env.CINECODE_LOG_LEVEL === "debug";
}

export function colorEnabled(): boolean {
  return !state.noColor && !process.env.NO_COLOR;
}