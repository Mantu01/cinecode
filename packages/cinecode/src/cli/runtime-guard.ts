import { assertSupportedRuntime, runtimeVersion } from "../loader/runtime.js";

export function guardRuntime(): void {
  assertSupportedRuntime(runtimeVersion());
}

