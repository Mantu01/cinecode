import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const distSchema = path.join(cinecodeDir, "dist", "esm", "config", "schema.js");
const distDefine = path.join(cinecodeDir, "dist", "esm", "core", "define", "definitions.js");
const distProject = path.join(cinecodeDir, "dist", "esm", "config", "project.js");
const distValidator = path.join(cinecodeDir, "dist", "esm", "config", "validator.js");
const distMain = path.join(cinecodeDir, "dist", "esm", "index.js");

if (!existsSync(distSchema) || !existsSync(distDefine) || !existsSync(distMain)) {
  execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
    cwd: cinecodeDir,
    stdio: "inherit",
  });
}

const { loadConfigDocument } = await import(pathToFileURL(distSchema).href);
const { defineConfig } = await import(pathToFileURL(distDefine).href);
const { findConfigUpwardDetailed } = await import(pathToFileURL(distProject).href);
const { configValidationCounts } = await import(pathToFileURL(distValidator).href);
const mainExports = await import(pathToFileURL(distMain).href);

let errors = 0;
function fail(msg) {
  console.error(`check-config-load error: ${msg}`);
  errors++;
}

const tmpDir = path.join(root, ".test_phase11_tmp");
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

try {
  // 1. Verify dead hot-swap tracker is deleted and not exported
  if ("ConfigDependencyTracker" in mainExports) {
    fail("ConfigDependencyTracker must not be exported from public surface");
  }
  const hotSwapFile = path.join(cinecodeDir, "src", "config", "hot-swap.ts");
  if (existsSync(hotSwapFile)) {
    fail("hot-swap.ts must be deleted");
  }
  const validatedFile = path.join(cinecodeDir, "src", "config", "validated.ts");
  if (existsSync(validatedFile)) {
    fail("validated.ts must be deleted");
  }

  // 2. Verify discovery boundary: does not cross package.json marker
  const boundaryProj = path.join(tmpDir, "proj");
  const subDir = path.join(boundaryProj, "nested", "sub");
  mkdirSync(subDir, { recursive: true });
  writeFileSync(path.join(boundaryProj, "package.json"), "{}");
  const discoveryResult = findConfigUpwardDetailed(subDir);
  if (discoveryResult.configPath !== null) {
    fail("Discovery should not find a config when none exists below boundary marker");
  }
  // Searched dirs must not include parent of boundaryProj
  const parentOfBoundary = path.dirname(boundaryProj);
  if (discoveryResult.searched.includes(parentOfBoundary)) {
    fail(`Discovery searched above project boundary marker: ${parentOfBoundary}`);
  }

  // 3. Verify inheritance boundary: extends targeting outside boundary or absolute path throws CC1005
  const boundaryConfigDir = path.join(boundaryProj, "configs");
  mkdirSync(boundaryConfigDir, { recursive: true });
  const escapeConfig = path.join(boundaryConfigDir, "cinecode.config.json");
  writeFileSync(escapeConfig, JSON.stringify({
    schemaVersion: 2,
    extends: "../../outside.json",
  }));
  try {
    await loadConfigDocument(escapeConfig, { root: boundaryProj });
    fail("Expected extends outside boundary to throw CC1005");
  } catch (err) {
    if (err?.code !== "CC1005" && !String(err).includes("CC1005")) {
      fail(`Expected CC1005 for extends outside boundary, got: ${err}`);
    }
  }

  const absConfig = path.join(boundaryConfigDir, "abs.config.json");
  writeFileSync(absConfig, JSON.stringify({
    schemaVersion: 2,
    extends: "C:\\base.json",
  }));
  try {
    await loadConfigDocument(absConfig, { root: boundaryProj });
    fail("Expected absolute extends to throw CC1005");
  } catch (err) {
    if (err?.code !== "CC1005" && !String(err).includes("CC1005")) {
      fail(`Expected CC1005 for absolute extends, got: ${err}`);
    }
  }

  // 4. Verify undocumented cinecode.base.json probe is gone
  const baseProbeDir = path.join(tmpDir, "base_probe");
  mkdirSync(baseProbeDir, { recursive: true });
  writeFileSync(path.join(baseProbeDir, "package.json"), "{}");
  writeFileSync(path.join(baseProbeDir, "cinecode.base.json"), JSON.stringify({
    schemaVersion: 2,
    video: { width: 444 },
  }));
  const baseChild = path.join(baseProbeDir, "cinecode.config.json");
  writeFileSync(baseChild, JSON.stringify({
    schemaVersion: 2,
    // Note: no extends field declared
    video: { height: 720 },
  }));
  const loadedWithoutExtends = await loadConfigDocument(baseChild, { root: baseProbeDir });
  if (loadedWithoutExtends.config.video.width === 444) {
    fail("Undocumented cinecode.base.json must not be loaded when extends is not declared");
  }

  // 5. Verify schema version handling: v1 migrated in-memory to v2
  const v1Config = path.join(tmpDir, "v1.config.json");
  writeFileSync(v1Config, JSON.stringify({
    schemaVersion: 1,
    fps: 24,
    width: 1280,
    height: 720,
    entry: "./main.ts",
  }));
  const loadedV1 = await loadConfigDocument(v1Config, { root: tmpDir });
  if (loadedV1.config.schemaVersion !== 2) {
    fail(`Expected v1 to migrate to schemaVersion 2, got ${loadedV1.config.schemaVersion}`);
  }
  if (loadedV1.config.video.fps !== 24 || loadedV1.config.video.width !== 1280) {
    fail("Expected v1 top-level fields to be migrated into video.*");
  }

  // Schema version 3 rejected with CC1004
  const v3Config = path.join(tmpDir, "v3.config.json");
  writeFileSync(v3Config, JSON.stringify({
    schemaVersion: 3,
  }));
  try {
    await loadConfigDocument(v3Config, { root: tmpDir });
    fail("Expected schemaVersion 3 to throw CC1004");
  } catch (err) {
    if (err?.code !== "CC1004" && !String(err).includes("CC1004")) {
      fail(`Expected CC1004 for schemaVersion 3, got: ${err}`);
    }
  }

  // 6. Verify config-as-composition yields CC1002 from both defineConfig and loadConfigDocument
  try {
    defineConfig({
      rootTimeline: { tracks: [] },
    });
    fail("Expected defineConfig with rootTimeline to throw CC1002");
  } catch (err) {
    if (err?.code !== "CC1002" && !String(err).includes("CC1002")) {
      fail(`Expected CC1002 from defineConfig(composition), got: ${err}`);
    }
  }

  const compConfig = path.join(tmpDir, "comp.config.json");
  writeFileSync(compConfig, JSON.stringify({
    width: 1920,
    height: 1080,
    rootTimeline: { tracks: [] },
  }));
  try {
    await loadConfigDocument(compConfig, { root: tmpDir });
    fail("Expected loadConfigDocument with rootTimeline to throw CC1002");
  } catch (err) {
    if (err?.code !== "CC1002" && !String(err).includes("CC1002")) {
      fail(`Expected CC1002 from loadConfigDocument(composition), got: ${err}`);
    }
  }

  // 7. Verify conflicting aliases fail with CC1002
  const conflictConfig = path.join(tmpDir, "conflict.config.json");
  writeFileSync(conflictConfig, JSON.stringify({
    schemaVersion: 2,
    entry: "./alpha.ts",
    project: {
      entry: "./beta.ts",
    },
  }));
  try {
    await loadConfigDocument(conflictConfig, { root: tmpDir });
    fail("Expected conflicting entry vs project.entry to throw CC1002");
  } catch (err) {
    if (err?.code !== "CC1002" && !String(err).includes("CC1002")) {
      fail(`Expected CC1002 for conflicting aliases, got: ${err}`);
    }
  }

  // Matching aliases normalize cleanly
  const matchingConfig = path.join(tmpDir, "matching.config.json");
  writeFileSync(matchingConfig, JSON.stringify({
    schemaVersion: 2,
    entry: "./main.ts",
    project: {
      entry: "./main.ts",
    },
  }));
  const loadedMatching = await loadConfigDocument(matchingConfig, { root: tmpDir });
  if (loadedMatching.config.project.entry !== "./main.ts") {
    fail("Matching aliases should normalize cleanly");
  }

  // 8. Verify unknown key produces nearest-key hint
  const typoConfig = path.join(tmpDir, "typo.config.json");
  writeFileSync(typoConfig, JSON.stringify({
    schemaVersion: 2,
    render: {
      formatt: "mp4",
    },
  }));
  try {
    await loadConfigDocument(typoConfig, { root: tmpDir });
    fail("Expected typo in render.format to throw CC1002");
  } catch (err) {
    if (err?.code !== "CC1002" && !String(err).includes("CC1002")) {
      fail(`Expected CC1002 for unrecognized key, got: ${err}`);
    }
    if (!String(err).includes("format")) {
      fail(`Expected nearest-key hint 'format' in error, got: ${err}`);
    }
  }

  // 9. Verify resolution trace exists for every field
  const validConfig = path.join(tmpDir, "valid.config.json");
  writeFileSync(validConfig, JSON.stringify({
    schemaVersion: 2,
    video: {
      width: 1280,
    },
  }));
  const loadedValid = await loadConfigDocument(validConfig, { root: tmpDir });
  if (!loadedValid.trace || loadedValid.trace.size === 0) {
    fail("Expected resolution trace to be recorded on LoadedConfig");
  }
  const widthTrace = loadedValid.trace.get("video.width");
  if (!widthTrace || widthTrace.source !== "explicit" || widthTrace.value !== 1280) {
    fail(`Expected explicit trace for video.width, got: ${JSON.stringify(widthTrace)}`);
  }
  const fpsTrace = loadedValid.trace.get("video.fps");
  if (!fpsTrace || fpsTrace.source !== "default") {
    fail(`Expected default trace for video.fps, got: ${JSON.stringify(fpsTrace)}`);
  }

  // 10. Verify validated object is frozen
  if (!Object.isFrozen(loadedValid.config)) {
    fail("Expected normalized config to be frozen");
  }
  if (!Object.isFrozen(loadedValid.config.video)) {
    fail("Expected config.video to be frozen");
  }

} finally {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (errors > 0) {
  console.error(`check-config-load failed with ${errors} error(s).`);
  process.exit(1);
} else {
  console.log("check-config-load passed cleanly.");
}
