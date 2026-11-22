import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const distManifest = path.join(cinecodeDir, "dist", "esm", "manifest", "index.js");
const distDefine = path.join(cinecodeDir, "dist", "esm", "core", "define", "definitions.js");
const distContract = path.join(cinecodeDir, "dist", "esm", "manifest", "contract.js");
const distIds = path.join(cinecodeDir, "dist", "esm", "manifest", "ids.js");
const distZod = path.join(cinecodeDir, "dist", "esm", "config", "zod-schema.js");
const distValidation = path.join(cinecodeDir, "dist", "esm", "manifest", "validation.js");
const distReferences = path.join(cinecodeDir, "dist", "esm", "manifest", "references.js");

if (!existsSync(distManifest) || !existsSync(distDefine)) {
  execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
    cwd: cinecodeDir,
    stdio: "inherit",
  });
}

const { loadManifestProject, findEntry, assertSelectorId, normalizeManifest } = await import(pathToFileURL(distManifest).href);
const { defineMain } = await import(pathToFileURL(distDefine).href);
const { assertMainContract, describeShape, deepFreezeManifest } = await import(pathToFileURL(distContract).href);
const { idRule, asManifestId, validateManifestIds } = await import(pathToFileURL(distIds).href);
const { validateManifestShape } = await import(pathToFileURL(distZod).href);
const { validateManifestDocument } = await import(pathToFileURL(distValidation).href);
const { buildReferenceGraph, referenceWarnings } = await import(pathToFileURL(distReferences).href);

let errors = 0;
function fail(msg) {
  console.error(`check-manifest-contract error: ${msg}`);
  errors++;
}

const tmpDir = path.join(root, ".test_phase12_tmp");
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

