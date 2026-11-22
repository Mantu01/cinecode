import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const distRegistry = path.join(cinecodeDir, "dist", "esm", "cli", "command-registry.js");
const distOptionParser = path.join(cinecodeDir, "dist", "esm", "cli", "option-parser.js");

if (!existsSync(distRegistry) || !existsSync(distOptionParser)) {
  execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
    cwd: cinecodeDir,
    stdio: "inherit",
  });
}

const { COMMANDS } = await import(pathToFileURL(distRegistry).href);
const {
  preParseArgs,
  validateCommandOptions,
  validateNumericBounds,
  validateEnumOption,
  parseMemoryBudgetMb,
} = await import(pathToFileURL(distOptionParser).href);

let errors = 0;
function fail(msg) {
  console.error(`check-options error: ${msg}`);
  errors++;
}

const isKnown = (name) => COMMANDS.some((c) => c.name === name || c.aliases?.includes(name));

// 1. Verify pre-parser: equals form vs space form
const p1 = preParseArgs(["--root", "/foo", "--config", "./bar.json", "render"], isKnown);
const p2 = preParseArgs(["--root=/foo", "--config=./bar.json", "render"], isKnown);
if (p1.globalOptions.root !== "/foo" || p2.globalOptions.root !== "/foo") {
  fail("pre-parser failed on --root space/equals equivalence");
}
if (p1.globalOptions.config !== "./bar.json" || p2.globalOptions.config !== "./bar.json") {
  fail("pre-parser failed on --config space/equals equivalence");
}

// 2. Verify global flags before vs after command token
const pBefore = preParseArgs(["--json", "--no-color", "--verbose", "render", "film.ts"], isKnown);
const pAfter = preParseArgs(["render", "film.ts", "--json", "--no-color", "--verbose"], isKnown);
if (
  pBefore.globalOptions.json !== true ||
  pAfter.globalOptions.json !== true ||
  pBefore.globalOptions.noColor !== true ||
  pAfter.globalOptions.noColor !== true ||
  pBefore.globalOptions.verbose !== true ||
  pAfter.globalOptions.verbose !== true ||
  pBefore.commandToken !== "render" ||
  pAfter.commandToken !== "render" ||
  pBefore.commandArgs[0] !== "film.ts" ||
  pAfter.commandArgs[0] !== "film.ts"
) {
  fail("pre-parser failed on identical handling of global flags before vs after command token");
}

// 3. Boolean flags never consume a value
const pBool = preParseArgs(["--json", "render"], isKnown);
if (pBool.globalOptions.json !== true || pBool.commandToken !== "render") {
  fail("pre-parser boolean flag consumed following token");
}

// 4. '--' terminates option parsing
const pTerm = preParseArgs(["render", "--", "--root", "/ignore/this"], isKnown);
if (pTerm.globalOptions.root !== undefined || !pTerm.commandArgs.includes("--root")) {
  fail("pre-parser did not terminate option parsing on '--'");
}

// 5. Unknown flags before command token throw usage error
try {
  preParseArgs(["--completely-bogus-flag"], isKnown);
  fail("pre-parser failed to throw on unknown flag before command token");
} catch (err) {
  if (!err?.message?.includes("unknown option")) {
    fail(`pre-parser threw unexpected error: ${err}`);
  }
}

// 6. Memory budget has exactly one canonical key and valid unit parsing
for (const cmd of COMMANDS) {
  for (const opt of cmd.options) {
    if (opt.name === "memoryBudgetMb") {
      fail(`Found non-canonical option '${opt.name}' in command '${cmd.name}'`);
    }
  }
}
if (parseMemoryBudgetMb("1GB") !== 1024) fail("parseMemoryBudgetMb failed for 1GB");
if (parseMemoryBudgetMb("512MB") !== 512) fail("parseMemoryBudgetMb failed for 512MB");
if (parseMemoryBudgetMb(2048) !== 2048) fail("parseMemoryBudgetMb failed for numeric MB");
try {
  parseMemoryBudgetMb("invalid");
  fail("parseMemoryBudgetMb failed to reject invalid string");
} catch {
  // Expected
}
try {
  parseMemoryBudgetMb("4MB");
  fail("parseMemoryBudgetMb failed to reject below 16MB minimum");
} catch {
  // Expected
}

// 7. Duplicate verbose binding is gone (no command defines verbose option)
for (const cmd of COMMANDS) {
  for (const opt of cmd.options) {
    if (opt.name === "verbose") {
      fail(`Command '${cmd.name}' defines duplicate option 'verbose' (must be global only)`);
    }
  }
}

// 8. Table-driven invalid value sweep for every option across all commands
let testedOptions = 0;
for (const cmd of COMMANDS) {
  for (const opt of cmd.options) {
    testedOptions++;

    // Test numbers
    if (opt.type === "number") {
      try {
        validateCommandOptions(cmd, { [opt.name]: "not-a-number" });
        fail(`Command '${cmd.name}' option '${opt.name}' failed to reject non-numeric string`);
      } catch {
        // Expected
      }

      try {
        validateCommandOptions(cmd, { [opt.name]: NaN });
        fail(`Command '${cmd.name}' option '${opt.name}' failed to reject NaN`);
      } catch {
        // Expected
      }

      if (opt.bounds?.min !== undefined) {
        try {
          validateCommandOptions(cmd, { [opt.name]: opt.bounds.min - 1 });
          fail(`Command '${cmd.name}' option '${opt.name}' failed to reject value below min ${opt.bounds.min}`);
        } catch {
          // Expected
        }
      }

      if (opt.bounds?.max !== undefined) {
        try {
          validateCommandOptions(cmd, { [opt.name]: opt.bounds.max + 1 });
          fail(`Command '${cmd.name}' option '${opt.name}' failed to reject value above max ${opt.bounds.max}`);
        } catch {
          // Expected
        }
      }
    }

    // Test enums
    if (opt.type === "enum") {
      try {
        validateCommandOptions(cmd, { [opt.name]: "__bogus_choice__" });
        fail(`Command '${cmd.name}' option '${opt.name}' failed to reject invalid enum choice`);
      } catch {
        // Expected
      }
    }

    // Test conflicts
    if (opt.conflicts && opt.conflicts.length > 0) {
      for (const conf of opt.conflicts) {
        try {
          validateCommandOptions(cmd, { [opt.name]: "val", [conf]: "val" });
          fail(`Command '${cmd.name}' option '${opt.name}' failed to enforce conflict with '${conf}'`);
        } catch {
          // Expected
        }
      }
    }

    // Test requires
    if (opt.requires && opt.requires.length > 0) {
      try {
        validateCommandOptions(cmd, { [opt.name]: "val" });
        fail(`Command '${cmd.name}' option '${opt.name}' failed to enforce required flag`);
      } catch {
        // Expected
      }
    }
  }
}

if (errors > 0) {
  console.error(`check-options failed with ${errors} error(s)`);
  process.exit(1);
}

console.log(`check-options ok: ${testedOptions} options validated across ${COMMANDS.length} commands; pre-parser and bounds verified`);
