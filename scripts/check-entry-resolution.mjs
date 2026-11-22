import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const distManifest = path.join(cinecodeDir, "dist", "esm", "manifest", "index.js");
const distTarget = path.join(cinecodeDir, "dist", "esm", "manifest", "target.js");
const distResolver = path.join(cinecodeDir, "dist", "esm", "cli", "project-resolver.js");
const distPrecedence = path.join(cinecodeDir, "dist", "esm", "cli", "precedence.js");
const distBuilders = path.join(cinecodeDir, "dist", "esm", "core", "clips", "builders.js");

if (!existsSync(distManifest) || !existsSync(distTarget)) {
  execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
    cwd: cinecodeDir,
    stdio: "inherit",
  });
}

const { loadManifestProject } = await import(pathToFileURL(distManifest).href);
const { resolveTarget, resolveCompositionGeometry, applyCompositionGeometry } = await import(pathToFileURL(distTarget).href);
const { ProjectResolver } = await import(pathToFileURL(distResolver).href);
const { resolveRenderParameters } = await import(pathToFileURL(distPrecedence).href);
const { composition, timeline, track } = await import(pathToFileURL(distBuilders).href);

let errors = 0;
function fail(msg) {
  console.error(`check-entry-resolution error: ${msg}`);
  errors++;
}

const tmpDir = path.join(root, ".test_phase13_tmp");
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

