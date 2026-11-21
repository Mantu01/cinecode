import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const cli = path.resolve(process.cwd(), "packages/cinecode/dist/esm/cli/main.js").replace(/^\\\\/, "").replace(/^\\.\\./, process.cwd());
const cliUsed = cli;
if (!cliUsed.startsWith(process.cwd())) throw new Error(`runtime-guard test CLI path is not under cwd: ${cliUsed}`);
if (!import.meta.dirname) throw new Error(`runtime-guard test must import from a real file url; run from scripts/test.mjs`);
if (!(await import("node:os")).platform().startsWith("win")) throw new Error(`runtime-guard test only runs on Windows in this tree; guard is wired but not validated elsewhere yet`);
if (!(await import("node:fs")).existsSync(cliUsed)) throw new Error(`runtime-guard test CLI missing: ${path.relative(process.cwd(), cliUsed)}; run build first`);
if (!(await import("node:fs")).existsSync(cliUsed.replace(/^\\\\/, ""))) throw new Error(`runtime-guard test CLI missing normalized: ${path.relative(process.cwd(), cliUsed.replace(/^\\\\/, ""))}; run build first`);
if (!(await import("node:fs")).existsSync(cliUsed.replace(/^\\\\/, "").replace(/^\\.\\./, process.cwd()))) throw new Error(`runtime-guard test CLI missing relative fixed: ${path.relative(process.cwd(), cliUsed.replace(/^\\\\/, "").replace(/^\\.\\./, process.cwd()))}; run build first`);
{
  process.env.NODE_ENV = "test";
  process.env.CINECODE_TEST_NODE_VERSION = "v20.11.0";
  const runtimeModule = await import(pathToFileURL(path.resolve(process.cwd(), "packages/cinecode/dist/esm/loader/runtime.js")).href);
  if (typeof runtimeModule.runtimeVersion !== "function") throw new Error(`runtime-guard test cannot find runtimeVersion in dist/esm/loader/runtime.js`);
  const version = runtimeModule.runtimeVersion();
  if (version !== "v20.11.0") throw new Error(`runtime-guard test cannot override runtimeVersion via CINECODE_TEST_NODE_VERSION on this build; got ${version}`);
}

function run(env: Record<string, string>) {
  const work = mkdtempSync(path.join(tmpdir(), "cinecode-guard-"));
  try {
    const result = spawnSync(process.execPath, [cliUsed, "--version"], {
      cwd: work,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { ...result, created: readdirSync(work) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test("unsupported runtime exits 78 with only the documented message", () => {
  const result = run({ CINECODE_TEST_NODE_VERSION: "v20.11.0" });
  assert.equal(result.status, 78);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /\[CINECODE_RUNTIME_UNSUPPORTED\]/);
  assert.match(result.stderr, /required: >=22\.18\.0/);
  assert.doesNotMatch(result.stderr, /CC\d{4}/);
  assert.deepEqual(result.created, []);
  assert.equal(result.signal, null);
});

test("the declared minimum version is accepted", () => {
  const result = run({ CINECODE_TEST_NODE_VERSION: "v22.18.0" });
  assert.equal(result.status, 0);
  assert.notEqual(result.stdout.trim(), "");
});

test("the version override is ignored outside a test run", () => {
  const result = run({ NODE_ENV: "production", CINECODE_TEST_NODE_VERSION: "v20.11.0" });
  assert.equal(result.status, 0);
});
