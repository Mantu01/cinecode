import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MACHINE_INLINE_LIMIT, StdoutCapture } from "../machine-capture.js";
import { runReport, validateMachineReport, type MachineReport } from "../run-report.js";
import { recordDegradation, takeWarnings } from "../../errors/degradations.js";

function machineDocument(report: MachineReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

test("incidental stdout stays byte-identical inside the document", () => {
  const capture = new StdoutCapture(mkdtempSync(join(tmpdir(), "cinecode-capture-")));
  const noisy = 'console noise {"looks":"like json"}\nsecond line\n';
  capture.write(noisy);
  const payload = capture.drain();
  assert.equal(payload.output, noisy);
  assert.equal(payload.outputFile, undefined);
  assert.equal((payload.output as string).length, noisy.length);
});

test("output above the inline limit is written to a file and named with its byte count", () => {
  const dir = mkdtempSync(join(tmpdir(), "cinecode-capture-"));
  const capture = new StdoutCapture(dir);
  const large = "x".repeat(MACHINE_INLINE_LIMIT + 1);
  capture.write(large);
  const payload = capture.drain();
  assert.equal(payload.outputBytes, MACHINE_INLINE_LIMIT + 1);
  assert.equal(typeof payload.outputFile, "string");
  assert.match(String(payload.output), /truncated: captured stdout is \d+ bytes/);
  assert.equal(readFileSync(String(payload.outputFile), "utf8"), large);
});

test("a warning appears once and does not corrupt the machine document", () => {
  runReport.reset();
  runReport.start("render", true);
  runReport.warn("CC1014", "deprecated spelling accepted", "--props");
  const report = runReport.finish();
  assert.equal(report.warnings.length, 1);
  assert.deepEqual(validateMachineReport(report), []);
  const parsed = JSON.parse(machineDocument(report));
  assert.equal(parsed.warnings.length, 1);
  assert.equal(takeWarnings().length, 1);
  assert.equal(takeWarnings().length, 0);
});

test("a degradation recorded before alias resolution survives relabel", () => {
  runReport.reset();
  runReport.start("cinecode", true);
  recordDegradation({
    code: "CC1010",
    what: "alias resolution",
    reason: "alias table could not be read",
    instead: "the literal command token was used",
  });
  runReport.relabel("render");
  const report = runReport.finish();
  assert.equal(report.command, "render");
  assert.equal(report.degraded, true);
  assert.equal(report.degradations.length, 1);
  assert.deepEqual(validateMachineReport(report), []);
});

test("a noisy library write cannot start a second document", () => {
  const capture = new StdoutCapture(mkdtempSync(join(tmpdir(), "cinecode-capture-")));
  capture.write('{"schemaVersion":1,"fake":true}\n');
  runReport.reset();
  runReport.start("presets", true);
  runReport.result({ presets: [] });
  const finished = runReport.finish();
  const report = { ...finished, result: { ...finished.result, ...capture.drain() } };
  const text = machineDocument(report);
  const parsed = JSON.parse(text) as MachineReport;
  assert.equal(validateMachineReport(parsed).length, 0);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.command, "presets");
});
