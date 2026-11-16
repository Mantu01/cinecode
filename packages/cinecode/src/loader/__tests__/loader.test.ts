import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UserModuleError, checkRuntime, loadUserModule } from "../index.js";

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "cinecode loader "));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content, "utf8");
  return dir;
}

test("loads a TypeScript module with erasable syntax", async () => {
  const dir = fixture({ "config.ts": "export default { width: 64 as number, name: 'tiny' };\n" });
  try {
    assert.deepEqual(await loadUserModule(join(dir, "config.ts"), dir), { width: 64, name: "tiny" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reports a missing module with its path", async () => {
  const dir = fixture({});
  try {
    await assert.rejects(loadUserModule(join(dir, "missing.ts"), dir), (error: unknown) => {
      assert.ok(error instanceof UserModuleError);
      assert.equal(error.code, "USER_MODULE_NOT_FOUND");
      assert.match(error.message, /missing\.ts/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects non-erasable TypeScript syntax with the authoring rule", async () => {
  const dir = fixture({ "config.ts": "enum Mode { A }\nexport default { mode: Mode.A };\n" });
  try {
    await assert.rejects(loadUserModule(join(dir, "config.ts"), dir), (error: unknown) => {
      assert.ok(error instanceof UserModuleError);
      assert.equal(error.code, "USER_MODULE_UNSUPPORTED_SYNTAX");
      assert.match(error.message, /erasable TypeScript syntax/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects a relative import without a file extension", async () => {
  const dir = fixture({
    "config.ts": "import { theme } from './theme';\nexport default { theme };\n",
    "theme.ts": "export const theme = 'dark';\n",
  });
  try {
    await assert.rejects(loadUserModule(join(dir, "config.ts"), dir), (error: unknown) => {
      assert.ok(error instanceof UserModuleError);
      assert.equal(error.code, "USER_MODULE_IMPORT_NOT_FOUND");
      assert.match(error.message, /name the file extension/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime check accepts the declared minimum and rejects older versions", () => {
  assert.equal(checkRuntime("v22.18.0").supported, true);
  assert.equal(checkRuntime("v22.17.1").supported, false);
  assert.equal(checkRuntime("v20.11.0").supported, false);
  assert.equal(checkRuntime().loaderMode, "native-type-stripping");
});
