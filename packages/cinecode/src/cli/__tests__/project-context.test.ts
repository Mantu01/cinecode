import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveProjectLocation } from "../../config/project.js";
import { ErrorCode } from "../../errors/index.js";
import { loadProjectContext } from "../resolve/project-context.js";
import { renderSync } from "../../api/render.js";

const cli = fileURLToPath(new URL("../main.js", import.meta.url));

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "cinecode-context-"));
  writeFileSync(
    join(root, "cinecode.config.json"),
    JSON.stringify({
      schemaVersion: 2,
      project: { entry: "./comp.ts", sourceDir: "./src", mediaDir: "./media", outputDir: "./out", cacheDir: "./.ccache" },
      video: { width: 32, height: 32, fps: 1 },
    }),
  );
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "media"), { recursive: true });
  writeFileSync(
    join(root, "comp.ts"),
    'export default { name: "probe", width: 32, height: 32, fps: 1, duration: 1, rootTimeline: { tracks: [] } };\n',
  );
  return root;
}

function snapshot(dir: string): string[] {
  return readdirSync(dir).sort();
}

test("context resolves config paths against the root, not the config folder", async () => {
  const root = mkdtempSync(join(tmpdir(), "cinecode-config-path-"));
  mkdirSync(join(root, "configs"), { recursive: true });
  writeFileSync(
    join(root, "configs", "cinecode.config.json"),
    JSON.stringify({ schemaVersion: 2, project: { sourceDir: "./src", mediaDir: "./media", outputDir: "./out", cacheDir: "./cache" } }),
  );
  const context = await loadProjectContext({ root, config: "configs/cinecode.config.json" });
  assert.equal(context.root, root);
  assert.equal(context.configPath, join(root, "configs", "cinecode.config.json"));
  assert.equal(context.roots.source, join(root, "src"));
  assert.equal(context.roots.media, join(root, "media"));
  assert.equal(context.roots.output, join(root, "out"));
  assert.equal(context.roots.cache, join(root, "cache"));
});

test("discovery never crosses a project marker into a parent project", () => {
  const parent = mkdtempSync(join(tmpdir(), "cinecode-parent-"));
  writeFileSync(join(parent, "cinecode.config.json"), JSON.stringify({ schemaVersion: 2 }));
  const projectRoot = join(parent, "child");
  const nested = join(projectRoot, "deep", "dir");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "child", private: true }));
  assert.throws(
    () => resolveProjectLocation({ cwd: nested }),
    (error: any) => {
      assert.equal(error.code, ErrorCode.CC1005);
      assert.match(error.fixHint, /never searches parent projects/);
      return true;
    },
  );
});

test("a still render from two cwds writes under the root and leaves both cwds untouched", () => {
  const root = project();
  const outsideA = mkdtempSync(join(tmpdir(), "cinecode-cwd-a-"));
  const outsideB = mkdtempSync(join(tmpdir(), "cinecode-cwd-b-"));
  const beforeA = snapshot(outsideA);
  const beforeB = snapshot(outsideB);

  for (const cwd of [outsideA, outsideB]) {
    const result = spawnSync(
      process.execPath,
      [cli, "still", "--root", root, "--file", "comp.ts", "--frame", "0", "--format", "png", "--json"],
      { cwd, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  }

  assert.deepEqual(snapshot(outsideA), beforeA);
  assert.deepEqual(snapshot(outsideB), beforeB);
  assert.equal(existsSync(join(root, "out", "images", "probe.png")), true);
  assert.equal(existsSync(join(root, "src", "probe.png")), false);
});

test("the programmatic API resolves the same output path as the CLI", async () => {
  const root = project();
  const dryRun = spawnSync(
    process.execPath,
    [cli, "render", "--root", root, "--file", "comp.ts", "--dry-run", "--json"],
    { cwd: mkdtempSync(join(tmpdir(), "cinecode-api-cwd-")), encoding: "utf8" },
  );
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const report = JSON.parse(dryRun.stdout);
  const cliPath = report.result.explain.parameters.outputPath.value;

  const result = await renderSync({
    root,
    entry: "comp.ts",
    overwrite: true,
    fresh: true,
    noCache: true,
    quality: "final",
    chunkSize: 1,
  });
  assert.equal(resolve(result.outputPath), resolve(cliPath));
  assert.ok(result.outputPath.startsWith(join(root, "out")));
});
