import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const distPlan = path.join(cinecodeDir, "dist", "esm", "core", "output-plan.js");
const distPrecedence = path.join(cinecodeDir, "dist", "esm", "cli", "precedence.js");
const distReporter = path.join(cinecodeDir, "dist", "esm", "cli", "reporter.js");
const distSchema = path.join(cinecodeDir, "dist", "esm", "config", "json-schema.js");
const distErrors = path.join(cinecodeDir, "dist", "esm", "errors", "codes.js");

if (!existsSync(distPlan) || !existsSync(distPrecedence)) {
  execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
    cwd: cinecodeDir,
    stdio: "inherit",
  });
}

const {
  OUTPUT_FORMATS,
  OUTPUT_PLANS,
  ALPHA_FORMATS,
  outputPlanFor,
  resolveOutputPlan,
  resolveAudioPlan,
} = await import(pathToFileURL(distPlan).href);
const { resolveRenderParameters } = await import(pathToFileURL(distPrecedence).href);
const { verifyArtifact } = await import(pathToFileURL(distReporter).href);
const { generateManifestReferenceMarkdown } = await import(pathToFileURL(distSchema).href);
const { ErrorCode } = await import(pathToFileURL(distErrors).href);

let errors = 0;
function fail(msg) {
  console.error(`check-output-plans error: ${msg}`);
  errors++;
}

const tmpDir = path.join(root, "node_modules", ".tmp-output-plans-check");
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

