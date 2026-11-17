import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCli } from "./program.js";

export { createProgram, runCli, type RunCliOptions } from "./program.js";
export { MACHINE_SCHEMA_VERSION, runReport, validateMachineReport, type MachineReport } from "./run-report.js";
export { EXIT_CODES, EXIT_CODE_MEANINGS, exitCodeForError, ExitSignal } from "./exit-codes.js";

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) process.exitCode = await runCli(process.argv);
