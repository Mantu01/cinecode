import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const distSchema = path.join(cinecodeDir, "dist", "esm", "config", "schema.js");
const distDefaults = path.join(cinecodeDir, "dist", "esm", "config", "defaults.js");
const distZod = path.join(cinecodeDir, "dist", "esm", "config", "zod-schema.js");
const distResolver = path.join(cinecodeDir, "dist", "esm", "binary", "resolver.js");

if (!existsSync(distSchema) || !existsSync(distDefaults) || !existsSync(distResolver)) {
  execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
    cwd: cinecodeDir,
    stdio: "inherit",
  });
}

const { getDefaultConfig, normalizeConfig } = await import(pathToFileURL(distSchema).href);
const { DEFAULTS } = await import(pathToFileURL(distDefaults).href);
const { NormalizedConfigSchema } = await import(pathToFileURL(distZod).href);
const { resolveBinary, setBinaryConfig, resetBinaryConfig } = await import(pathToFileURL(distResolver).href);

let errors = 0;
function fail(msg) {
  console.error(`check-config-consumers error: ${msg}`);
  errors++;
}

// 1. Verify every default in DEFAULTS matches what getDefaultConfig() emits
const defaultCfg = getDefaultConfig();
const normCfg = normalizeConfig({});

function assertEqual(actual, expected, path) {
  if (actual !== expected) {
    fail(`Default mismatch at ${path}: expected ${expected}, got ${actual}`);
  }
}

// Check project roots
assertEqual(defaultCfg.project.entry, DEFAULTS.project.entry, "defaultConfig.project.entry");
assertEqual(normCfg.project.entry, DEFAULTS.project.entry, "normalizeConfig.project.entry");
assertEqual(defaultCfg.project.sourceDir, DEFAULTS.project.sourceDir, "defaultConfig.project.sourceDir");
assertEqual(normCfg.project.sourceDir, DEFAULTS.project.sourceDir, "normalizeConfig.project.sourceDir");
assertEqual(defaultCfg.project.mediaDir, DEFAULTS.project.mediaDir, "defaultConfig.project.mediaDir");
assertEqual(normCfg.project.mediaDir, DEFAULTS.project.mediaDir, "normalizeConfig.project.mediaDir");
assertEqual(defaultCfg.project.outputDir, DEFAULTS.project.outputDir, "defaultConfig.project.outputDir");
assertEqual(normCfg.project.outputDir, DEFAULTS.project.outputDir, "normalizeConfig.project.outputDir");
assertEqual(defaultCfg.project.cacheDir, DEFAULTS.project.cacheDir, "defaultConfig.project.cacheDir");
assertEqual(normCfg.project.cacheDir, DEFAULTS.project.cacheDir, "normalizeConfig.project.cacheDir");

// Check video geometry & fps
assertEqual(defaultCfg.video.width, DEFAULTS.video.width, "defaultConfig.video.width");
assertEqual(normCfg.video.width, DEFAULTS.video.width, "normalizeConfig.video.width");
assertEqual(defaultCfg.video.height, DEFAULTS.video.height, "defaultConfig.video.height");
assertEqual(normCfg.video.height, DEFAULTS.video.height, "normalizeConfig.video.height");
assertEqual(defaultCfg.video.fps, DEFAULTS.video.fps, "defaultConfig.video.fps");
assertEqual(normCfg.video.fps, DEFAULTS.video.fps, "normalizeConfig.video.fps");
assertEqual(defaultCfg.video.background, DEFAULTS.video.background, "defaultConfig.video.background");
assertEqual(normCfg.video.background, DEFAULTS.video.background, "normalizeConfig.video.background");

// Check images
assertEqual(defaultCfg.images.defaultFormat, DEFAULTS.images.defaultFormat, "defaultConfig.images.defaultFormat");
assertEqual(normCfg.images.defaultFormat, DEFAULTS.images.defaultFormat, "normalizeConfig.images.defaultFormat");
assertEqual(defaultCfg.images.quality, DEFAULTS.images.quality, "defaultConfig.images.quality");
assertEqual(normCfg.images.quality, DEFAULTS.images.quality, "normalizeConfig.images.quality");
assertEqual(defaultCfg.images.scaleFactor, DEFAULTS.images.scaleFactor, "defaultConfig.images.scaleFactor");
assertEqual(normCfg.images.scaleFactor, DEFAULTS.images.scaleFactor, "normalizeConfig.images.scaleFactor");

// Check dev loopback
assertEqual(defaultCfg.dev.host, DEFAULTS.dev.host, "defaultConfig.dev.host");
assertEqual(normCfg.dev.host, DEFAULTS.dev.host, "normalizeConfig.dev.host");
assertEqual(defaultCfg.dev.port, DEFAULTS.dev.port, "defaultConfig.dev.port");
assertEqual(normCfg.dev.port, DEFAULTS.dev.port, "normalizeConfig.dev.port");
assertEqual(defaultCfg.dev.open, DEFAULTS.dev.open, "defaultConfig.dev.open");
assertEqual(normCfg.dev.open, DEFAULTS.dev.open, "normalizeConfig.dev.open");
assertEqual(defaultCfg.dev.hmr, DEFAULTS.dev.hmr, "defaultConfig.dev.hmr");
assertEqual(normCfg.dev.hmr, DEFAULTS.dev.hmr, "normalizeConfig.dev.hmr");

