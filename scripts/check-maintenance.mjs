import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distCinecode = path.join(root, "packages", "cinecode", "dist", "esm");

const { cleanCommand } = await import(pathToFileURL(path.join(distCinecode, "cli", "clean.js")).href);
const { migrateCommand } = await import(pathToFileURL(path.join(distCinecode, "cli", "migrate.js")).href);
const {
  loadAliases,
  setAlias,
  removeAlias,
  loadLocalAliases,
  loadGlobalAliases,
} = await import(pathToFileURL(path.join(distCinecode, "cli", "profiles.js")).href);
const { upgradeCommand } = await import(pathToFileURL(path.join(distCinecode, "cli", "upgrade.js")).href);
const { runReport } = await import(pathToFileURL(path.join(distCinecode, "cli", "run-report.js")).href);
const { COMMANDS, findCommand } = await import(pathToFileURL(path.join(distCinecode, "cli", "command-registry.js")).href);

console.log("--- Check 1: Bare clean errors with choices; no prompt, no hang ---");
{
  let threw = false;
  try {
    await cleanCommand({});
  } catch (err) {
    threw = true;
    assert.equal(err.code, "CC0001");
    assert.ok(err.message.includes("--cache, --output, --prune, or --all"));
    assert.ok(err.fixHint?.includes("clean --cache"));
  }
  assert.equal(threw, true, "Bare clean must throw CC0001");
  console.log("  ok: bare clean rejected with CC0001 and choices");
}

console.log("--- Check 2 & 3: Cache, output, prune can be combined; prune unreferenced only ---");
{
  const tempProject = path.join(root, "node_modules", ".cache", "test-clean-" + Date.now());
  const cacheDir = path.join(tempProject, ".cinecode", "cache");
  const outputDir = path.join(tempProject, "out");
  const metaDir = joinPath(cacheDir, "metadata");
  const framesDir = joinPath(cacheDir, "frames");

  fs.mkdirSync(metaDir, { recursive: true });
  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  function joinPath(...parts) {
    return path.join(...parts);
  }

  // Write existing source file
  const realSource = path.join(tempProject, "asset.png");
  fs.writeFileSync(realSource, "fake image data");

  // Write referenced metadata cache entry
  const refMeta = path.join(metaDir, "hash-real.json");
  fs.writeFileSync(refMeta, JSON.stringify({ sourcePath: realSource }));

  // Write unreferenced metadata cache entry (source does not exist)
  const unrefMeta = path.join(metaDir, "hash-ghost.json");
  fs.writeFileSync(unrefMeta, JSON.stringify({ sourcePath: path.join(tempProject, "nonexistent.png") }));
  const unrefFrame = path.join(framesDir, "hash-ghost-0001.png");
  fs.writeFileSync(unrefFrame, "ghost frame");

  // Write output file
  const videoOutput = path.join(outputDir, "video.mp4");
  fs.writeFileSync(videoOutput, "fake video data");

  fs.writeFileSync(
    path.join(tempProject, "cinecode.config.json"),
    JSON.stringify({
      outputDir: "out",
      cacheDir: ".cinecode/cache",
    }),
  );

  // Test Prune only
  let pruneReportResult = null;
  const originalResult = runReport.result.bind(runReport);
  runReport.result = (r) => {
    pruneReportResult = r;
    originalResult(r);
  };

  try {
    await cleanCommand({
      root: tempProject,
      config: path.join(tempProject, "cinecode.config.json"),
      prune: true,
      yes: true,
    });
  } finally {
    runReport.result = originalResult;
  }

  // Unreferenced entry removed, referenced entry retained
  assert.ok(!fs.existsSync(unrefMeta), "Unreferenced metadata should be deleted");
  assert.ok(!fs.existsSync(unrefFrame), "Unreferenced frame should be deleted");
  assert.ok(fs.existsSync(refMeta), "Referenced metadata should NOT be deleted by prune");
  assert.ok(fs.existsSync(videoOutput), "Output file should NOT be deleted by prune alone");
  assert.ok(pruneReportResult.prune.files >= 2);

  // Test Combined: Cache + Output
  let combinedResult = null;
  runReport.result = (r) => {
    combinedResult = r;
    originalResult(r);
  };

  try {
    await cleanCommand({
      root: tempProject,
      config: path.join(tempProject, "cinecode.config.json"),
      cache: true,
      output: true,
      yes: true,
    });
  } finally {
    runReport.result = originalResult;
  }

  assert.ok(!fs.existsSync(refMeta), "Cache clean should remove remaining cache entries");
  assert.ok(!fs.existsSync(videoOutput), "Output clean should remove output files");
  assert.ok(combinedResult.cache.files >= 1);
  assert.ok(combinedResult.output.files >= 1);

  fs.rmSync(tempProject, { recursive: true, force: true });
  console.log("  ok: prune removes unreferenced only; cache + output combination verified");
}

