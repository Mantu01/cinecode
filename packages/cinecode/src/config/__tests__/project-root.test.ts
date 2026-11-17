import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveProjectLocation } from "../project.js";
import { loadConfig } from "../schema.js";
import { ensureGitignoreEntries } from "../gitignore.js";
import { ErrorCode } from "../../errors/index.js";

const cli = fileURLToPath(new URL("../../cli/main.js", import.meta.url));
const BASE = join("src", "media");

function project(extra: Record<string, unknown> = {}): { root: string; config: string } {
  const root = mkdtempSync(join(tmpdir(), "cinecode-root-"));
  const config = join(root, "cinecode.config.json");
  writeFileSync(
    config,
    JSON.stringify({
      schemaVersion: 2,
      project: { sourceDir: `./${BASE}`, outputDir: "./out", cacheDir: "./.ccache" },
      video: { width: 320, height: 180, fps: 24, background: "#000000" },
      ...extra,
    }),
  );
  mkdirSync(join(root, BASE), { recursive: true });
  return { root, config };
}

function run(cwd: string, args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  return { status: result.status ?? -1, out: result.stdout, err: result.stderr };
}

test("root discovery follows explicit root, explicit config, then upward search", () => {
  const { root, config } = project();
  const nested = join(root, "a", "b");
  mkdirSync(nested, { recursive: true });

  assert.deepEqual(resolveProjectLocation({ root, cwd: tmpdir() }), {
    root,
    configPath: config,
    source: "root-flag",
  });
  assert.deepEqual(resolveProjectLocation({ config, cwd: tmpdir() }), {
    root,
    configPath: config,
    source: "config-flag",
  });
  assert.deepEqual(resolveProjectLocation({ cwd: nested }), {
    root,
    configPath: config,
    source: "discovered",
  });
  assert.throws(() => resolveProjectLocation({ cwd: mkdtempSync(join(tmpdir(), "empty-")) }), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1005);
    assert.match(error.message, /No cinecode config found/);
    return true;
  });
});

test("a nested run finds the root and writes caches there", () => {
  const { root } = project();
  const nested = join(root, "src", "media", "deep");
  mkdirSync(nested, { recursive: true });
  const fromRoot = run(root, ["media:list", "--json"]);
  const fromNested = run(nested, ["media:list", "--json"]);
  assert.equal(fromRoot.status, 0, fromRoot.err);
  assert.equal(fromNested.status, 0, fromNested.err);
  assert.ok(existsSync(join(root, ".ccache")), "cache created at the project root");
  assert.equal(existsSync(join(nested, ".ccache")), false, "no cache beside the nested cwd");

  const explicit = run(nested, ["media:list", "--json", "--root", root]);
  assert.equal(explicit.status, 0, explicit.err);
});

test("a missing project config is fatal and located", () => {
  const empty = mkdtempSync(join(tmpdir(), "cinecode-none-"));
  const result = run(empty, ["media:list"]);
  assert.notEqual(result.status, 0);
  assert.match(result.err, /\[CC1005\]/);
  assert.match(result.err, /No cinecode config found/);
});

test("a config that cannot load is fatal instead of defaulting", () => {
  const root = mkdtempSync(join(tmpdir(), "cinecode-broken-"));
  const configPath = join(root, "cinecode.config.json");
  writeFileSync(configPath, JSON.stringify({ schemaVersion: 2, render: { codec: "nope" } }));
  return assert.rejects(loadConfig(configPath), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1003);
    assert.equal(error.location.file, configPath);
    return true;
  });
});

test("an unresolved environment variable names the variable and field", async () => {
  delete process.env.CINECODE_TEST_MISSING;
  const root = mkdtempSync(join(tmpdir(), "cinecode-env-"));
  const configPath = join(root, "cinecode.config.json");
  writeFileSync(
    configPath,
    JSON.stringify({ schemaVersion: 2, project: { sourceDir: "${CINECODE_TEST_MISSING}/media" } }),
  );
  await assert.rejects(loadConfig(configPath), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1005);
    assert.match(error.message, /CINECODE_TEST_MISSING/);
    assert.match(error.message, /project\.sourceDir/);
    return true;
  });
});

test("extends cycles fail with the chain and base values merge first", async () => {
  const root = mkdtempSync(join(tmpdir(), "cinecode-extends-"));
  const a = join(root, "a.config.json");
  const b = join(root, "b.config.json");
  writeFileSync(a, JSON.stringify({ schemaVersion: 2, extends: "./b.config.json" }));
  writeFileSync(b, JSON.stringify({ schemaVersion: 2, extends: "./a.config.json" }));
  await assert.rejects(loadConfig(a), (error: any) => {
    assert.equal(error.code, ErrorCode.CC1005);
    assert.match(error.message, /Circular config inheritance/);
    assert.ok(error.message.includes(a) && error.message.includes(b), error.message);
    return true;
  });

  const base = join(root, "base.json");
  const child = join(root, "child.json");
  writeFileSync(base, JSON.stringify({ schemaVersion: 2, video: { width: 640, height: 360 } }));
  writeFileSync(child, JSON.stringify({ schemaVersion: 2, extends: "./base.json", video: { width: 800 } }));
  const config = await loadConfig(child);
  assert.equal(config.video.width, 800);
  assert.equal(config.video.height, 360);
});

test("ignore-file helpers never add an authored source root", async () => {
  const root = mkdtempSync(join(tmpdir(), "cinecode-ignore-"));
  const added = await ensureGitignoreEntries({
    sourceDir: "src",
    outputDir: "out",
    cacheDir: ".cache",
    projectRoot: root,
    enabled: true,
  });
  const content = readFileSync(resolve(root, ".gitignore"), "utf8");
  assert.deepEqual(added, ["out", ".cache"]);
  assert.match(content, /^out$/m);
  assert.match(content, /^\.cache$/m);
  assert.doesNotMatch(content, /^src$/m);

  const again = await ensureGitignoreEntries({
    sourceDir: "src",
    outputDir: "out",
    cacheDir: ".cache",
    projectRoot: root,
    enabled: true,
  });
  assert.deepEqual(again, []);
});
