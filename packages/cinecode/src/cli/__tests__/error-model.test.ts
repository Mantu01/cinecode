import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { EXIT_CODES, exitCodeForError } from "../exit-codes.js";
import { runReport, validateMachineReport, type MachineReport } from "../run-report.js";
import { recordDegradation } from "../../errors/degradations.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { createMediaCache } from "../../media/cache.js";
import { createMediaResolver } from "../../media/resolver.js";
import { muxError } from "../../pipeline/index.js";

const cliEntry = fileURLToPath(new URL("../main.js", import.meta.url));
const checker = fileURLToPath(new URL("../../../scripts/check-silent-catches.mjs", import.meta.url));

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "cinecode-errors-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

function run(dir: string, args: string[]) {
  const result = spawnSync(process.execPath, [cliEntry, ...args], { cwd: dir, encoding: "utf8" });
  return { status: result.status ?? -1, out: result.stdout, err: result.stderr };
}

function parseMachine(out: string): MachineReport {
  const report = JSON.parse(out) as MachineReport;
  assert.deepEqual(validateMachineReport(report), []);
  return report;
}

const CONFIG = JSON.stringify({
  schemaVersion: 2,
  project: { entry: "./main.ts", sourceDir: "./src", outputDir: "./output", cacheDir: "./cache" },
});

const COMPOSITION = JSON.stringify({
  name: "probe",
  width: 32,
  height: 32,
  fps: 1,
  duration: 1,
  background: "#000000",
  audio: {},
  rootTimeline: { tracks: [] },
});

test("malformed config is a coded error naming the resolved path", () => {
  const dir = project({ "cinecode.config.json": "{ not json" });
  const configPath = join(dir, "cinecode.config.json");
  const result = run(dir, ["check", "--config", configPath]);
  assert.equal(result.status, EXIT_CODES.validation);
  assert.match(result.err, /\[CC1006\]/);
  assert.ok(result.err.includes(configPath), result.err);
});

test("missing entry, missing media and unsupported format are coded", async () => {
  const missingEntry = run(project({}), ["export-svg", "missing.ts"]);
  assert.equal(missingEntry.status, EXIT_CODES.validation);
  assert.match(missingEntry.err, /\[CC1009\]/);
  assert.match(missingEntry.err, /missing\.ts/);

  const dir = project({});
  const cache = createMediaCache(join(dir, "cache"));
  await cache.initialize();
  const resolver = createMediaResolver({ sourceDir: dir, cache });
  await resolver.initialize();
  const mediaError = await resolver.resolve("absent.png").catch((error: unknown) => error);
  assert.equal((mediaError as { code: string }).code, "CC2001");
  assert.equal((mediaError as { location: { file: string } }).location.file, resolve(dir, "absent.png"));

  const format = run(project({ "composition.json": COMPOSITION }), [
    "still",
    "--config",
    "composition.json",
    "--format",
    "bogus",
  ]);
  assert.equal(format.status, EXIT_CODES.validation);
  assert.match(format.err, /\[CC2002\]/);
});

test("failed mux maps to a coded runtime error", () => {
  const error = muxError("ffmpeg exited 1", "out.mp4");
  assert.equal(error.code, ErrorCode.CC4005);
  assert.equal(error.location?.file, "out.mp4");
  assert.equal(exitCodeForError(error.code), EXIT_CODES.runtime);
});

test("a degradation is recorded in human summary and machine output", () => {
  runReport.start("probe", true);
  recordDegradation({
    code: "CC4007",
    what: "cached frame discarded",
    reason: "object file was truncated",
    input: "cache/objects/aa/bb/hash.raw",
    instead: "the frame is re-rendered",
  });
  const report = runReport.finish();
  assert.equal(report.degraded, true);
  assert.equal(report.degradations.length, 1);
  assert.match(runReport.summary(report), /Run degraded/);
  assert.deepEqual(validateMachineReport(report), []);
});

test("machine output is one schema-valid document per command", () => {
  const dir = project({});
  for (const args of [["version", "--json"], ["presets", "--json"], ["license", "--json"]]) {
    const result = run(dir, args);
    assert.equal(result.status, EXIT_CODES.success, result.err);
    const report = parseMachine(result.out);
    assert.equal(report.ok, true);
    assert.equal(report.command, args[0]);
  }
});

test("a degraded run appears in machine output and its error record", () => {
  const dir = project({ "cinecode.config.json": CONFIG, "main.ts": 'throw new Error("manifest boom");\n' });
  const result = run(dir, ["check", "--json", "--config", "cinecode.config.json"]);
  assert.equal(result.status, EXIT_CODES.validation, result.err);
  const report = parseMachine(result.out);
  assert.equal(report.ok, false);
  assert.equal(report.degraded, true);
  assert.ok(report.degradations.length > 0);
  assert.ok(report.error?.code);
  assert.match(result.err, /Run degraded/);
});

test("a command that requests an artifact cannot finish without one", () => {
  runReport.start("probe", true);
  runReport.expectArtifact("video");
  assert.throws(
    () => runReport.finish(),
    (error: unknown) => (error as { code?: string }).code === ErrorCode.CC4004,
  );

  const dir = project({ "cinecode.config.json": CONFIG, "main.ts": "export default {};\n" });
  const result = run(dir, ["generate", "--config", "cinecode.config.json", "--all"]);
  assert.notEqual(result.status, EXIT_CODES.success);
  assert.match(result.err, /\[CC4004\]/);
});

test("the silent-catch check rejects a discarded error", () => {
  const dir = project({ "probe.ts": "try {\n  run();\n} catch {}\n" });
  const result = spawnSync(process.execPath, [checker, join(dir, "probe.ts")], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /discarded without a code/);
});

test("every coded failure carries a location, a hint and an optional cause", () => {
  const cause = new Error("root cause");
  const error = createError(
    ErrorCode.CC4005,
    { reason: "ffmpeg exited 1" },
    { location: { file: "out.mp4" }, cause },
  );
  assert.equal(error.code, ErrorCode.CC4005);
  assert.equal(error.location?.file, "out.mp4");
  assert.equal(error.cause, cause);
  assert.ok(error.fixHint);
  assert.equal(error.severity, "error");
});