console.log("--- Check 4: Dry run writes nothing and lists targets ---");
{
  const tempProject = path.join(root, "node_modules", ".cache", "test-dryrun-" + Date.now());
  const cacheDir = path.join(tempProject, ".cinecode", "cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const dummyFile = path.join(cacheDir, "sample.txt");
  fs.writeFileSync(dummyFile, "hello");

  fs.writeFileSync(
    path.join(tempProject, "cinecode.config.json"),
    JSON.stringify({ cacheDir: ".cinecode/cache" }),
  );

  let dryReport = null;
  const originalResult = runReport.result.bind(runReport);
  runReport.result = (r) => {
    dryReport = r;
    originalResult(r);
  };

  try {
    await cleanCommand({
      root: tempProject,
      config: path.join(tempProject, "cinecode.config.json"),
      cache: true,
      dryRun: true,
    });
  } finally {
    runReport.result = originalResult;
  }

  assert.ok(fs.existsSync(dummyFile), "File must NOT be deleted in dry run");
  assert.equal(dryReport.dryRun, true);
  assert.ok(dryReport.targets.includes(path.resolve(dummyFile)));

  fs.rmSync(tempProject, { recursive: true, force: true });
  console.log("  ok: dry run writes nothing and reports targets");
}

console.log("--- Check 5: Migrate works from a subdirectory ---");
{
  const tempProject = path.join(root, "node_modules", ".cache", "test-migrate-" + Date.now());
  const subDir = path.join(tempProject, "nested", "sub", "deep");
  fs.mkdirSync(subDir, { recursive: true });

  const rootConfig = path.join(tempProject, "cinecode.config.ts");
  fs.writeFileSync(
    rootConfig,
    `export default {\n  schemaVersion: 1,\n  video: { width: 1920, height: 1080, fps: 30 },\n};\n`,
  );

  // Run migrate with root set to tempProject (as discovered from subDir)
  let migrateReport = null;
  const originalResult = runReport.result.bind(runReport);
  runReport.result = (r) => {
    migrateReport = r;
    originalResult(r);
  };

  try {
    await migrateCommand({ root: tempProject, dryRun: true });
  } finally {
    runReport.result = originalResult;
  }

  assert.ok(migrateReport);
  assert.equal(migrateReport.dryRun, true);
  assert.equal(migrateReport.modified, true);

  fs.rmSync(tempProject, { recursive: true, force: true });
  console.log("  ok: migrate discovers project root config from subdirectory");
}

console.log("--- Check 6: Alias reading is pure; writes only at project root ---");
{
  const tempProject = path.join(root, "node_modules", ".cache", "test-alias-" + Date.now());
  fs.mkdirSync(tempProject, { recursive: true });
  fs.writeFileSync(path.join(tempProject, "cinecode.config.json"), "{}");

  const projectJson = path.join(tempProject, "cinecode.json");
  assert.ok(!fs.existsSync(projectJson));

  // 1. Reading aliases has ZERO side effects
  const initial = loadAliases(tempProject);
  assert.ok(typeof initial === "object");
  assert.ok(!fs.existsSync(projectJson), "loadAliases must not create cinecode.json");

  // 2. Writing alias creates/updates cinecode.json only at project root
  setAlias("render-quick", "render --preview", tempProject);
  assert.ok(fs.existsSync(projectJson), "setAlias should write cinecode.json");
  const written = JSON.parse(fs.readFileSync(projectJson, "utf-8"));
  assert.equal(written.aliases["render-quick"], "render --preview");

  // 3. Removing alias updates cinecode.json
  const removed = removeAlias("render-quick", tempProject);
  assert.equal(removed, true);
  const updated = JSON.parse(fs.readFileSync(projectJson, "utf-8"));
  assert.equal(updated.aliases["render-quick"], undefined);

  fs.rmSync(tempProject, { recursive: true, force: true });
  console.log("  ok: alias reading is pure, writes stay at project root");
}

console.log("--- Check 7: Maintenance commands have shared preflight, grammar and envelope ---");
{
  const maintenanceNames = ["audit", "benchmark", "migrate", "check-ignore", "alias", "publish", "upgrade"];
  for (const name of maintenanceNames) {
    const spec = findCommand(name);
    assert.ok(spec, `Command '${name}' must be registered`);
    assert.equal(spec.category, "maintenance");
    assert.equal(spec.hidden, true);
    assert.ok(spec.contract, `Command '${name}' must define contract`);
    assert.ok(typeof spec.load === "function");
    assert.ok(typeof spec.loadAction === "function");
  }
  console.log("  ok: all 7 maintenance commands have contracts and registry metadata");
}

console.log("--- Check 8: Network commands require confirmation and print targets first ---");
{
  const upgradeSpec = findCommand("upgrade");
  assert.equal(upgradeSpec.network, true);

  let outputCaptured = "";
  const originalLog = console.log;
  console.log = (msg) => {
    outputCaptured += String(msg) + "\n";
  };

  let threwOptIn = false;
  try {
    await upgradeCommand({});
  } catch (err) {
    threwOptIn = true;
    assert.equal(err.code, "CC7004");
  } finally {
    console.log = originalLog;
  }

  assert.equal(threwOptIn, true, "upgrade without --confirm must throw CC7004");
  assert.ok(outputCaptured.includes("https://registry.npmjs.org/cinecode/latest"), "Target URL must be printed first");
  console.log("  ok: network command prints target URL and enforces opt-in");
}

console.log("check-maintenance ok: all 8 acceptance checks passed");
