import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, mock } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createProgram, runCli } from "../program.js";
import { EXIT_CODES, EXIT_CODE_RULES, exitCodeForError } from "../exit-codes.js";
import { ErrorCode } from "../../errors/codes.js";
import { loadAliases, loadLocalAliases, resolveAliases } from "../profiles.js";

const require = createRequire(import.meta.url);
const cjsFs = require("node:fs") as { existsSync: (path: string) => boolean };
const cjsOs = require("node:os") as { homedir: () => string };
const programEntry = fileURLToPath(new URL("../program.js", import.meta.url));

interface Sinks {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

function capture(run: (sinks: Sinks) => Promise<number>): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = mock.method(console, "log", (...args: unknown[]) => void out.push(args.join(" ")));
  const error = mock.method(console, "error", (...args: unknown[]) => void err.push(args.join(" ")));
  return run({ stdout: (text) => void out.push(text), stderr: (text) => void err.push(text) })
    .then((code) => ({ code, out: out.join("\n"), err: err.join("\n") }))
    .finally(() => {
      log.mock.restore();
      error.mock.restore();
    });
}

function tempProject(packageJson: Record<string, unknown> = {}, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "cinecode-cli-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "probe", private: true, ...packageJson }, null, 2));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

function withHome<T>(dir: string, run: () => T): T {
  const original = cjsOs.homedir;
  cjsOs.homedir = () => dir;
  try {
    return run();
  } finally {
    cjsOs.homedir = original;
  }
}

test("importing the CLI entry has no side effects", async () => {
  const before = [...process.argv];
  const module = await import("../main.js");
  assert.deepEqual(process.argv, before);
  assert.equal(typeof module.runCli, "function");
  assert.equal(typeof module.createProgram, "function");
  assert.equal(module.EXIT_CODES.success, 0);
});

test("two runs in one process keep independent state", async () => {
  const still = await capture((sinks) => runCli(["node", "cinecode", "help", "still"], sinks));
  const render = await capture((sinks) => runCli(["node", "cinecode", "help", "render"], sinks));
  assert.equal(still.code, EXIT_CODES.success);
  assert.equal(render.code, EXIT_CODES.success);
  assert.match(still.out, /Usage: cinecode still/);
  assert.doesNotMatch(still.out, /Usage: cinecode render/);
  assert.match(render.out, /Usage: cinecode render/);
  assert.doesNotMatch(render.out, /Usage: cinecode still/);
  assert.notEqual(createProgram(), createProgram());
});

test("help and version never read the home directory", async () => {
  const original = cjsFs.existsSync;
  const originalHomedir = cjsOs.homedir;
  cjsFs.existsSync = () => {
    throw new Error("filesystem read during help/version");
  };
  cjsOs.homedir = () => {
    throw new Error("home read during help/version");
  };
  try {
    const version = await capture((sinks) => runCli(["node", "cinecode", "--version"], sinks));
    const help = await capture((sinks) => runCli(["node", "cinecode", "--help"], sinks));
    assert.equal(version.code, EXIT_CODES.success);
    assert.match(version.out, /^\d+\.\d+\.\d+/);
    assert.equal(help.code, EXIT_CODES.success);
    assert.match(help.out, /Usage: cinecode/);
  } finally {
    cjsFs.existsSync = original;
    cjsOs.homedir = originalHomedir;
  }
});

test("conflicting flags name both flags and fail with the usage code", async () => {
  const exclusive = await capture((sinks) => runCli(["node", "cinecode", "still", "--frame", "1", "--time", "2"], sinks));
  assert.equal(exclusive.code, EXIT_CODES.usage);
  assert.match(exclusive.err, /--frame.*--time/);
});

test("every command help carries an example and option defaults", async () => {
  const { out, code } = await capture((sinks) => runCli(["node", "cinecode", "help", "still"], sinks));
  assert.equal(code, EXIT_CODES.success);
  assert.match(out, /Example:\n {2}cinecode still/);
  assert.match(out, /Defaults/);
  assert.match(out, /--json\s+false/);
  assert.match(out, /--config <path>\s+unset/);
});

test("a real validation failure exits with the validation code", async () => {
  const dir = tempProject();
  const result = await capture((sinks) => runCli(["node", "cinecode", "check", "--config", join(dir, "missing.ts")], { cwd: dir, ...sinks }));
  assert.equal(result.code, EXIT_CODES.validation);
});



test("the exit-code table maps every documented failure", () => {
  assert.deepEqual(
    { ...EXIT_CODES },
    { success: 0, runtime: 1, usage: 2, validation: 3, environment: 4, unsupportedRuntime: 78, cancelled: 130 },
  );
  assert.equal(exitCodeForError("CC1001"), EXIT_CODES.validation);
  assert.equal(exitCodeForError("CC3001"), EXIT_CODES.validation);
  assert.equal(exitCodeForError("CC7001"), EXIT_CODES.environment);
  assert.equal(exitCodeForError("CC6002"), EXIT_CODES.environment);
  assert.equal(exitCodeForError("CC4003"), EXIT_CODES.cancelled);
  assert.equal(exitCodeForError("CC4002"), EXIT_CODES.runtime);
});

test("the exit-code table maps every documented failure", () => {
  assert.deepEqual(
    { ...EXIT_CODES },
    { success: 0, runtime: 1, usage: 2, validation: 3, environment: 4, unsupportedRuntime: 78, cancelled: 130 },
  );
  assert.equal(exitCodeForError("CC1001"), EXIT_CODES.validation);
  assert.equal(exitCodeForError("CC3001"), EXIT_CODES.validation);
  assert.equal(exitCodeForError("CC7001"), EXIT_CODES.environment);
  assert.equal(exitCodeForError("CC6002"), EXIT_CODES.environment);
  assert.equal(exitCodeForError("CC4003"), EXIT_CODES.cancelled);
  assert.equal(exitCodeForError("CC4002"), EXIT_CODES.runtime);
});

test("aliases are opt-in and fail loudly when they resolve to nothing", async () => {
  const dir = tempProject({ cinecode: { aliases: { v: "version", bad: "rendr" } } });
  const original = process.env.CINECODE_ALIASES;
  try {
    delete process.env.CINECODE_ALIASES;
    const off = await capture((sinks) => runCli(["node", "cinecode", "v"], { cwd: dir, ...sinks }));
    assert.equal(off.code, EXIT_CODES.usage);

    process.env.CINECODE_ALIASES = "1";
    const on = await capture((sinks) => runCli(["node", "cinecode", "v"], { cwd: dir, ...sinks }));
    assert.equal(on.code, EXIT_CODES.success);
    assert.match(on.out, /^\d+\.\d+\.\d+/);

    const bad = await capture((sinks) => runCli(["node", "cinecode", "bad"], { cwd: dir, ...sinks }));
    assert.equal(bad.code, EXIT_CODES.usage);
    assert.match(bad.err, /did you mean render/);

    const verbose = await capture((sinks) => runCli(["node", "cinecode", "--verbose", "v"], { cwd: dir, ...sinks }));
    assert.equal(verbose.code, EXIT_CODES.success);
    assert.match(verbose.err, /alias v = version/);
  } finally {
    if (original === undefined) delete process.env.CINECODE_ALIASES;
    else process.env.CINECODE_ALIASES = original;
  }
});

test("alias expansion is bounded, cycle-safe and local-first", () => {
  const known = (name: string) => name === "render";
  assert.deepEqual(resolveAliases(["render"], { render: "still" }, known).args, ["render"]);
  assert.deepEqual(resolveAliases(["a"], { a: "b", b: "c" }).args, ["c"]);
  const cycle = resolveAliases(["a"], { a: "b", b: "a" });
  assert.equal(cycle.args[0], "a");
  assert.equal(cycle.applied.length, 2);

  const dir = tempProject(
    { cinecode: { aliases: { r: "render", only: "package" } } },
    { "cinecode.json": JSON.stringify({ aliases: { r: "still" } }) },
  );
  const home = mkdtempSync(join(tmpdir(), "cinecode-home-"));
  mkdirSync(join(home, ".cinecode"), { recursive: true });
  writeFileSync(join(home, ".cinecode", "config.json"), JSON.stringify({ aliases: { r: "inspect", global: "version" } }));

  const local = loadLocalAliases(dir);
  assert.equal(local.r, "still");
  assert.equal(local.only, "package");

  const merged = withHome(home, () => loadAliases(dir));
  assert.equal(merged.r, "still");
  assert.equal(merged.global, "version");
  assert.equal(merged.only, "package");
});

test("help and version are clean exits; unknown command and flag are not", () => {
  const dir = mkdtempSync(join(tmpdir(), "cinecode-clean-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "probe", private: true }));
  const cliEntry = fileURLToPath(new URL("../main.js", import.meta.url));
  const invoke = (args: string[]) => {
    const result = spawnSync(process.execPath, [cliEntry, ...args], { cwd: dir, encoding: "utf8" });
    return { code: result.status ?? -1, out: result.stdout, err: result.stderr };
  };

  const clean = [
    ["--help"],
    ["-h"],
    ["help"],
    ["help", "render"],
    ["--version"],
    ["-V"],
  ];
  for (const args of clean) {
    const result = invoke(args);
    assert.equal(result.code, EXIT_CODES.success, `${args.join(" ")}: ${result.err}`);
    assert.equal(result.err, "", `${args.join(" ")} wrote to stderr`);
    assert.ok(result.out.trim().length > 0, `${args.join(" ")} wrote nothing`);
    assert.doesNotMatch(result.out, /\bCC\d{4}\b/, `${args.join(" ")} leaked a coded error`);
  }
  assert.match(invoke(["--help"]).out, /still.*render.*presets/s);
  assert.match(invoke(["help", "render"]).out, /Usage: cinecode render/);

  for (const args of [["nope"], ["--bogus"]]) {
    const result = invoke(args);
    assert.equal(result.code, EXIT_CODES.usage, args.join(" "));
    assert.match(result.err, /\[CC\d{4}\]/, `${args.join(" ")} has no coded error`);
  }

  const unknownHelp = invoke(["help", "nope"]);
  assert.equal(unknownHelp.code, EXIT_CODES.usage);
});

test("cold start for help and version imports no render stack", () => {
  const dir = mkdtempSync(join(tmpdir(), "cinecode-cold-"));
  const logFile = join(dir, "loaded.log");
  writeFileSync(join(dir, "loaded.log"), "");
  writeFileSync(
    join(dir, "loader.mjs"),
    [
      'import { appendFileSync } from "node:fs";',
      "export async function resolve(specifier, context, next) {",
      "  appendFileSync(process.env.CINECODE_PROBE_LOG, `${specifier}\\n`);",
      "  return next(specifier, context);",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "register.mjs"),
    'import { register } from "node:module";\nregister(new URL("./loader.mjs", import.meta.url).href);\n',
  );
  writeFileSync(
    join(dir, "run.mjs"),
    "const { runCli } = await import(process.env.CINECODE_PROBE_ENTRY);\nprocess.exitCode = await runCli([\"node\", \"cinecode\", ...process.argv.slice(2)]);\n",
  );

  const run = (args: string[]) => {
    writeFileSync(logFile, "");
    const registerUrl = pathToFileURL(join(dir, "register.mjs")).href;
    const result = spawnSync(process.execPath, ["--import", registerUrl, join(dir, "run.mjs"), ...args], {
      encoding: "utf8",
      env: { ...process.env, CINECODE_PROBE_LOG: logFile, CINECODE_PROBE_ENTRY: pathToFileURL(programEntry).href },
    });
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(logFile, "utf8");
  };

  const heavy = /renderer|encoder|pipeline|pdf|midi|model-3d|observability|audio|canvas|resvg|opentype/i;
  for (const args of [["--help"], ["--version"]]) {
    const loaded = run(args);
    const offenders = loaded.split("\n").filter((line) => heavy.test(line));
    assert.deepEqual(offenders, [], `cold start loaded ${offenders.join(", ")} for ${args.join(" ")}`);
  }
});
