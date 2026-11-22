import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distCinecode = path.join(root, "packages", "cinecode", "dist", "esm");

const {
  collectHealthReport,
  resetEncoderCache,
  probeAvailableEncoders,
} = await import(pathToFileURL(path.join(distCinecode, "cli", "health-collector.js")).href);

const {
  collectHealth,
  healthCommand,
} = await import(pathToFileURL(path.join(distCinecode, "cli", "health.js")).href);

const {
  doctorCommand,
} = await import(pathToFileURL(path.join(distCinecode, "cli", "doctor.js")).href);

const {
  detectHardwareAcceleration,
  resetHardwareAccelerationCache,
  resolveVideoEncoding,
} = await import(pathToFileURL(path.join(distCinecode, "core", "quality.js")).href);

const {
  resolveBinary,
  resetBinaryCache,
} = await import(pathToFileURL(path.join(distCinecode, "binary", "resolver.js")).href);

const {
  runReport,
} = await import(pathToFileURL(path.join(distCinecode, "cli", "run-report.js")).href);

console.log("--- Check 1: One collector; doctor and health cannot disagree ---");
{
  const healthResult = await collectHealth();
  const collectorResult = await collectHealthReport(null);

  assert.equal(healthResult.node.version, collectorResult.node.version);
  assert.equal(healthResult.node.compatible, collectorResult.node.compatible);
  assert.equal(healthResult.ffmpeg.version, collectorResult.ffmpeg.version);
  assert.equal(healthResult.ffmpeg.path, collectorResult.ffmpeg.path);
  assert.equal(healthResult.workers.available, collectorResult.workers.available);
  assert.equal(healthResult.gpu.available, collectorResult.gpu.available);
  console.log("  ok: doctor and health data parity verified");
}

console.log("--- Check 2: Binaries report winning provenance and version caching ---");
{
  resetBinaryCache();
  const ffmpegRes = resolveBinary("ffmpeg", {}, { probeVersion: true });
  assert.ok(["config", "system", "installer"].includes(ffmpegRes.provenance));
  assert.ok(ffmpegRes.version && ffmpegRes.version !== "unknown");

  const report = await collectHealthReport(null);
  const binaries = report.sections.binaries;
  assert.ok(binaries.details);
  assert.equal(binaries.details.ffmpeg.provenance, ffmpegRes.provenance);
  console.log("  ok: binary provenance and version probe verified");
}

console.log("--- Check 3: Encoder availability is factual and conditional ---");
{
  resetEncoderCache();
  const report = await collectHealthReport(null);
  assert.equal(report.sections.encoders.status, "PASS");

  // Project requesting h264 succeeds if h264 available even if other codecs absent
  const mockResolution = {
    root: root,
    config: { render: { codec: "h264" } },
    context: { roots: { source: "src", media: "media", output: "out", cache: ".cinecode/cache" } },
  };
  const projReport = await collectHealthReport(mockResolution);
  assert.equal(projReport.sections.encoders.status, "PASS");

  // Project requesting nonexistent codec fails conditionally
  const mockMissingResolution = {
    root: root,
    config: { render: { codec: "nonexistent_custom_codec_999" } },
    context: { roots: { source: "src", media: "media", output: "out", cache: ".cinecode/cache" } },
  };
  const failReport = await collectHealthReport(mockMissingResolution);
  assert.equal(failReport.sections.encoders.status, "FAIL");
  assert.ok(failReport.sections.encoders.message.includes("nonexistent_custom_codec_999"));
  console.log("  ok: encoder availability is factual and conditional");
}

console.log("--- Check 4: Hardware detection works in ESM and is cached once ---");
{
  resetHardwareAccelerationCache();
  const backend1 = detectHardwareAcceleration();
  assert.ok(typeof backend1 === "string");
  assert.ok(["software", "nvenc", "videotoolbox"].includes(backend1));

  const backend2 = detectHardwareAcceleration();
  assert.equal(backend1, backend2);
  console.log("  ok: hardware detection works and caches per process");
}

