import { assertSupportedRuntime, runtimeVersion } from "../loader/runtime.js";
import { RUNTIME_EXIT_CODE } from "./exit-codes.js";

try {
  assertSupportedRuntime(runtimeVersion());
} catch (error) {
  if (error && error instanceof Error && error.name === "UnsupportedRuntimeError") {
    process.stderr.write(`${error.message}\n`);
    process.exit(RUNTIME_EXIT_CODE);
  }
  throw error;
}
