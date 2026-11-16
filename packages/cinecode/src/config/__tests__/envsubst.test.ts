import { test } from "node:test";
import assert from "node:assert/strict";
import {
  substituteEnvVars,
  substituteEnvVarsWithReport,
  substituteEnvVarsDeep,
  findMissingEnvVars,
} from "../envsubst.js";

test("resolves present variable", () => {
  assert.equal(substituteEnvVars("v=${TEST_VAR}", { env: { TEST_VAR: "hello" } }), "v=hello");
});

test("uses fallback for absent variable", () => {
  assert.equal(substituteEnvVars("${NONEXISTENT_VAR_XYZ:-fallback}"), "fallback");
});

test("throws for absent variable without fallback when onMissing is throw", () => {
  assert.throws(() => substituteEnvVars("${NONEXISTENT_VAR_XYZ}", { env: {}, onMissing: "throw" }), /NONEXISTENT_VAR_XYZ/);
});

test("replaces absent variable with empty string by default", () => {
  assert.equal(substituteEnvVars("a${NONEXISTENT_VAR_XYZ}b", { env: {} }), "ab");
});

test("keeps placeholder when onMissing is keep", () => {
  assert.equal(substituteEnvVars("${NONEXISTENT_VAR_XYZ}", { env: {}, onMissing: "keep" }), "${NONEXISTENT_VAR_XYZ}");
});

test("handles multiple variables in one string", () => {
  assert.equal(
    substituteEnvVars("${FIRST}-${SECOND}", { env: { FIRST: "a", SECOND: "b" } }),
    "a-b",
  );
});

test("empty string value triggers fallback", () => {
  assert.equal(substituteEnvVars("${EMPTY:-default}", { env: { EMPTY: "" } }), "default");
});

test("non-empty value wins over fallback", () => {
  assert.equal(substituteEnvVars("${EMPTY:-default}", { env: { EMPTY: "set" } }), "set");
});

test("report collects missing names once", () => {
  const report = substituteEnvVarsWithReport("${A}${A}${B}", { env: {} });
  assert.equal(report.value, "");
  assert.deepEqual(report.missing, ["A", "B"]);
});

test("deep substitution walks objects and arrays", () => {
  const result = substituteEnvVarsDeep(
    { list: ["${X}", { nested: "${Y:-z}" }], keep: 5 },
    { env: { X: "x" } },
  );
  assert.deepEqual(result, { list: ["x", { nested: "z" }], keep: 5 });
});

test("findMissingEnvVars ignores fallbacks", () => {
  assert.deepEqual(findMissingEnvVars("${A}${B:-ok}", { A: "1" }), []);
  assert.deepEqual(findMissingEnvVars("${A}${B}", {}), ["A", "B"]);
});
