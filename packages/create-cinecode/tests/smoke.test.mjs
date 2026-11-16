import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url)) + "/..";
const cliPath = resolve(packageRoot, "dist/esm/cli.js");

function scaffoldProject(tmp, extraArgs = []) {
  const projectPath = join(tmp, "test-project");
  const result = spawnSync(process.execPath, [cliPath, projectPath, "--ts", "--skip-install", ...extraArgs], {
    cwd: tmp,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `scaffold failed: ${result.stderr || result.stdout}`);
  return projectPath;
}

test("scaffolds a TypeScript project with package.json, config, and main entry", { timeout: 60000 }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "cinecode-e2e-"));
  try {
    const projectPath = scaffoldProject(tmp);
    assert.ok(existsSync(join(projectPath, "package.json")));
    assert.ok(existsSync(join(projectPath, "cinecode.config.ts")));
    assert.ok(existsSync(join(projectPath, "main.ts")), "scaffold must include main.ts entry");
    const pkg = JSON.parse(readFileSync(join(projectPath, "package.json"), "utf8"));
    assert.ok(pkg.scripts?.render ?? pkg.scripts?.dev, "scaffold must define run scripts");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("full E2E: install deps and render scaffolded project (skips offline)", { timeout: 300000 }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "cinecode-e2e-full-"));
  try {
    const projectPath = scaffoldProject(tmp);
    const install = spawnSync("pnpm", ["install"], { cwd: projectPath, encoding: "utf8" });
    if (install.status !== 0) {
      return test.skip(`pnpm install unavailable/offline: ${install.stderr?.slice(0, 200)}`);
    }
    const render = spawnSync("pnpm", ["run", "render"], { cwd: projectPath, encoding: "utf8", timeout: 240000 });
    assert.equal(render.status, 0, `render failed: ${render.stderr || render.stdout}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
