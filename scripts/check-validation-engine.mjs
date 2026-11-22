import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const distEngine = path.join(cinecodeDir, "dist", "esm", "cli", "validation-engine.js");
const distValidate = path.join(cinecodeDir, "dist", "esm", "cli", "validate.js");
const distCheck = path.join(cinecodeDir, "dist", "esm", "cli", "check.js");
const distResolver = path.join(cinecodeDir, "dist", "esm", "cli", "project-resolver.js");
const distRender = path.join(cinecodeDir, "dist", "esm", "cli", "render.js");
const distDegradations = path.join(cinecodeDir, "dist", "esm", "errors", "degradations.js");
const distErrors = path.join(cinecodeDir, "dist", "esm", "errors", "codes.js");
const distTimeline = path.join(cinecodeDir, "dist", "esm", "core", "validation", "timeline.js");

const { runValidation, applySafeFixes, ORDERED_GATES } = await import(pathToFileURL(distEngine).href);
const { validateCommand } = await import(pathToFileURL(distValidate).href);
const { runCheck } = await import(pathToFileURL(distCheck).href);
const { createProjectResolver } = await import(pathToFileURL(distResolver).href);
const { orchestrateRender } = await import(pathToFileURL(distRender).href);
const { pendingDegradations, resetDiagnostics } = await import(pathToFileURL(distDegradations).href);
const { ErrorCode } = await import(pathToFileURL(distErrors).href);
const { normalizeSource, scanSourceForNonDeterminism } = await import(pathToFileURL(distTimeline).href);

let errors = 0;
function fail(msg) {
  console.error(`check-validation-engine error: ${msg}`);
  errors++;
}

console.log("Checking Validation Engine...");

// Test 1: normalizeSource prevents comment and string false positives while preserving line & col
{
  const source = [
    "// Math.random() in comment",
    "/* Date.now() in block comment */",
    "const s1 = 'Math.random() in single quote';",
    "const s2 = \"performance.now() in double quote\";",
    "const s3 = `crypto.randomUUID() in template`;",
    "/* multi-line",
    "   crypto.getRandomValues()",
    "*/",
    "const real = Math.random();",
    "const interp = `value: ${Date.now()}`;",
  ].join("\n");

  const normalized = normalizeSource(source);
  if (normalized.includes("Math.random() in comment")) fail("normalizeSource did not strip single-line comment");
  if (normalized.includes("Date.now() in block comment")) fail("normalizeSource did not strip block comment");
  if (normalized.includes("Math.random() in single quote")) fail("normalizeSource did not strip single-quoted string");
  if (normalized.includes("performance.now() in double quote")) fail("normalizeSource did not strip double-quoted string");
  if (normalized.includes("crypto.randomUUID() in template")) fail("normalizeSource did not strip template string");

  // Real code must remain
  if (!normalized.includes("Math.random()")) fail("normalizeSource stripped real Math.random() call");
  if (!normalized.includes("Date.now()")) fail("normalizeSource stripped interpolated Date.now() call");

  const issues = scanSourceForNonDeterminism(source, "test.ts");
  // Only line 9 (Math.random) and line 10 (Date.now) should trigger!
  if (issues.length !== 2) {
    fail(`Expected exactly 2 issues, got ${issues.length}: ${JSON.stringify(issues)}`);
  } else {
    if (issues[0].position.line !== 9) fail(`Expected first issue at line 9, got ${issues[0].position.line}`);
    if (issues[1].position.line !== 10) fail(`Expected second issue at line 10, got ${issues[1].position.line}`);
  }
}

// Setup fixture directory for project checks
const tmpDir = path.join(root, ".tmp-validation-engine-check");
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

