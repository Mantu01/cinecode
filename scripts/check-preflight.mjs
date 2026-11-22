import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const distRegistry = path.join(cinecodeDir, "dist", "esm", "cli", "command-registry.js");
const distPreflight = path.join(cinecodeDir, "dist", "esm", "cli", "preflight.js");
const distProject = path.join(cinecodeDir, "dist", "esm", "config", "project.js");
const distRoots = path.join(cinecodeDir, "dist", "esm", "config", "roots.js");

if (!existsSync(distRegistry) || !existsSync(distPreflight)) {
  execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
    cwd: cinecodeDir,
    stdio: "inherit",
  });
}

const { COMMANDS } = await import(pathToFileURL(distRegistry).href);
const {
  runPreflight,
  assertWriteBoundary,
  toSerializableContext,
} = await import(pathToFileURL(distPreflight).href);
const { resolveProjectLocation } = await import(pathToFileURL(distProject).href);
const { validateProjectRoots, checkRootsWritability } = await import(pathToFileURL(distRoots).href);

let errors = 0;
function fail(msg) {
  console.error(`check-preflight error: ${msg}`);
  errors++;
}

// 1. Resolution order and boundary checks
const tmpDir = path.join(root, ".tmp-preflight-test");
try {
  rmSync(tmpDir, { recursive: true, force: true });
} catch {}
mkdirSync(tmpDir, { recursive: true });

try {
  // Test composition passed as config is rejected
  const compFile = path.join(tmpDir, "film.composition.ts");
  writeFileSync(compFile, "export default {};", "utf8");
  try {
    resolveProjectLocation({ config: compFile });
    fail("Expected composition passed as config to be rejected with CC1002");
  } catch (err) {
    if (err?.code !== "CC1002") {
      fail(`Expected CC1002 for composition as config, got: ${err?.code || err}`);
    }
  }

  // Test root derived from explicit config
  const cfgFile = path.join(tmpDir, "cinecode.config.json");
  writeFileSync(cfgFile, "{}", "utf8");
  const locFromConfig = resolveProjectLocation({ config: cfgFile });
  if (locFromConfig.root !== tmpDir || locFromConfig.source !== "config-flag") {
    fail(`Derived root mismatch: ${locFromConfig.root} vs ${tmpDir}`);
  }

  // Test non-existent root throws CC1001
  try {
    resolveProjectLocation({ root: path.join(tmpDir, "nonexistent-dir") });
    fail("Expected non-existent root to throw CC1001");
  } catch (err) {
    if (err?.code !== "CC1001") fail(`Expected CC1001 for missing root, got: ${err?.code || err}`);
  }

  // Test non-existent config throws CC1001
  try {
    resolveProjectLocation({ config: path.join(tmpDir, "missing-config.ts") });
    fail("Expected missing config to throw CC1001");
  } catch (err) {
    if (err?.code !== "CC1001") fail(`Expected CC1001 for missing config, got: ${err?.code || err}`);
  }
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}

// 2. Validate 4 roots: distinct, non-nested, inside project root
const mockConfigNested = {
  project: {
    sourceDir: "./src",
    mediaDir: "./src/media", // nested inside sourceDir!
    outputDir: "./output",
    cacheDir: ".cinecode/cache",
  },
};
const nestedErrors = validateProjectRoots("/fake/project", mockConfigNested);
if (nestedErrors.length === 0 || !nestedErrors.some((e) => e.message?.includes("nested"))) {
  fail("validateProjectRoots failed to catch nested root");
}

const mockConfigColliding = {
  project: {
    sourceDir: "./src",
    mediaDir: "./src", // colliding with sourceDir!
    outputDir: "./output",
    cacheDir: ".cinecode/cache",
  },
};
const collidingErrors = validateProjectRoots("/fake/project", mockConfigColliding);
if (collidingErrors.length === 0 || !collidingErrors.some((e) => e.message?.includes("same directory"))) {
  fail("validateProjectRoots failed to catch colliding roots");
}

// 3. Roots writability check
const writability = checkRootsWritability({
  project: root,
  source: path.join(root, "packages"),
  media: path.join(root, "packages"),
  output: path.join(root, "output"),
  cache: path.join(root, ".cinecode", "cache"),
});
if (typeof writability.output !== "boolean" || typeof writability.cache !== "boolean") {
  fail("checkRootsWritability did not return boolean writability records");
}

// 4. Central write boundary enforcement
const outDir = path.resolve(root, "output");
const cacheDir = path.resolve(root, ".cinecode/cache");
const srcDir = path.resolve(root, "src");

// Allowed in output
try {
  assertWriteBoundary(path.join(outDir, "render.mp4"), outDir, cacheDir, [], srcDir);
} catch (err) {
  fail(`Valid write inside output root failed boundary: ${err}`);
}

// Allowed in cache
try {
  assertWriteBoundary(path.join(cacheDir, "frames/0001.png"), outDir, cacheDir, [], srcDir);
} catch (err) {
  fail(`Valid write inside cache root failed boundary: ${err}`);
}

// Disallowed in source
try {
  assertWriteBoundary(path.join(srcDir, "trojan.js"), outDir, cacheDir, [], srcDir);
  fail("Write boundary failed to reject writing inside source root");
} catch (err) {
  if (err?.code !== "CC1004") fail(`Expected CC1004 for writing inside source, got: ${err?.code || err}`);
}

// Allowed with documented escape (e.g. publish destination)
const externalDir = path.resolve("/tmp/somewhere-else");
try {
  assertWriteBoundary(path.join(externalDir, "out.mp4"), outDir, cacheDir, [externalDir], srcDir);
} catch (err) {
  fail(`Documented escape destination was rejected by write boundary: ${err}`);
}

// 5. Consent gate in preflight: destructive without consent throws CC1012
const cleanCmd = COMMANDS.find((c) => c.name === "clean");
if (cleanCmd) {
  const tmpConsentDir = path.join(root, ".tmp-preflight-consent");
  try {
    mkdirSync(tmpConsentDir, { recursive: true });
    writeFileSync(path.join(tmpConsentDir, "cinecode.config.json"), "{}", "utf8");
    await runPreflight(cleanCmd, [], { root: tmpConsentDir, yes: false, force: false, interactive: false });
    fail("Expected destructive command 'clean' without consent to throw CC1012 in preflight");
  } catch (err) {
    if (err?.code !== "CC1012") {
      fail(`Expected CC1012 for 'clean' without consent, got: ${err?.code || err}`);
    }
  } finally {
    try {
      rmSync(tmpConsentDir, { recursive: true, force: true });
    } catch {}
  }
} else {
  fail("Command 'clean' not found in registry");
}

// 6. Dry run stops before action execution
let actionCalled = false;
const mockSpec = {
  name: "test-dryrun",
  summary: "test",
  category: "product",
  outcome: "artifact",
  kind: "read",
  network: false,
  destructive: false,
  hidden: true,
  requiredProject: false,
  examples: [],
  options: [{ name: "dryRun", flags: "--dry-run", description: "dry run", type: "boolean", default: false }],
  loadAction: async () => async () => {
    actionCalled = true;
  },
  load: async function () {},
};
await runPreflight(mockSpec, [], { dryRun: true });
if (actionCalled) {
  fail("Preflight dryRun failed to stop before command action execution");
}

if (errors > 0) {
  console.error(`check-preflight failed with ${errors} error(s)`);
  process.exit(1);
}

console.log("check-preflight ok: resolution order, discovery boundary, roots, write boundary, consent and dry-run verified");
