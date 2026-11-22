import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const distProgram = path.join(cinecodeDir, "dist", "esm", "cli", "program.js");
const distRegistry = path.join(cinecodeDir, "dist", "esm", "cli", "command-registry.js");

if (!existsSync(distProgram) || !existsSync(distRegistry)) {
  execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
    cwd: cinecodeDir,
    stdio: "inherit",
  });
}

const { runCli } = await import(pathToFileURL(distProgram).href);
const { COMMANDS, findCommand } = await import(pathToFileURL(distRegistry).href);

let errors = 0;
function fail(msg) {
  console.error(`check-surface error: ${msg}`);
  errors++;
}

// 1. Verify every command `--help` includes Contract: Reads and Writes
for (const spec of COMMANDS) {
  let stdoutCaptured = "";
  let stderrCaptured = "";
  try {
    await runCli(["node", "cinecode", spec.name, "--help"], {
      stdout: (t) => { stdoutCaptured += t; },
      stderr: (t) => { stderrCaptured += t; },
    });
  } catch (err) {
    fail(`Command '${spec.name} --help' threw: ${err}`);
    continue;
  }

  if (!stdoutCaptured.includes("Contract:") || !stdoutCaptured.includes("Reads:") || !stdoutCaptured.includes("Writes:")) {
    fail(`Command '${spec.name} --help' missing Contract Reads/Writes footer in stdout`);
  }
}

// 2. Verify all 8 forwarding aliases resolve and emit deprecation warning on stderr
const aliases = [
  "check",
  "create",
  "health",
  "sync",
  "render-multi",
  "media:list",
  "media:download",
  "license",
];

for (const alias of aliases) {
  let stdoutCaptured = "";
  let stderrCaptured = "";
  try {
    await runCli(["node", "cinecode", alias, "--help"], {
      stdout: (t) => { stdoutCaptured += t; },
      stderr: (t) => { stderrCaptured += t; },
    });
  } catch (err) {
    fail(`Alias '${alias} --help' threw: ${err}`);
    continue;
  }

  // Deprecation warning should appear in stderr
  if (!stderrCaptured.includes("CC1014")) {
    fail(`Alias '${alias}' did not emit CC1014 deprecation warning in stderr`);
  }
}

// 3. Verify removed commands fail as unknown
const removed = ["edit", "template"];
for (const cmd of removed) {
  let stderrCaptured = "";
  let exitCode = 0;
  try {
    exitCode = await runCli(["node", "cinecode", cmd], {
      stdout: () => {},
      stderr: (t) => { stderrCaptured += t; },
    });
  } catch (err) {
    exitCode = 1;
  }
  if (exitCode === 0) {
    fail(`Removed command '${cmd}' unexpectedly succeeded with exit code 0`);
  }
}

// 4. Verify default help output vs --all
let defaultHelpOut = "";
await runCli(["node", "cinecode", "help"], {
  stdout: (t) => { defaultHelpOut += t; },
  stderr: () => {},
});

if (!defaultHelpOut.includes("Product Commands:") || !defaultHelpOut.includes("Resource Commands:")) {
  fail("'cinecode help' missing Product or Resource Commands");
}
if (defaultHelpOut.includes("Maintenance Commands:")) {
  fail("'cinecode help' should not list Maintenance Commands by default");
}

let allHelpOut = "";
await runCli(["node", "cinecode", "help", "--all"], {
  stdout: (t) => { allHelpOut += t; },
  stderr: () => {},
});

if (!allHelpOut.includes("Maintenance Commands:") || !allHelpOut.includes("Forwarding Aliases:")) {
  fail("'cinecode help --all' missing Maintenance Commands or Forwarding Aliases");
}

if (errors > 0) {
  console.error(`check-surface failed with ${errors} error(s)`);
  process.exit(1);
}

console.log(`check-surface ok: contracts in help, 8 aliases verified, removed commands rejected, help partitioning ok`);
