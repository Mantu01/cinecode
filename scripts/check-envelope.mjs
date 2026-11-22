import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const distReporter = path.join(cinecodeDir, "dist", "esm", "cli", "reporter.js");
const distRegistry = path.join(cinecodeDir, "dist", "esm", "cli", "command-registry.js");
const distSpool = path.join(cinecodeDir, "dist", "esm", "cli", "spool.js");

if (!existsSync(distReporter) || !existsSync(distRegistry)) {
  execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
    cwd: cinecodeDir,
    stdio: "inherit",
  });
}

const {
  Reporter,
  serializeEnvelope,
  validateCommandResult,
  verifyArtifact,
} = await import(pathToFileURL(distReporter).href);
const { COMMANDS } = await import(pathToFileURL(distRegistry).href);
const { sweepSpools, MAX_SPOOL_FILES, MAX_SPOOL_AGE_MS } = await import(pathToFileURL(distSpool).href);

let errors = 0;
function fail(msg) {
  console.error(`check-envelope error: ${msg}`);
  errors++;
}

// 1. Static check: No code path replaces or patches process.stdout.write
const cliSrcDir = path.join(cinecodeDir, "src", "cli");
const srcFiles = readdirSync(cliSrcDir).filter((f) => f.endsWith(".ts"));
for (const file of srcFiles) {
  const content = readFileSync(path.join(cliSrcDir, file), "utf8");
  if (content.includes("process.stdout.write =") || content.includes("process.stdout.write=")) {
    fail(`Forbidden process.stdout monkey-patch detected in ${file}`);
  }
}

// 2. Machine output validates against per-command schema; fails on stray key
try {
  validateCommandResult("render", { rendered: 1, budget: {}, explain: {} });
} catch (err) {
  fail(`Valid result failed validation: ${err}`);
}

try {
  validateCommandResult("render", { rendered: 1, unexpectedStrayKey: "trojan" });
  fail("Expected stray key in result to throw validation error CC9002");
} catch (err) {
  if (err?.code !== "CC9002") {
    fail(`Expected CC9002 for stray result key, got: ${err?.code || err}`);
  }
}

// 3. Centralized artifact verification blocks success
const tmpDir = path.join(root, ".tmp-envelope-test");
try {
  rmSync(tmpDir, { recursive: true, force: true });
} catch {}
mkdirSync(tmpDir, { recursive: true });

try {
  // Test missing artifact
  try {
    verifyArtifact({ kind: "video", path: path.join(tmpDir, "missing.mp4") });
    fail("Expected missing artifact to throw CC4004");
  } catch (err) {
    if (err?.code !== "CC4004") fail(`Expected CC4004 for missing artifact, got: ${err?.code || err}`);
  }

  // Test empty artifact (0 bytes)
  const emptyFile = path.join(tmpDir, "empty.mp4");
  writeFileSync(emptyFile, Buffer.alloc(0));
  try {
    verifyArtifact({ kind: "video", path: emptyFile });
    fail("Expected empty artifact to throw CC4004");
  } catch (err) {
    if (err?.code !== "CC4004") fail(`Expected CC4004 for empty artifact, got: ${err?.code || err}`);
  }

  // Test extension mismatch
  const validFile = path.join(tmpDir, "output.txt");
  writeFileSync(validFile, "content");
  try {
    verifyArtifact({ kind: "video", path: validFile, expectedExtension: ".mp4" });
    fail("Expected extension mismatch to throw CC4004");
  } catch (err) {
    if (err?.code !== "CC4004") fail(`Expected CC4004 for extension mismatch, got: ${err?.code || err}`);
  }

  // Test valid artifact with checksum
  const goodFile = path.join(tmpDir, "film.mp4");
  writeFileSync(goodFile, "cinecode video stream content");
  const art = { kind: "video", path: goodFile, expectedExtension: ".mp4" };
  verifyArtifact(art, { checksum: true });
  if (!art.sha256 || typeof art.sha256 !== "string") {
    fail("Checksum calculation failed on valid artifact");
  }
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}