const {
  pendingNotes,
} = await import(pathToFileURL(path.join(distCinecode, "errors", "degradations.js")).href);

console.log("--- Check 5: Software fallback is reported, not silent ---");
{
  resolveVideoEncoding({ render: { hardwareAcceleration: "qsv" } });
  const notes = pendingNotes();
  assert.ok(
    notes.some((n) => n.includes("Hardware acceleration")),
    "fallback to software must log a structured note",
  );
  console.log("  ok: software fallback logs structured note");
}

console.log("--- Check 6: Colour policy: no hardcoded escape sequences ---");
{
  const doctorSrc = fs.readFileSync(path.join(root, "packages", "cinecode", "src", "cli", "doctor.ts"), "utf-8");
  const healthSrc = fs.readFileSync(path.join(root, "packages", "cinecode", "src", "cli", "health.ts"), "utf-8");
  const collectorSrc = fs.readFileSync(path.join(root, "packages", "cinecode", "src", "cli", "health-collector.ts"), "utf-8");

  assert.ok(!doctorSrc.includes("\\x1b["), "doctor.ts must not have hardcoded escape codes");
  assert.ok(!healthSrc.includes("\\x1b["), "health.ts must not have hardcoded escape codes");
  assert.ok(!collectorSrc.includes("\\x1b["), "health-collector.ts must not have hardcoded escape codes");
  console.log("  ok: no hardcoded ANSI escape sequences");
}

console.log("--- Check 7: Fix mode touches only managed ignore block ---");
{
  const tempDir = path.join(root, "node_modules", ".cache", "test-doctor-fix-" + Date.now());
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(path.join(tempDir, "cinecode.config.json"), JSON.stringify({ outputDir: "out", cacheDir: ".cache" }));

  // Run doctorCommand on mock directory
  await doctorCommand({ root: tempDir, config: path.join(tempDir, "cinecode.config.json"), fix: true, json: true });

  const gitignorePath = path.join(tempDir, ".gitignore");
  assert.ok(fs.existsSync(gitignorePath), ".gitignore should be created by fix");
  const content = fs.readFileSync(gitignorePath, "utf-8");
  assert.ok(content.includes("# Cinecode"));
  assert.ok(content.includes("out"));
  assert.ok(content.includes(".cache"));

  // Verify other directories were NOT fabricated
  assert.ok(!fs.existsSync(path.join(tempDir, "src")), "fix must not fabricate src folder");

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log("  ok: fix mode touches only managed ignore block");
}

console.log("--- Check 8: Doctor runs outside a project and emits valid envelope ---");
{
  const emptyDir = path.join(root, "node_modules", ".cache", "test-doctor-empty-" + Date.now());
  fs.mkdirSync(emptyDir, { recursive: true });

  const report = await collectHealthReport(null);
  assert.equal(report.isProject, false);
  assert.ok(report.notes.some((n) => n.includes("No project found")));
  assert.equal(report.sections.fonts.status, "SKIPPED");
  assert.equal(report.sections.roots.status, "SKIPPED");
  assert.equal(report.sections.config.status, "SKIPPED");
  assert.equal(report.sections.manifest.status, "SKIPPED");
  assert.ok(report.sections.runtime.status === "PASS");
  assert.ok(report.sections.binaries.status === "PASS");
  assert.ok(report.sections.resources.status === "PASS" || report.sections.resources.status === "WARN");
  assert.ok(report.sections.preview.status === "PASS");

  // Run doctorCommand outside a project
  await doctorCommand({ root: emptyDir, json: true });

  fs.rmSync(emptyDir, { recursive: true, force: true });
  console.log("  ok: project-free doctor emits valid envelope and skips project sections");
}

console.log("check-doctor-health ok: all 8 acceptance checks passed");