try {
  // Setup sample project
  const projectDir = path.join(tmpDir, "sample-project");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(path.join(projectDir, "src"), { recursive: true });
  writeFileSync(path.join(projectDir, "package.json"), '{"type": "module"}\n');
  writeFileSync(path.join(projectDir, "cinecode.config.js"), 'export default { project: { entry: "./main.js" } };\n');

  // Shared composition file
  writeFileSync(
    path.join(projectDir, "src", "shared-comp.js"),
    `import { composition, timeline, track } from ${JSON.stringify(pathToFileURL(distBuilders).href)};
export const baseComp = composition({
  name: "base-comp",
  width: 1280,
  height: 720,
  fps: 24,
  background: "#111111",
  duration: 5,
  rootTimeline: timeline([
    track("t1", [
      { type: "solid", color: "#000000", duration: 5 }
    ])
  ])
});
export default baseComp;
`,
  );

  // Manifest with two entries referencing the same file with different geometry, plus duration variants
  writeFileSync(
    path.join(projectDir, "main.js"),
    `import { defineMain } from ${JSON.stringify(pathToFileURL(distManifest).href)};
export default defineMain({
  timelines: [
    {
      id: "desktop",
      file: "./src/shared-comp.js",
      width: 1920,
      height: 1080,
      fps: 60,
      background: "#abcdef",
      format: "webm",
      codec: "vp9",
      quality: "final"
    },
    {
      id: "mobile",
      file: "./src/shared-comp.js",
      width: 1080,
      height: 1920,
      fps: 30,
      background: "#123456",
      format: "mp4",
      codec: "h264",
      quality: "preview"
    },
    {
      id: "truncated",
      file: "./src/shared-comp.js",
      duration: 2,
      truncate: true
    },
    {
      id: "illegal-short",
      file: "./src/shared-comp.js",
      duration: 2
    },
    {
      id: "illegal-long",
      file: "./src/shared-comp.js",
      duration: 10
    },
    {
      id: "bad-codec",
      file: "./src/shared-comp.js",
      format: "gif",
      codec: "h264"
    }
  ]
});
`,
  );

  const project = await loadManifestProject({ project: { entry: "./main.js" } }, projectDir);

  // 1. File-based timeline honors manifest width, height, fps, background, format, codec, quality
  const targetDesktop = await resolveTarget(project, "desktop");
  if (targetDesktop.geometry.width !== 1920) fail(`desktop width expected 1920, got ${targetDesktop.geometry.width}`);
  if (targetDesktop.geometry.height !== 1080) fail(`desktop height expected 1080, got ${targetDesktop.geometry.height}`);
  if (targetDesktop.geometry.fps !== 60) fail(`desktop fps expected 60, got ${targetDesktop.geometry.fps}`);
  if (targetDesktop.geometry.background !== "#abcdef") fail(`desktop background expected #abcdef, got ${targetDesktop.geometry.background}`);
  if (targetDesktop.geometry.format !== "webm") fail(`desktop format expected webm, got ${targetDesktop.geometry.format}`);
  if (targetDesktop.geometry.codec !== "vp9") fail(`desktop codec expected vp9, got ${targetDesktop.geometry.codec}`);
  if (targetDesktop.geometry.quality !== "final") fail(`desktop quality expected final, got ${targetDesktop.geometry.quality}`);

  // Composition clone honors manifest geometry
  if (targetDesktop.composition.width !== 1920) fail(`desktop comp width expected 1920, got ${targetDesktop.composition.width}`);
  if (targetDesktop.composition.height !== 1080) fail(`desktop comp height expected 1080, got ${targetDesktop.composition.height}`);
  if (targetDesktop.composition.fps !== 60) fail(`desktop comp fps expected 60, got ${targetDesktop.composition.fps}`);
  if (targetDesktop.composition.background !== "#abcdef") fail(`desktop comp background expected #abcdef, got ${targetDesktop.composition.background}`);
  if (targetDesktop.composition.name !== "desktop") fail(`desktop comp name expected desktop, got ${targetDesktop.composition.name}`);

  // 2. One composition file used by two entries produces two distinct resolved targets
  const targetMobile = await resolveTarget(project, "mobile");
  if (targetMobile.geometry.width !== 1080) fail(`mobile width expected 1080, got ${targetMobile.geometry.width}`);
  if (targetMobile.geometry.height !== 1920) fail(`mobile height expected 1920, got ${targetMobile.geometry.height}`);
  if (targetMobile.geometry.fps !== 30) fail(`mobile fps expected 30, got ${targetMobile.geometry.fps}`);
  if (targetMobile.geometry.background !== "#123456") fail(`mobile background expected #123456, got ${targetMobile.geometry.background}`);
  if (targetMobile.composition.name !== "mobile") fail(`mobile comp name expected mobile, got ${targetMobile.composition.name}`);

  if (targetDesktop.composition === targetMobile.composition) {
    fail("desktop and mobile should have distinct cloned composition instances");
  }

  // 3. Declared duration rules enforced; truncation explicit and applied
  const targetTruncated = await resolveTarget(project, "truncated");
  if (targetTruncated.geometry.duration !== 2) fail(`truncated duration expected 2, got ${targetTruncated.geometry.duration}`);
  if (targetTruncated.composition.duration !== 2) fail(`truncated comp duration expected 2, got ${targetTruncated.composition.duration}`);
  if (targetTruncated.geometry.truncate !== true) fail(`truncated geometry truncate expected true`);

  try {
    await resolveTarget(project, "illegal-short");
    fail("illegal-short without truncate: true should throw CC1010");
  } catch (err) {
    if (err?.code !== "CC1010") fail(`expected CC1010 for illegal-short, got ${err}`);
  }

  // Longer declaration is permitted and uses declared duration
  const targetLong = await resolveTarget(project, "illegal-long");
  if (targetLong.geometry.duration !== 10) {
    fail(`longer declaration expected duration 10, got ${targetLong.geometry.duration}`);
  }

  // 4. Undeliverable entry output settings fail at selection time
  try {
    await resolveTarget(project, "bad-codec");
    fail("bad-codec (gif + h264) should throw CC1008 at target resolution");
  } catch (err) {
    if (err?.code !== "CC1008" || !err.message.includes("gif")) {
      fail(`expected CC1008 mentioning gif, got: ${err}`);
    }
  }

  // 5. CLI Precedence: command flag > entry > preset > config > default
  const config = {
    video: { width: 640, height: 480, fps: 24 },
    render: { format: "mp4", codec: "h264", quality: "draft" }
  };
  const preset = {
    width: 1080,
    height: 1080,
    fps: 30,
    format: "mp4",
    codec: "h264"
  };
  const entry = {
    id: "test-prec",
    width: 720,
    height: 720,
    fps: 25,
    format: "webm",
    codec: "vp9",
    quality: "medium"
  };

  // Entry beats preset and config
  const geomEntry = resolveCompositionGeometry({
    entry,
    config,
    preset,
    contentDuration: 5,
  });
  if (geomEntry.width !== 720) fail(`entry should beat preset: width expected 720, got ${geomEntry.width}`);
  if (geomEntry.fps !== 25) fail(`entry should beat preset: fps expected 25, got ${geomEntry.fps}`);
  if (geomEntry.format !== "webm") fail(`entry should beat preset: format expected webm, got ${geomEntry.format}`);
  if (geomEntry.codec !== "vp9") fail(`entry should beat preset: codec expected vp9, got ${geomEntry.codec}`);

  // Flag beats entry
  const geomFlag = resolveCompositionGeometry({
    entry,
    config,
    preset,
    flags: { width: 3840, height: 2160, fps: 120, format: "mkv" },
    contentDuration: 5,
  });
  if (geomFlag.width !== 3840) fail(`flag should beat entry: width expected 3840, got ${geomFlag.width}`);
  if (geomFlag.height !== 2160) fail(`flag should beat entry: height expected 2160, got ${geomFlag.height}`);
  if (geomFlag.fps !== 120) fail(`flag should beat entry: fps expected 120, got ${geomFlag.fps}`);
  if (geomFlag.format !== "mkv") fail(`flag should beat entry: format expected mkv, got ${geomFlag.format}`);

  // 6. ProjectResolver targets() integration
  const resolver = new ProjectResolver({ root: projectDir, timeline: "desktop" });
  const targets = await resolver.targets();
  if (targets.length !== 1) fail(`expected 1 target from resolver, got ${targets.length}`);
  if (targets[0].id !== "desktop") fail(`expected desktop target, got ${targets[0].id}`);
  if (targets[0].geometry.width !== 1920) fail(`resolver target width expected 1920, got ${targets[0].geometry.width}`);

  // 7. ResolvedTarget is frozen and complete
  if (!Object.isFrozen(targetDesktop)) fail("ResolvedTarget should be frozen");
  if (!Object.isFrozen(targetDesktop.geometry)) fail("ResolvedGeometry should be frozen");
  if (!targetDesktop.outputPlan) fail("ResolvedTarget must contain outputPlan");
  if (!Array.isArray(targetDesktop.audioPlacement)) fail("ResolvedTarget must contain audioPlacement array");

} catch (err) {
  fail(`Unexpected exception: ${err?.stack || err}`);
} finally {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
}

if (errors > 0) {
  console.error(`FAILED: ${errors} errors found in check-entry-resolution.`);
  process.exit(1);
} else {
  console.log("PASS: check-entry-resolution passed all checks.");
}
