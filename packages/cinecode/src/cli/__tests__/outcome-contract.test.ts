import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMANDS } from "../registry/assemble.js";
import { EXIT_CODES, EXIT_CODE_RULES, exitCodeForError, type ExitCodeName } from "../shared/exit-codes.js";
import { ErrorCode } from "../../errors/codes.js";
import { runReport } from "../output/run-report.js";

test("the exit-code table covers every error code and maps to one documented exit", () => {
  const codes = Object.values(ErrorCode);
  assert.ok(codes.length > 0);
  for (const code of codes) {
    const matching = EXIT_CODE_RULES.filter((rule) => code.startsWith(rule.prefix));
    assert.ok(matching.length > 0, `${code} has no exit rule`);
    const effective = [...matching].sort((a, b) => b.prefix.length - a.prefix.length)[0]!;
    assert.equal(exitCodeForError(code), EXIT_CODES[effective.exit], code);
    assert.equal(typeof exitCodeForError(code), "number");
  }
  for (const rule of EXIT_CODE_RULES) {
    assert.ok(rule.exit in EXIT_CODES, `${rule.exit} is not a documented exit name`);
  }
});

test("every command declares outcome, network and destructive intent", () => {
  assert.ok(COMMANDS.length > 0);
  for (const command of COMMANDS) {
    assert.ok(["none", "artifact", "report"].includes(command.outcome), command.name);
    assert.equal(typeof command.network, "boolean", command.name);
    assert.equal(typeof command.destructive, "boolean", command.name);
  }
  const artifacts = COMMANDS.filter((command) => command.outcome === "artifact").map((command) => command.name);
  assert.ok(artifacts.includes("render"));
  assert.ok(artifacts.includes("still"));
  assert.equal(COMMANDS.find((command) => command.name === "presets")?.outcome, "report");
});

test("each exit name maps to its documented number", () => {
  const expected: Record<ExitCodeName, number> = {
    success: 0,
    runtime: 1,
    usage: 2,
    validation: 3,
    environment: 4,
    unsupportedRuntime: 78,
    cancelled: 130,
  };
  assert.deepEqual({ ...EXIT_CODES }, expected);
  assert.equal(exitCodeForError(ErrorCode.CC1014), EXIT_CODES.usage);
  assert.equal(exitCodeForError(ErrorCode.CC4004), EXIT_CODES.runtime);
});

test("an informational early return ends neutrally, not as a failed render", () => {
  runReport.start("render", false);
  runReport.note("5 preset(s) listed");
  const report = runReport.finish();
  assert.equal(report.ok, true);
  assert.equal(report.degraded, false);
  assert.equal(report.artifacts.length, 0);
  assert.match(runReport.summary(report), /✔ render: 5 preset\(s\) listed/);
  assert.doesNotMatch(runReport.summary(report), /no artifacts produced/);
});
