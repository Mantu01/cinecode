#!/usr/bin/env node
import { guardRuntime } from "./shared/runtime-guard.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCli } from "./program.js";
import { RUNTIME_EXIT_CODE } from "./shared/exit-codes.js";

export { createProgram, runCli, type RunCliOptions } from "./program.js";
export { MACHINE_SCHEMA_VERSION, runReport, validateMachineReport, type MachineReport } from "./output/run-report.js";
export { EXIT_CODES, EXIT_CODE_MEANINGS, exitCodeForError, ExitSignal } from "./shared/exit-codes.js";

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  try {
    guardRuntime();
  } catch (error) {
    if (error && error instanceof Error && error.name === "UnsupportedRuntimeError") {
      process.stderr.write(`${error.message}\n`);
      process.exit(RUNTIME_EXIT_CODE);
    }
    throw error;
  }
  const code = await runCli(process.argv);
  process.exit(code);
}

