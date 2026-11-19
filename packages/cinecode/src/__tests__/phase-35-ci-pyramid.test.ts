import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(import.meta.url), "..");
const repo = resolve(here, "../../../..");

describe("Phase 35: Test pyramid and CI matrix", () => {
  it("defines CI workflow covering offline job and OS/Node matrix", () => {
    const ciPath = resolve(repo, ".github/workflows/ci.yml");
    assert.ok(existsSync(ciPath), "CI workflow file .github/workflows/ci.yml must exist");

    const content = readFileSync(ciPath, "utf-8");
    assert.ok(content.includes("ci-offline:"), "CI workflow must define an offline verification job");
    assert.ok(content.includes("ci-matrix:"), "CI workflow must define a multi-platform matrix job");
    assert.ok(content.includes("ubuntu-latest"), "CI matrix must include Ubuntu");
    assert.ok(content.includes("macos-latest"), "CI matrix must include macOS");
    assert.ok(content.includes("windows-latest"), "CI matrix must include Windows");
    assert.ok(content.includes("22.18.0"), "CI matrix must include the minimum Node engine (22.18.0)");
    assert.ok(content.includes("node scripts/verify.mjs"), "CI jobs must execute node scripts/verify.mjs");
  });

  it("provides single verification entry point in scripts/verify.mjs and root package.json", () => {
    const verifyScriptPath = resolve(repo, "scripts/verify.mjs");
    assert.ok(existsSync(verifyScriptPath), "scripts/verify.mjs must exist");

    const rootPkg = JSON.parse(readFileSync(resolve(repo, "package.json"), "utf-8"));
    assert.equal(rootPkg.scripts?.verify, "node scripts/verify.mjs", "Root package.json must wire verify script");

    const verifyContent = readFileSync(verifyScriptPath, "utf-8");
    assert.ok(verifyContent.includes("build.mjs"), "verify.mjs must build packages");
    assert.ok(verifyContent.includes("test.mjs"), "verify.mjs must run full test suite");
    assert.ok(verifyContent.includes("template-parity.test.mjs"), "verify.mjs must run template tests");
    assert.ok(verifyContent.includes("install-gate.mjs"), "verify.mjs must run install gate");
  });

  it("registers visual golden output integration tests with explicit tolerance", () => {
    const goldenTestPath = resolve(repo, "packages/cinecode/src/renderer/__tests__/golden-output.test.ts");
    assert.ok(existsSync(goldenTestPath), "golden-output.test.ts must exist");

    const content = readFileSync(goldenTestPath, "utf-8");
    assert.ok(content.includes("renders text fixture"), "Must test text visual feature");
    assert.ok(content.includes("renders linear gradient"), "Must test gradient visual feature");
    assert.ok(content.includes("renders blur effect"), "Must test blur visual feature");
    assert.ok(content.includes("renders transparent alpha"), "Must test alpha visual feature");
    assert.ok(content.includes("renders transitions monotonically"), "Must test transition visual feature");
    assert.ok(content.includes("incremental renders"), "Must test incremental motion bit parity");
    assert.ok(content.includes("renders split-screen regions"), "Must test split-screen visual feature");
  });

  it("documents test pyramid, golden tolerances, and update procedure in docs/testing.md", () => {
    const docsPath = resolve(repo, "docs/testing.md");
    assert.ok(existsSync(docsPath), "docs/testing.md must exist");

    const content = readFileSync(docsPath, "utf-8");
    assert.ok(content.includes("Test Pyramid Layers"), "Must document test layers");
    assert.ok(content.includes("Visual Golden Integration Tests"), "Must document golden tests");
    assert.ok(content.includes("Tolerances"), "Must document explicit tolerances");
    assert.ok(content.includes("Golden Update Procedure"), "Must document update procedure");
    assert.ok(content.includes("node scripts/verify.mjs"), "Must document single verification command");
  });

  it("verifies package install gate and scaffolding tests are wired and non-advisory", () => {
    const gatePath = resolve(repo, "scripts/gate/install-gate.mjs");
    const gateContent = readFileSync(gatePath, "utf-8");
    assert.ok(gateContent.includes("process.exit(failed.length === 0 ? 0 : 1)"), "Install gate must fail loudly on any check failure");

    const smokePath = resolve(repo, "packages/create-cinecode/tests/smoke.test.mjs");
    const smokeContent = readFileSync(smokePath, "utf-8");
    assert.ok(
      smokeContent.includes("fails loudly") && smokeContent.includes("result.status"),
      "Smoke test must assert failures when verification fails",
    );
  });
});
