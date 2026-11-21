import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ErrorCode } from "../../errors/index.js";
import { normalizeConfig, loadConfig } from "../schema.js";
import {
  containsPath,
  normalizeRoot,
  validateProjectRoots,
  validateRootFilenames,
} from "../roots.js";
import { validateConfig } from "../validator.js";

const cli = fileURLToPath(new URL("../../cli/main.js", import.meta.url));

function config(roots: Partial<Record<"sourceDir" | "mediaDir" | "outputDir" | "cacheDir", string>>) {
  return normalizeConfig({ schemaVersion: 2, project: roots });
}

function messages(roots: Parameters<typeof config>[0], root = "/project"): string[] {
  return validateProjectRoots(root, config(roots)).map((error) => error.message);
}

test("a valid four-root layout passes", () => {
  assert.deepEqual(messages({}), []);
  assert.deepEqual(
    messages({ sourceDir: "./src", mediaDir: "./media", outputDir: "./out", cacheDir: "./.cache" }),
    [],
  );
});

test("each root may not be the project root", () => {
  for (const key of ["sourceDir", "mediaDir", "outputDir", "cacheDir"] as const) {
    const found = validateProjectRoots("/project", config({ [key]: "." }));
    assert.ok(found.length >= 1, key);
    assert.equal(found[0]!.code, ErrorCode.CC1003);
    assert.match(found[0]!.message, /equals the project root/);
    assert.ok(found[0]!.message.includes(resolve("/project")));
  }
});

test("equal roots are rejected once per pair with both paths named", () => {
  const found = validateProjectRoots("/project", config({ sourceDir: "./src", mediaDir: "./src" }));
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /sourceDir\/mediaDir/);
  assert.match(found[0]!.message, /same directory/);
  assert.match(found[0]!.message, /src/);
});

test("each nesting direction is rejected", () => {
  const inside = messages({ sourceDir: "./a", mediaDir: "./a/media" });
  assert.equal(inside.length, 1);
  assert.match(inside[0]!, /nested inside source root/);

  const reverse = messages({ sourceDir: "./a/src", mediaDir: "./a" });
  assert.equal(reverse.length, 1);
  assert.match(reverse[0]!, /nested inside media root/);

  const every = validateProjectRoots(
    "/project",
    config({ sourceDir: "./a", mediaDir: "./b", outputDir: "./c", cacheDir: "./a/cache" }),
  );
  assert.equal(every.length, 1);
  assert.match(every[0]!.message, /cache root .* nested inside source root/);
});

test("case-only roots collide on case-insensitive platforms", { skip: !/^(win32|darwin)$/.test(process.platform) }, () => {
  const found = validateProjectRoots("/project", config({ sourceDir: "./Src", mediaDir: "./src" }));
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /same directory/);
});

test("trailing separators are normalized before comparison", () => {
  const found = validateProjectRoots("/project", config({ sourceDir: "./src", mediaDir: "./src/" }));
  assert.equal(found.length, 1);
  assert.equal(normalizeRoot("/project/src/"), normalizeRoot("/project/src"));
});

test("siblings sharing a name prefix are not nesting", () => {
  assert.deepEqual(
    messages({ sourceDir: "./src", mediaDir: "./src-media", outputDir: "./src-out" }),
    [],
  );
  assert.equal(containsPath("/project/src", "/project/src-media"), false);
  assert.equal(containsPath("/project/src", "/project/src/nested"), true);
});

test("filename rules still reject hostile segments", () => {
  const reserved = validateRootFilenames(config({ outputDir: "./con" }), { configPath: "cfg" });
  assert.match(reserved[0]!.message, /reserved Windows device name/);

  const trailing = validateRootFilenames(config({ cacheDir: "./cache." }), { configPath: "cfg" });
  assert.match(trailing[0]!.message, /ends with a dot/);

  const illegal = validateRootFilenames(config({ mediaDir: "./me?dia" }), { configPath: "cfg" });
  assert.match(illegal[0]!.message, /illegal on Windows/);

  const empty = validateRootFilenames(config({ sourceDir: "./src//nested" }), { configPath: "cfg" });
  assert.match(empty[0]!.message, /empty path segment/);
});

function projectWith(roots: Record<string, string>): { root: string; configPath: string } {
  const root = mkdtempSync(join(tmpdir(), "cinecode-roots-"));
  const configPath = join(root, "cinecode.config.json");
  writeFileSync(configPath, JSON.stringify({ schemaVersion: 2, project: roots }));
  mkdirSync(join(root, "src"), { recursive: true });
  return { root, configPath };
}

test("the loader rejects an invalid layout with every issue attached", async () => {
  const { root, configPath } = projectWith({ outputDir: "./out", cacheDir: "./out" });
  await assert.rejects(loadConfig(configPath, { root }), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1003);
    assert.equal(error.location.file, configPath);
    assert.equal(error.issues.length, 1);
    assert.match(error.issues[0].message, /same directory/);
    return true;
  });
});

test("the diagnostics path reports the same validation as the loader", async () => {
  const { root, configPath } = projectWith({ sourceDir: ".", mediaDir: "./media" });
  const loader = await loadConfig(configPath, { root }).then(
    () => [] as string[],
    (error: any) => error.issues.map((issue: { message: string }) => issue.message),
  );
  const validator = validateConfig(config({ sourceDir: ".", mediaDir: "./media" }), configPath, root)
    .errors.map((error) => error.message);
  assert.deepEqual(validator, loader);
  assert.ok(validator.length >= 1);
});

test("the machine document carries root errors with locations and fix hints", () => {
  const { root } = projectWith({ sourceDir: "./src", mediaDir: "./src" });
  const result = spawnSync(
    process.execPath,
    [cli, "validate", "--root", root, "--json"],
    { cwd: tmpdir(), encoding: "utf8" },
  );
  assert.equal(result.status, 3, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.error.code, ErrorCode.CC1003);
  assert.ok(report.error.issues.length >= 1);
  for (const issue of report.error.issues) {
    assert.equal(issue.location.file, join(root, "cinecode.config.json"));
    assert.ok(issue.fixHint);
  }
});