// Check render
assertEqual(defaultCfg.render.format, DEFAULTS.render.format, "defaultConfig.render.format");
assertEqual(normCfg.render.format, DEFAULTS.render.format, "normalizeConfig.render.format");
assertEqual(defaultCfg.render.quality, DEFAULTS.render.quality, "defaultConfig.render.quality");
assertEqual(normCfg.render.quality, DEFAULTS.render.quality, "normalizeConfig.render.quality");
assertEqual(defaultCfg.render.codec, DEFAULTS.render.codec, "defaultConfig.render.codec");
assertEqual(normCfg.render.codec, DEFAULTS.render.codec, "normalizeConfig.render.codec");
assertEqual(defaultCfg.render.preset, DEFAULTS.render.preset, "defaultConfig.render.preset");
assertEqual(normCfg.render.preset, DEFAULTS.render.preset, "normalizeConfig.render.preset");
assertEqual(defaultCfg.render.hardwareAcceleration, DEFAULTS.render.hardwareAcceleration, "defaultConfig.render.hardwareAcceleration");
assertEqual(normCfg.render.hardwareAcceleration, DEFAULTS.render.hardwareAcceleration, "normalizeConfig.render.hardwareAcceleration");

// Check audio
assertEqual(defaultCfg.audio.sampleRate, DEFAULTS.audio.sampleRate, "defaultConfig.audio.sampleRate");
assertEqual(normCfg.audio.sampleRate, DEFAULTS.audio.sampleRate, "normalizeConfig.audio.sampleRate");
assertEqual(defaultCfg.audio.channels, DEFAULTS.audio.channels, "defaultConfig.audio.channels");
assertEqual(normCfg.audio.channels, DEFAULTS.audio.channels, "normalizeConfig.audio.channels");
assertEqual(defaultCfg.audio.masterVolume, DEFAULTS.audio.masterVolume, "defaultConfig.audio.masterVolume");
assertEqual(normCfg.audio.masterVolume, DEFAULTS.audio.masterVolume, "normalizeConfig.audio.masterVolume");

// 2. Collect all source files (excluding config definition modules) to check key consumption
function collectSourceFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, files);
    } else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

const srcDir = path.join(cinecodeDir, "src");
const allSourceFiles = collectSourceFiles(srcDir);
// Consumer files exclude the config definition files themselves
const consumerFiles = allSourceFiles.filter((f) => {
  const norm = f.replace(/\\/g, "/");
  return !norm.includes("/src/config/schema.ts") &&
         !norm.includes("/src/config/zod-schema.ts") &&
         !norm.includes("/src/config/validator.ts") &&
         !norm.includes("/src/config/defaults.ts") &&
         !norm.includes("/src/config/json-schema.ts");
});

const consumerContents = consumerFiles.map((f) => readFileSync(f, "utf-8")).join("\n");

// Declarative metadata keys in schema that do not require runtime consumers
const DECLARATIVE_METADATA_KEYS = new Set([
  "$schema",
  "extends",
  "schemaVersion",
]);

// 3. Verify every key in NormalizedConfigSchema is consumed or declarative
const schemaShape = NormalizedConfigSchema.shape;
const schemaKeys = Object.keys(schemaShape);

for (const key of schemaKeys) {
  if (DECLARATIVE_METADATA_KEYS.has(key)) continue;

  // Key must appear in at least one consumer module
  const keyRegex = new RegExp(`\\b${key}\\b`);
  if (!keyRegex.test(consumerContents)) {
    fail(`Config schema key '${key}' has no consumer in cinecode codebase`);
  }
}

// 4. Verify binary resolution fails closed on invalid path with CC7004
try {
  resolveBinary("ffmpeg", { binaries: { ffmpegPath: "C:\\cinecode_nonexistent_binary_test\\ffmpeg.exe" }, root: root });
  fail("Expected resolveBinary with invalid configured path to throw CC7004");
} catch (err) {
  if (err?.code !== "CC7004" && !String(err).includes("CC7004")) {
    fail(`Expected CC7004 error for invalid binary path, got: ${err}`);
  }
}

// 5. Verify configured binary provenance
resetBinaryConfig();
const currentFfmpeg = resolveBinary("ffmpeg");
if (currentFfmpeg) {
  // If we configure an existing valid file path
  setBinaryConfig({ ffmpegPath: currentFfmpeg.path, root });
  const reResolved = resolveBinary("ffmpeg");
  if (reResolved.provenance !== "config") {
    fail(`Expected provenance 'config' for configured binary, got '${reResolved.provenance}'`);
  }
  resetBinaryConfig();
}

if (errors > 0) {
  console.error(`check-config-consumers failed with ${errors} error(s).`);
  process.exit(1);
} else {
  console.log("check-config-consumers passed cleanly.");
}