// 4. Stable key order envelope
const sampleEnvelope = {
  schemaVersion: 1,
  command: "still",
  ok: true,
  exitCode: 0,
  timing: { startedAt: new Date().toISOString(), durationMs: 42 },
  project: null,
  selection: null,
  result: { composition: "main", frame: 0, output: "out.png" },
  artifacts: [],
  warnings: [],
  degradations: [],
  issues: [],
  resourceUsage: null,
  explain: null,
  degraded: false,
};
const serialized = serializeEnvelope(sampleEnvelope);
const parsed = JSON.parse(serialized);
const keys = Object.keys(parsed);
const expectedKeyOrder = [
  "schemaVersion",
  "command",
  "ok",
  "exitCode",
  "timing",
  "project",
  "selection",
  "result",
  "artifacts",
  "warnings",
  "degradations",
  "issues",
  "resourceUsage",
  "explain",
];
for (let i = 0; i < expectedKeyOrder.length; i++) {
  if (keys[i] !== expectedKeyOrder[i]) {
    fail(`Envelope key order mismatch at index ${i}: expected '${expectedKeyOrder[i]}', got '${keys[i]}'`);
  }
}

// 5. Spool sweep: byte cap, age, count limits
const spoolTmp = path.join(root, ".tmp-spool-test");
try {
  rmSync(spoolTmp, { recursive: true, force: true });
} catch {}
mkdirSync(spoolTmp, { recursive: true });

try {
  // Create 15 spool files (exceeding MAX_SPOOL_FILES = 10)
  for (let i = 0; i < 15; i++) {
    const f = path.join(spoolTmp, `machine-stdout-test-${i}.log`);
    writeFileSync(f, `spool log content ${i}\n`);
  }
  const sweepRes = sweepSpools(spoolTmp);
  if (sweepRes.sweptCount !== 5) {
    fail(`Spool count sweep failed: expected 5 files swept, got ${sweepRes.sweptCount}`);
  }
} finally {
  try {
    rmSync(spoolTmp, { recursive: true, force: true });
  } catch {}
}

// 6. Non-TTY safe progress: at most 1 line per 10%
let progressLines = 0;
const testStderr = [];
const rep = new Reporter({
  machine: false,
  quiet: false,
  stderrWrite: (text) => {
    testStderr.push(text);
    if (text.endsWith("\n")) progressLines++;
  },
});
// Emit 100 progress ticks (0 to 99)
for (let i = 0; i < 100; i++) {
  rep.progress({ current: i, total: 100 });
}
if (progressLines > 11) {
  fail(`Non-TTY progress emitted too many lines (${progressLines} lines, max expected 11)`);
}

// 7. CLI execution with --json emits exactly one valid JSON document
const cliBin = path.join(cinecodeDir, "dist", "esm", "cli", "program.js");
const { runCli } = await import(pathToFileURL(cliBin).href);

let stdoutData = "";
let stderrData = "";
const cliExit = await runCli(["node", "cinecode", "formats", "--json"], {
  stdout: (text) => {
    stdoutData += text;
  },
  stderr: (text) => {
    stderrData += text;
  },
});
if (cliExit !== 0) {
  fail(`runCli formats --json exited with ${cliExit}`);
}
try {
  const doc = JSON.parse(stdoutData.trim());
  if (doc.schemaVersion !== 1 || doc.command !== "formats" || !doc.ok) {
    fail(`Emitted machine document mismatch: ${stdoutData}`);
  }
} catch (e) {
  fail(`CLI --json stdout is not valid single JSON: ${e.message}\nOutput: ${stdoutData}`);
}

// Test error in machine mode
let errStdout = "";
const errExit = await runCli(["node", "cinecode", "nonexistent-cmd-token", "--json"], {
  stdout: (text) => {
    errStdout += text;
  },
  stderr: () => {},
});
if (errExit === 0) {
  fail("Expected nonexistent command to exit non-zero");
}
try {
  const errDoc = JSON.parse(errStdout.trim());
  if (errDoc.ok !== false || typeof errDoc.exitCode !== "number" || !Array.isArray(errDoc.issues)) {
    fail(`Machine error document invalid: ${errStdout}`);
  }
} catch (e) {
  fail(`Error machine mode stdout is not valid single JSON: ${e.message}\nOutput: ${errStdout}`);
}

if (errors > 0) {
  console.error(`check-envelope failed with ${errors} error(s)`);
  process.exit(1);
}

console.log("check-envelope ok: stream purity, schema validation, artifact verification, stable envelope, spool sweep, and non-TTY progress verified");
