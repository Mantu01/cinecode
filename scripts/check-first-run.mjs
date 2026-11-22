import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const createCinecodeDir = path.join(root, "packages", "create-cinecode");
const distCli = path.join(cinecodeDir, "dist", "esm", "cli", "main.js");
const createDistCli = path.join(createCinecodeDir, "dist", "esm", "cli.js");

const tempRoot = mkdtempSync(path.join(root, ".tmp-check-first-run-"));

const isWin = process.platform === "win32";
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const npmBin = isWin && existsSync(npmCli) ? process.execPath : (isWin ? "npm.cmd" : "npm");
const npmBaseArgs = isWin && existsSync(npmCli) ? [npmCli] : [];

try {
  // 1. Packed install scaffolds successfully outside the monorepo
  const localCache = path.join(tempRoot, "npm-cache");
  const packOutput = execFileSync(npmBin, [...npmBaseArgs, "pack", "--json", "--cache", localCache], {
    cwd: createCinecodeDir,
    encoding: "utf8",
  });
  const packReport = JSON.parse(packOutput.slice(packOutput.indexOf("[")));
  const tarballName = packReport[0].filename;
  const tarballPath = path.join(createCinecodeDir, tarballName);
  assert.ok(existsSync(tarballPath), "Packed tarball exists");

  const isolatedOutsideDir = path.join(tempRoot, "isolated-install");
  mkdirSync(isolatedOutsideDir, { recursive: true });

  // Unpack tarball into isolated outside dir
  execFileSync("tar", ["-xzf", tarballPath, "-C", isolatedOutsideDir]);
  rmSync(tarballPath, { force: true });

  const unpackedCli = path.join(isolatedOutsideDir, "package", "dist", "esm", "cli.js");
  assert.ok(existsSync(unpackedCli), "Unpacked CLI exists in isolated directory");

  // Provide dependency resolution for unpacked package
  const sourceNodeModules = path.join(createCinecodeDir, "node_modules");
  if (existsSync(sourceNodeModules)) {
    const { cpSync } = await import("node:fs");
    cpSync(sourceNodeModules, path.join(isolatedOutsideDir, "package", "node_modules"), { recursive: true, dereference: true });
  }

  const scaffoldTargetOutside = path.join(tempRoot, "outside-project");
  execFileSync(process.execPath, [unpackedCli, scaffoldTargetOutside, "--ts", "--skip-install", "--no-git"], {
    cwd: tempRoot,
    stdio: "pipe",
  });
  assert.ok(existsSync(path.join(scaffoldTargetOutside, "cinecode.config.ts")), "Scaffolded config exists outside monorepo");

  // 2. Generated framework dependency is the framework range, not the scaffolder version
  const outsidePkg = JSON.parse(readFileSync(path.join(scaffoldTargetOutside, "package.json"), "utf8"));
  assert.equal(outsidePkg.dependencies?.cinecode, "^1.0.0", "cinecode dependency must be framework range ^1.0.0");

  // 3. Init asks questions on a TTY and runs fully non-interactive with yes
  const nonInteractiveTarget = path.join(tempRoot, "non-interactive-project");
  execFileSync(process.execPath, [distCli, "init", nonInteractiveTarget, "--yes", "--skip-install", "--no-git"], {
    cwd: tempRoot,
    stdio: "pipe",
    env: { ...process.env, CINECODE_SCAFFOLD_BIN: createDistCli },
  });
  assert.ok(existsSync(path.join(nonInteractiveTarget, "cinecode.config.ts")), "Non-interactive project created");

  // 4. Non-empty targets and nested projects are refused with codes (CC1003)
  const nonEmptyTarget = path.join(tempRoot, "non-empty-dir");
  mkdirSync(nonEmptyTarget, { recursive: true });
  writeFileSync(path.join(nonEmptyTarget, "blocking.txt"), "hello");

  let threwNonEmpty = false;
  try {
    execFileSync(process.execPath, [distCli, "init", nonEmptyTarget, "--yes", "--skip-install", "--no-git"], {
      cwd: tempRoot,
      stdio: "pipe",
      env: { ...process.env, CINECODE_SCAFFOLD_BIN: createDistCli },
    });
  } catch (err) {
    threwNonEmpty = true;
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    const stdout = err.stdout ? err.stdout.toString() : "";
    const combined = stderr + stdout;
    assert.ok(combined.includes("CC1003"), `Expected CC1003 for non-empty target, got: ${combined}`);
  }
  assert.ok(threwNonEmpty, "Scaffolding into non-empty directory must throw");

  const nestedTarget = path.join(nonInteractiveTarget, "nested-subproject");
  let threwNested = false;
  try {
    execFileSync(process.execPath, [distCli, "init", nestedTarget, "--yes", "--skip-install", "--no-git"], {
      cwd: tempRoot,
      stdio: "pipe",
      env: { ...process.env, CINECODE_SCAFFOLD_BIN: createDistCli },
    });
  } catch (err) {
    threwNested = true;
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    const stdout = err.stdout ? err.stdout.toString() : "";
    const combined = stderr + stdout;
    assert.ok(combined.includes("CC1003"), `Expected CC1003 for nested target, got: ${combined}`);
  }
  assert.ok(threwNested, "Scaffolding inside existing project must throw CC1003");

  // 5. Exact documented file set is written; scripts match the readme
  function getRelativeFiles(dir, prefix = "") {
    const results = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...getRelativeFiles(path.join(dir, entry.name), rel));
      } else {
        results.push(rel);
      }
    }
    return results.sort();
  }

  const actualFiles = getRelativeFiles(nonInteractiveTarget);
  const expectedFiles = [
    ".gitignore",
    "cinecode.config.ts",
    "main.ts",
    "media/README.md",
    "output/.gitkeep",
    "package.json",
    "README.md",
    "src/scenes/intro.ts",
    "tsconfig.json",
  ].sort();
  assert.deepEqual(actualFiles, expectedFiles, "Scaffolded file set must match exact documented list");

  const projectPkg = JSON.parse(readFileSync(path.join(nonInteractiveTarget, "package.json"), "utf8"));
  const expectedScripts = [
    "dev",
    "preview",
    "render",
    "render:all",
    "still",
    "validate",
    "clean",
    "typecheck",
  ].sort();
  const actualScripts = Object.keys(projectPkg.scripts ?? {}).sort();
  assert.deepEqual(actualScripts, expectedScripts, "Package scripts must match small documented set");

  const readmeContent = readFileSync(path.join(nonInteractiveTarget, "README.md"), "utf8");
  for (const script of expectedScripts) {
    const cmdPattern = `npm run ${script}`;
    assert.ok(readmeContent.includes(cmdPattern), `README.md must document '${cmdPattern}'`);
  }

  // 6. Scaffolded project validates and renders its first artifact with no extra flags
  const projNodeModules = path.join(nonInteractiveTarget, "node_modules");
  const cinecodeModuleDir = path.join(projNodeModules, "cinecode");
  mkdirSync(cinecodeModuleDir, { recursive: true });
  writeFileSync(
    path.join(cinecodeModuleDir, "package.json"),
    JSON.stringify({
      name: "cinecode",
      version: "1.0.0",
      type: "module",
      exports: {
        ".": "./index.js",
      },
    }),
  );
  writeFileSync(
    path.join(cinecodeModuleDir, "index.js"),
    `export * from ${JSON.stringify(pathToFileURL(path.join(cinecodeDir, "dist", "esm", "index.js")).href)};\n`,
  );

  const validateOutput = execFileSync(process.execPath, [distCli, "validate", "--config", path.join(nonInteractiveTarget, "cinecode.config.ts"), "--json"], {
    cwd: nonInteractiveTarget,
    encoding: "utf8",
  });
  const validateResult = JSON.parse(validateOutput);
  assert.equal(validateResult.ok, true, "Scaffolded project must validate with ok: true");
  assert.equal(validateResult.result?.valid, true, "Scaffolded project validation result must be valid");

  const renderOutput = execFileSync(process.execPath, [distCli, "render", "--config", path.join(nonInteractiveTarget, "cinecode.config.ts"), "--dry-run", "--json"], {
    cwd: nonInteractiveTarget,
    encoding: "utf8",
  });
  const renderResult = JSON.parse(renderOutput);
  assert.equal(renderResult.ok, true, "Bare render must succeed with ok: true");
  assert.equal(renderResult.result?.targets?.length, 1, "Bare render must target 1 item");

  // 7. The prebuilt composition library is gone
  assert.equal(existsSync(path.join(cinecodeDir, "src", "templates")), false, "Prebuilt composition library must be deleted");

  // 8. Readme claims match the generated project
  assert.ok(readmeContent.includes("src/scenes/"), "Readme documents src/scenes/");
  assert.ok(readmeContent.includes("media/"), "Readme documents media/");
  assert.ok(readmeContent.includes("output/"), "Readme documents output/");
  assert.ok(readmeContent.includes(".cinecode/"), "Readme documents .cinecode/");
  assert.ok(!readmeContent.includes("example"), "Readme must not reference missing example project");

  console.log("check-first-run: all acceptance checks passed");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