function createFixture(files) {
  const p = path.join(tmpDir, `proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  mkdirSync(p, { recursive: true });
  mkdirSync(path.join(p, "media"), { recursive: true });
  writeFileSync(path.join(p, "package.json"), JSON.stringify({ type: "module" }));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(p, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return p;
}

const VALID_TIMELINE = "export default () => ({ tracks: [{ kind: 'video', clips: [{ type: 'solid', color: '#000000', start: 0, duration: 5 }] }] });";

// Test 2: Ordered Gates stop at first gate with errors
{
  // A resolution with invalid normalized config: video width is negative
  const proj = createFixture({
    "cinecode.config.json": JSON.stringify({
      schemaVersion: 2,
      project: { entry: "./main.js" },
    }),
    "main.js": "export default { timelines: [{ id: 't0', file: './t0.js' }] };",
    "t0.js": VALID_TIMELINE,
  });

  const resolver = createProjectResolver({ root: proj });
  const validResolution = await resolver.resolve();
  // Modify config to have invalid width (< 1)
  const invalidConfigResolution = {
    ...validResolution,
    config: {
      ...validResolution.config,
      video: { width: -100, height: 720, fps: 30 },
    },
  };

  const report = await runValidation(invalidConfigResolution, { mode: "all" });

  if (report.ok) fail("Validation should fail for invalid video width");
  if (report.stoppedAtGate !== "config") fail(`Expected stoppedAtGate='config', got '${report.stoppedAtGate}'`);
  // Gate sequence must have stopped before modules, media, fonts, determinism, capability, resources
  const errorGates = report.errors.map((e) => e.gate);
  if (errorGates.some((g) => g !== "config")) {
    fail(`Expected all errors in config gate, got: ${errorGates.join(", ")}`);
  }

  // Also verify Gate 4 (modules) stops before Gate 5, 6, 7
  const modProj = createFixture({
    "cinecode.config.json": JSON.stringify({
      schemaVersion: 2,
      project: { entry: "./main.js" },
    }),
    "main.js": "export default { timelines: [{ id: 't1', file: './t.js' }] };",
    "t.js": "export default () => ({ tracks: [{ kind: 'video', clips: [{ type: 'video', src: 'clip.mp4', start: 0, duration: -5 }] }] });",
  });
  const modRes = await createProjectResolver({ root: modProj }).resolve();
  const modReport = await runValidation(modRes, { mode: "all" });
  if (modReport.ok) fail("Validation should fail for negative clip duration");
  if (modReport.stoppedAtGate !== "modules") fail(`Expected stoppedAtGate='modules', got '${modReport.stoppedAtGate}'`);
  if (modReport.errors.some((e) => e.gate !== "modules")) fail("Expected errors only in modules gate");
}

// Test 3: Validate modes: authoring-only, media, fonts, all
{
  const proj = createFixture({
    "cinecode.config.json": JSON.stringify({
      schemaVersion: 2,
      project: { entry: "./main.js" },
      video: { width: 1280, height: 720, fps: 30 },
    }),
    "main.js": "export default { timelines: [{ id: 'main', file: './t.js' }] };",
    "t.js": VALID_TIMELINE,
  });

  const resolver = createProjectResolver({ root: proj });
  const resolution = await resolver.resolve();

  // authoring-only
  const authoringReport = await runValidation(resolution, { mode: "authoring-only" });
  if (!authoringReport.ok) fail(`authoring-only failed: ${JSON.stringify(authoringReport.errors)}`);
  if (authoringReport.mode !== "authoring-only") fail("authoring-only mode mismatch");

  // check alias delegates to authoring-only
  const checkReport = await runCheck(resolution);
  if (!checkReport.ok) fail(`runCheck failed: ${JSON.stringify(checkReport.errors)}`);

  // media mode
  const mediaReport = await runValidation(resolution, { mode: "media" });
  if (!mediaReport.ok) fail(`media mode failed: ${JSON.stringify(mediaReport.errors)}`);

  // fonts mode
  const fontsReport = await runValidation(resolution, { mode: "fonts" });
  if (!fontsReport.ok) fail(`fonts mode failed: ${JSON.stringify(fontsReport.errors)}`);

  // all mode
  const allReport = await runValidation(resolution, { mode: "all" });
  if (!allReport.ok) fail(`all mode failed: ${JSON.stringify(allReport.errors)}`);
}

// Test 4: Font validation passes for valid font and fails for missing font with doctor parity
{
  // Missing font
  const proj = createFixture({
    "cinecode.config.json": JSON.stringify({
      schemaVersion: 2,
      project: { entry: "./main.js" },
      fonts: [{ family: "CustomFont", src: "./media/missing-font.ttf" }],
    }),
    "main.js": "export default { timelines: [{ id: 't0', file: './t0.js' }] };",
    "t0.js": VALID_TIMELINE,
  });

  const resolver = createProjectResolver({ root: proj });
  const resolution = await resolver.resolve();
  const report = await runValidation(resolution, { mode: "fonts" });

  if (report.ok) fail("Font validation should fail for missing font file");
  const fontError = report.errors.find((e) => e.gate === "fonts");
  if (!fontError) fail("Missing font error in fonts gate");
  if (fontError.code !== ErrorCode.CC2001) fail(`Expected CC2001 for missing font, got ${fontError.code}`);
  if (!fontError.message.includes("Font file not found")) fail(`Unexpected font error message: ${fontError.message}`);
}

// Test 5: Determinism scan follows project import graph and reports exact location
{
  const proj = createFixture({
    "cinecode.config.json": JSON.stringify({
      schemaVersion: 2,
      project: { entry: "./main.js" },
    }),
    "main.js": [
      "import { helper } from './helper.js';",
      "export default { timelines: [{ id: 't1', file: './t.js' }] };",
    ].join("\n"),
    "helper.js": [
      "// Safe comment",
      "export function helper() {",
      "  const rnd = Math.random();",
      "  return rnd;",
      "}",
    ].join("\n"),
    "t.js": VALID_TIMELINE,
  });

  const resolver = createProjectResolver({ root: proj });
  const resolution = await resolver.resolve();
  const report = await runValidation(resolution, { mode: "determinism" });

  if (report.ok) fail("Determinism gate should fail for imported helper using Math.random()");
  const issue = report.errors.find((e) => e.gate === "determinism" && e.file.endsWith("helper.js"));
  if (!issue) {
    fail(`Did not find determinism issue in helper.js. Errors: ${JSON.stringify(report.errors)}`);
  } else {
    if (issue.code !== ErrorCode.CC3005) fail(`Expected CC3005, got ${issue.code}`);
    if (issue.line !== 3) fail(`Expected line 3 in helper.js, got ${issue.line}`);
    if (!issue.fix || !issue.fixHint) fail("Expected fix and fixHint on determinism issue");
  }
}

// Test 6: Every issue carries code, severity, file, line, column, message, and fix
{
  const proj = createFixture({
    "cinecode.config.json": JSON.stringify({
      schemaVersion: 2,
      project: { entry: "./main.js" },
    }),
    "main.js": [
      "import { helper } from './helper.js';",
      "export default { timelines: [{ id: 't1', file: './t.js' }] };",
    ].join("\n"),
    "helper.js": [
      "export function helper() {",
      "  const now = Date.now();",
      "  return now;",
      "}",
    ].join("\n"),
    "t.js": VALID_TIMELINE,
  });

  const resolver = createProjectResolver({ root: proj });
  const resolution = await resolver.resolve();
  const report = await runValidation(resolution, { mode: "all" });

  for (const issue of [...report.errors, ...report.warnings]) {
    if (!issue.code) fail(`Issue missing code: ${JSON.stringify(issue)}`);
    if (!issue.severity) fail(`Issue missing severity: ${JSON.stringify(issue)}`);
    if (!issue.message) fail(`Issue missing message: ${JSON.stringify(issue)}`);
    if (!issue.fix && !issue.fixHint) fail(`Issue missing fix/fixHint: ${JSON.stringify(issue)}`);
  }
}

// Test 7: Closed list of safe fixes (--fix)
{
  const proj = createFixture({
    "cinecode.config.json": JSON.stringify({
      schemaVersion: 2,
      project: { entry: "./main.js", outputDir: "./custom-out", cacheDir: "./custom-cache" },
    }),
    "main.js": "export default { timelines: [{ id: 't0', file: './t0.js' }] };",
    "t0.js": VALID_TIMELINE,
  });

  const resolver = createProjectResolver({ root: proj });
  const resolution = await resolver.resolve();
  const fixResult = await applySafeFixes(resolution);

  if (fixResult.applied.length === 0) fail("applySafeFixes should report applied changes");
  if (!existsSync(path.join(proj, "custom-out"))) fail("Safe fix should create missing outputDir");
  if (!existsSync(path.join(proj, "custom-cache"))) fail("Safe fix should create missing cacheDir");

  // Run again: nothing changed
  const secondFix = await applySafeFixes(resolution);
  if (secondFix.applied.length > 0) fail("Second applySafeFixes should make no changes");
}

// Test 8: Render refuses to proceed when validation produced errors without --allow-invalid
{
  resetDiagnostics();
  const proj = createFixture({
    "cinecode.config.json": JSON.stringify({
      schemaVersion: 2,
      project: { entry: "./main.js" },
      render: { format: "mp4" },
    }),
    "main.js": [
      "import { helper } from './helper.js';",
      "export default { timelines: [{ id: 'bad', file: './bad.js' }] };",
    ].join("\n"),
    "helper.js": "export function helper() { return Math.random(); }",
    "bad.js": VALID_TIMELINE,
  });

  const resolver = createProjectResolver({ root: proj, timeline: "bad" });
  const resolution = await resolver.resolve();
  const targets = [{
    id: "bad",
    name: "bad",
    kind: "timeline",
    composition: { name: "bad", width: 1280, height: 720, fps: 30, duration: 2, rootTimeline: { tracks: [] } },
  }];

  // Without allowInvalid: must throw CC1013
  let threw = false;
  try {
    await orchestrateRender(resolution, targets, { all: false, preview: false, noCache: true, fresh: true, resume: false, overwrite: true, dryRun: true });
  } catch (err) {
    threw = true;
    if (err.code !== ErrorCode.CC1013) fail(`Expected CC1013 from render without allowInvalid, got ${err.code}`);
  }
  if (!threw) fail("orchestrateRender should have thrown on validation errors");

  // With allowInvalid: must proceed and record degradation
  resetDiagnostics();
  try {
    await orchestrateRender(resolution, targets, { all: false, preview: false, noCache: true, fresh: true, resume: false, overwrite: true, dryRun: true, allowInvalid: true });
    const degs = pendingDegradations();
    if (!degs.some((d) => d.code === ErrorCode.CC4001)) {
      fail("orchestrateRender with allowInvalid should have recorded CC4001 degradation");
    }
  } catch (err) {
    fail(`orchestrateRender with allowInvalid threw unexpectedly: ${err.message}`);
  }
}

// Cleanup
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });

if (errors > 0) {
  console.error(`\nFAILED: ${errors} error(s) in validation engine check`);
  process.exit(1);
} else {
  console.log("\nPASSED: All validation engine checks passed!");
  process.exit(0);
}