try {
  // 1. Raw composition, promise, function, and named-only exports are rejected with CC1010
  try {
    assertMainContract({ rootTimeline: { tracks: [] } }, "main.ts");
    fail("Raw composition should be rejected by assertMainContract");
  } catch (err) {
    if (err?.code !== "CC1010" || !err.message.includes("composition")) {
      fail(`Expected CC1010 naming composition, got: ${err}`);
    }
    if (!err?.fixHint || !err.fixHint.includes("defineMain")) {
      fail(`Expected fixHint mentioning defineMain, got: ${err?.fixHint}`);
    }
  }

  try {
    assertMainContract(Promise.resolve({}), "main.ts");
    fail("Promise export should be rejected by assertMainContract");
  } catch (err) {
    if (err?.code !== "CC1010" || !err.message.includes("promise")) {
      fail(`Expected CC1010 naming promise, got: ${err}`);
    }
  }

  try {
    assertMainContract(() => ({ tracks: [] }), "main.ts");
    fail("Function export should be rejected by assertMainContract");
  } catch (err) {
    if (err?.code !== "CC1010" || !err.message.includes("function")) {
      fail(`Expected CC1010 naming function, got: ${err}`);
    }
  }

  // 2. Freeze manifest at definition time: manifest, collections, entries frozen
  const def = defineMain({
    scenes: [{ id: "intro", file: "./scene.ts" }],
    timelines: [{ id: "main", sceneRefs: ["intro"] }],
  });
  if (!Object.isFrozen(def)) fail("defineMain result must be frozen");
  if (!Object.isFrozen(def.scenes)) fail("defineMain scenes array must be frozen");
  if (!Object.isFrozen(def.scenes[0])) fail("defineMain scene entry must be frozen");
  try {
    // Attempt mutation
    def.scenes[0].id = "mutated";
    fail("Mutation of frozen manifest entry should throw in strict mode");
  } catch {
    // Expected mutation failure
  }

  // 3. One id rule everywhere: non-conforming id fails at definition time
  try {
    defineMain({
      scenes: [{ id: "a/b", file: "./scene.ts" }],
    });
    fail("Hostile id 'a/b' in defineMain should fail at definition time");
  } catch (err) {
    if (err?.code !== "CC1010" || !err.message.includes("path separator")) {
      fail(`Expected CC1010 for hostile id in defineMain, got: ${err}`);
    }
  }

  // Duplicate id across collections fails at definition time
  try {
    defineMain({
      scenes: [{ id: "Hero", file: "./s.ts" }],
      timelines: [{ id: "hero", sceneRefs: ["Hero"] }],
    });
    fail("Case-insensitive duplicate id should fail at definition time");
  } catch (err) {
    if (err?.code !== "CC1010" || !err.message.includes("duplicate id")) {
      fail(`Expected CC1010 for duplicate id in defineMain, got: ${err}`);
    }
  }

  // 4. Remove case split: lookup, duplicate detection, reference resolution use normalized key
  const entries = [{ id: "Scene-Hero", file: "./s.ts" }];
  const found = findEntry(entries, "scene-hero", "scene");
  if (found?.id !== "Scene-Hero") {
    fail(`findEntry case-insensitive lookup failed, got: ${JSON.stringify(found)}`);
  }

  const refGraph = buildReferenceGraph({
    timelines: [{ id: "Main", sceneRefs: ["scene-hero"], audioRef: ["bed-track"] }],
  });
  if (!refGraph.scenes.has("scene-hero")) {
    fail("Reference graph should record scene references normalized");
  }
  if (!refGraph.audio.has("bed-track")) {
    fail("Reference graph should record audio references normalized");
  }

  const warnings = referenceWarnings({
    timelines: [{ id: "Main", sceneRefs: ["scene-hero"], audioRef: ["bed-track"] }],
    scenes: [{ id: "Scene-Hero", file: "./s.ts" }],
    audio: [{ id: "Bed-Track", file: "./a.ts" }],
  });
  const deadWarnings = warnings.filter((w) => w.code === "CC3009");
  if (deadWarnings.length !== 0) {
    fail(`Dead asset false positives due to case mismatch: ${JSON.stringify(deadWarnings)}`);
  }

  // 5. Reserved collections: characters/motions rejected by schema
  const reservedResult = validateManifestShape({
    characters: [{ id: "c1" }],
  });
  if (reservedResult.valid) {
    fail("validateManifestShape should reject non-empty reserved collection 'characters'");
  }
  const hasReservedIssue = reservedResult.errors.some((e) => e.message.includes("characters") && e.message.includes("reserved"));
  if (!hasReservedIssue) {
    fail(`Expected reserved characters issue from schema, got: ${JSON.stringify(reservedResult.errors)}`);
  }

  // 6. File reference escape and missing export reported with owning entry id
  const projectDir = path.join(tmpDir, "files_proj");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(path.join(projectDir, "package.json"), '{"type": "module"}\n');
  writeFileSync(path.join(projectDir, "main.ts"), "export default { scenes: [] };\n");
  writeFileSync(path.join(projectDir, "bad-export.ts"), "export default { kind: 'image' };\n");

  const valResult = await validateManifestDocument(
    {
      scenes: [
        { id: "s-escape", file: "../outside.ts" },
        { id: "s-missing", file: "./nonexistent.ts" },
        { id: "s-bad", file: "./bad-export.ts" },
      ],
    },
    {
      rootDir: projectDir,
      manifestPath: path.join(projectDir, "main.ts"),
      config: { schemaVersion: 2, video: { fps: 30 } },
    },
  );

  const escapeErr = valResult.errors.find((e) => e.code === "CC1003");
  if (!escapeErr || !escapeErr.message.includes("s-escape")) {
    fail(`Expected CC1003 naming s-escape, got: ${escapeErr?.message}`);
  }

  const missingErr = valResult.errors.find((e) => e.code === "CC1009");
  if (!missingErr || !missingErr.message.includes("s-missing")) {
    fail(`Expected CC1009 naming s-missing, got: ${missingErr?.message}`);
  }

  const exportErr = valResult.errors.find((e) => e.code === "CC3008");
  if (!exportErr || !exportErr.message.includes("s-bad")) {
    fail(`Expected CC3008 naming s-bad, got: ${exportErr?.message}`);
  }

  // 7. Non-determinism check at module scope fails with CC3005
  writeFileSync(path.join(projectDir, "clock.ts"), "const now = Date.now();\nexport default { tracks: [] };\n");
  const clockResult = await validateManifestDocument(
    { scenes: [{ id: "s-clock", file: "./clock.ts" }] },
    {
      rootDir: projectDir,
      manifestPath: path.join(projectDir, "main.ts"),
      config: { schemaVersion: 2, video: { fps: 30 } },
    },
  );
  const nonDetErr = clockResult.errors.find((e) => e.code === "CC3005");
  if (!nonDetErr || !nonDetErr.message.includes("Date.now")) {
    fail(`Expected CC3005 for Date.now, got: ${JSON.stringify(clockResult.errors)}`);
  }

  // 8. Branded id types at manifest boundary
  const validId = asManifestId("valid-id_1");
  if (typeof validId !== "string" || validId !== "valid-id_1") {
    fail(`asManifestId returned invalid value: ${validId}`);
  }
  try {
    asManifestId("invalid/id");
    fail("asManifestId should throw for hostile id");
  } catch (err) {
    if (err?.code !== "CC1003") fail(`Expected CC1003 from asManifestId, got: ${err}`);
  }

  const selectorId = assertSelectorId("scene", "safe-selector");
  if (selectorId !== "safe-selector") fail(`assertSelectorId returned invalid id: ${selectorId}`);

  // 9. Lazy manifest loading: loadManifestProject does not eagerly evaluate scene modules
  const lazyProj = path.join(tmpDir, "lazy_proj");
  mkdirSync(lazyProj, { recursive: true });
  writeFileSync(path.join(lazyProj, "package.json"), '{"type": "module"}\n');
  writeFileSync(
    path.join(lazyProj, "main.ts"),
    `import { defineMain } from "${pathToFileURL(distDefine).href}";\nexport default defineMain({ scenes: [{ id: "s1", file: "./scene.ts" }] });\n`,
  );
  writeFileSync(
    path.join(lazyProj, "scene.ts"),
    "globalThis.__LAZY_EVALUATED = true;\nexport default { tracks: [] };\n",
  );
  globalThis.__LAZY_EVALUATED = false;
  const loadedProject = await loadManifestProject({ schemaVersion: 2 }, lazyProj);
  if (globalThis.__LAZY_EVALUATED) {
    fail("loadManifestProject eagerly evaluated scene module; must remain lazy");
  }
  if (!loadedProject.manifest.scenes || loadedProject.manifest.scenes[0]?.id !== "s1") {
    fail("loadManifestProject did not return normalized manifest");
  }

  // 10. Multi-violation reporting in one pass
  const multiErrors = validateManifestIds([
    { kind: "image", entries: [{ id: "bad/one" }, { id: "ok-id" }, { id: "bad*two" }] },
    { kind: "audio", entries: [{ id: "NUL" }] },
  ]);
  if (multiErrors.length !== 3) {
    fail(`Expected 3 id violations reported in one pass, got: ${multiErrors.length}`);
  }

  // Named-only export rejected when loading manifest project
  const namedOnlyProj = path.join(tmpDir, "named_only_proj");
  mkdirSync(namedOnlyProj, { recursive: true });
  writeFileSync(path.join(namedOnlyProj, "package.json"), '{"type": "module"}\n');
  writeFileSync(path.join(namedOnlyProj, "main.ts"), "export const scenes = [];\n");
  try {
    await loadManifestProject({ schemaVersion: 2 }, namedOnlyProj);
    fail("loadManifestProject should reject named-only export");
  } catch (err) {
    if (err?.code !== "CC1010" || !err.message.includes("named-only export")) {
      fail(`Expected CC1010 naming named-only export, got: ${err}`);
    }
  }

} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

if (errors > 0) {
  console.error(`check-manifest-contract failed with ${errors} error(s)`);
  process.exit(1);
} else {
  console.log("check-manifest-contract ok: all 10 requirements verified");
}