try {
  // 1. One record per format; exact mapping
  for (const fmt of OUTPUT_FORMATS) {
    const plan = OUTPUT_PLANS[fmt];
    if (!plan) {
      fail(`Missing OUTPUT_PLAN for format '${fmt}'`);
    } else if (plan.format !== fmt) {
      fail(`Mismatched format in plan: expected '${fmt}', got '${plan.format}'`);
    }
  }

  // 2. Truthful alpha: rejected on webm/prores, accepted on webm-alpha/prores-alpha
  if (OUTPUT_PLANS.webm.alpha !== false) {
    fail("OUTPUT_PLANS.webm must declare alpha: false");
  }
  if (OUTPUT_PLANS.prores.alpha !== false) {
    fail("OUTPUT_PLANS.prores must declare alpha: false");
  }
  if (OUTPUT_PLANS["webm-alpha"].alpha !== true) {
    fail("OUTPUT_PLANS['webm-alpha'] must declare alpha: true");
  }
  if (OUTPUT_PLANS["prores-alpha"].alpha !== true) {
    fail("OUTPUT_PLANS['prores-alpha'] must declare alpha: true");
  }

  try {
    resolveOutputPlan({ format: "webm", alpha: true });
    fail("Expected resolveOutputPlan({ format: 'webm', alpha: true }) to fail");
  } catch (err) {
    if (err.code !== ErrorCode.CC1008 || (!err.message?.includes("use --format webm-alpha") && !err.fixHint?.includes("use --format webm-alpha"))) {
      fail(`Expected CC1008 with fixHint 'use --format webm-alpha', got: ${err.message} (hint: ${err.fixHint})`);
    }
  }

  try {
    resolveOutputPlan({ format: "prores", alpha: true });
    fail("Expected resolveOutputPlan({ format: 'prores', alpha: true }) to fail");
  } catch (err) {
    if (err.code !== ErrorCode.CC1008 || (!err.message?.includes("use --format prores-alpha") && !err.fixHint?.includes("use --format prores-alpha"))) {
      fail(`Expected CC1008 with fixHint 'use --format prores-alpha', got: ${err.message} (hint: ${err.fixHint})`);
    }
  }

  try {
    resolveOutputPlan({ format: "mp4", alpha: true });
    fail("Expected resolveOutputPlan({ format: 'mp4', alpha: true }) to fail");
  } catch (err) {
    if (err.code !== ErrorCode.CC1008) {
      fail(`Expected CC1008 for alpha on mp4, got: ${err.code}`);
    }
  }

  const alphaWebm = resolveOutputPlan({ format: "webm-alpha" });
  if (!alphaWebm.alpha || alphaWebm.inputPixFmt !== "rgba") {
    fail(`Expected webm-alpha to resolve alpha: true and rgba inputPixFmt, got ${JSON.stringify(alphaWebm)}`);
  }

  // 3. Sequence strategy for PNG
  if (OUTPUT_PLANS.png.strategy !== "sequence") {
    fail(`Expected PNG strategy to be 'sequence', got '${OUTPUT_PLANS.png.strategy}'`);
  }
  if (OUTPUT_PLANS.png.extension !== "") {
    fail(`Expected PNG sequence extension to be empty string, got '${OUTPUT_PLANS.png.extension}'`);
  }

  // 4. Container extensions derived from plan, not format identifier
  const proresRes = resolveRenderParameters({
    selection: { id: "master-shot" },
    flags: { format: "prores" },
    project: { root: tmpDir },
  });
  if (!proresRes.parameters.outputPath.value.endsWith("master-shot.mov")) {
    fail(`Expected prores output to end with .mov, got ${proresRes.parameters.outputPath.value}`);
  }

  const proresAlphaRes = resolveRenderParameters({
    selection: { id: "alpha-shot" },
    flags: { format: "prores-alpha" },
    project: { root: tmpDir },
  });
  if (!proresAlphaRes.parameters.outputPath.value.endsWith("alpha-shot.mov")) {
    fail(`Expected prores-alpha output to end with .mov, got ${proresAlphaRes.parameters.outputPath.value}`);
  }

  const previewRes = resolveRenderParameters({
    selection: { id: "hero" },
    flags: { format: "mp4", preview: true },
    project: { root: tmpDir },
  });
  if (!previewRes.parameters.outputPath.value.endsWith("hero.preview.mp4")) {
    fail(`Expected preview output to have .preview.mp4, got ${previewRes.parameters.outputPath.value}`);
  }

  const qualityPreviewRes = resolveRenderParameters({
    selection: { id: "hero" },
    flags: { format: "mp4", quality: "preview" },
    project: { root: tmpDir },
  });
  if (!qualityPreviewRes.parameters.outputPath.value.endsWith("hero.preview.mp4")) {
    fail(`Expected --quality preview output to have .preview.mp4, got ${qualityPreviewRes.parameters.outputPath.value}`);
  }

  // 5. Audio plan capabilities
  if (resolveAudioPlan("gif") !== null) fail("Expected gif to have no audio plan");
  if (resolveAudioPlan("png") !== null) fail("Expected png to have no audio plan");
  if (resolveAudioPlan("pdf") !== null) fail("Expected pdf to have no audio plan");

  const mp4Audio = resolveAudioPlan("mp4");
  if (!mp4Audio || mp4Audio.defaultCodec !== "aac") {
    fail("Expected mp4 audio plan with defaultCodec aac");
  }

  // 6. Artifact verification on files and sequence directories
  const validFile = path.join(tmpDir, "valid.mp4");
  writeFileSync(validFile, "non-empty-content");
  verifyArtifact({ kind: "video", path: validFile, expectedExtension: ".mp4" });

  const zeroFile = path.join(tmpDir, "zero.mp4");
  writeFileSync(zeroFile, "");
  try {
    verifyArtifact({ kind: "video", path: zeroFile });
    fail("Expected verifyArtifact to reject 0-byte file");
  } catch (err) {
    if (err.code !== ErrorCode.CC4004) fail(`Expected CC4004 for 0-byte file, got ${err.code}`);
  }

  const extMismatch = path.join(tmpDir, "mismatch.avi");
  writeFileSync(extMismatch, "content");
  try {
    verifyArtifact({ kind: "video", path: extMismatch, expectedExtension: ".mp4" });
    fail("Expected verifyArtifact to reject extension mismatch");
  } catch (err) {
    if (err.code !== ErrorCode.CC4004) fail(`Expected CC4004 for extension mismatch, got ${err.code}`);
  }

  const seqDir = path.join(tmpDir, "seq-out");
  mkdirSync(seqDir, { recursive: true });
  try {
    verifyArtifact({ kind: "sequence", path: seqDir, units: 3 });
    fail("Expected verifyArtifact to reject empty sequence directory");
  } catch (err) {
    if (err.code !== ErrorCode.CC4004) fail(`Expected CC4004 for empty sequence dir, got ${err.code}`);
  }

  writeFileSync(path.join(seqDir, "frame-00000.png"), "f0");
  writeFileSync(path.join(seqDir, "frame-00001.png"), "f1");
  writeFileSync(path.join(seqDir, "frame-00002.png"), "f2");
  verifyArtifact({ kind: "sequence", path: seqDir, units: 3 });

  // 7. Docs mention output naming and preview quality
  const refDocs = generateManifestReferenceMarkdown();
  if (!refDocs.includes("## Output naming and preview quality")) {
    fail("Missing '## Output naming and preview quality' section in generated reference markdown");
  }
  if (!refDocs.includes(".preview")) {
    fail("Missing .preview suffix documentation in reference markdown");
  }

} catch (e) {
  fail(`Unexpected exception: ${e.message}\n${e.stack}`);
} finally {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
}

if (errors > 0) {
  console.error(`check-output-plans failed with ${errors} error(s)`);
  process.exit(1);
} else {
  console.log("check-output-plans: all output plans checks passed");
}
