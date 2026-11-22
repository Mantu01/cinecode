import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const distPaths = path.join(cinecodeDir, "dist", "esm", "media", "paths.js");
const distInspector = path.join(cinecodeDir, "dist", "esm", "media", "inspector.js");
const distValidation = path.join(cinecodeDir, "dist", "esm", "manifest", "validation.js");
const distSchema = path.join(cinecodeDir, "dist", "esm", "config", "json-schema.js");
const distErrors = path.join(cinecodeDir, "dist", "esm", "errors", "codes.js");

if (!existsSync(distPaths) || !existsSync(distInspector)) {
  execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
    cwd: cinecodeDir,
    stdio: "inherit",
  });
}

const {
  resolveMediaFilePath,
  canonicalPathIdentity,
  toPosixPath,
  toPosixRelative,
  isPathInside,
  resolveOutputPath,
} = await import(pathToFileURL(distPaths).href);
const { getMediaType } = await import(pathToFileURL(distInspector).href);
const { validateManifestDocument } = await import(pathToFileURL(distValidation).href);
const { generateReferenceMarkdown } = await import(pathToFileURL(distSchema).href);
const { ErrorCode } = await import(pathToFileURL(distErrors).href);

let errors = 0;
function fail(msg) {
  console.error(`check-media-policy error: ${msg}`);
  errors++;
}

const tmpDir = path.join(root, "node_modules", ".tmp-media-policy-check");
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

const mediaDir = path.join(tmpDir, "media");
const srcDir = path.join(tmpDir, "src");
const outsideDir = path.join(root, "node_modules", ".tmp-media-outside");
if (existsSync(outsideDir)) rmSync(outsideDir, { recursive: true, force: true });

mkdirSync(mediaDir, { recursive: true });
mkdirSync(srcDir, { recursive: true });
mkdirSync(outsideDir, { recursive: true });

try {
  const sampleMedia = path.join(mediaDir, "sample.png");
  writeFileSync(sampleMedia, "sample-image-data");

  const coLocatedMedia = path.join(srcDir, "colocated.png");
  writeFileSync(coLocatedMedia, "colocated-image-data");

  const outsideFile = path.join(outsideDir, "secret.png");
  writeFileSync(outsideFile, "secret-data");

  const rootOnlyFile = path.join(tmpDir, "root-only.png");
  writeFileSync(rootOnlyFile, "root-data");

  // 1. Valid resolution in media root
  const resolvedSample = resolveMediaFilePath("sample.png", tmpDir, { mediaDir: "media" });
  if (!resolvedSample || !existsSync(resolvedSample)) {
    fail("Failed to resolve valid sample.png in media root");
  }

  // 2. Traversal rejection (.. and absolute)
  try {
    resolveMediaFilePath("../secret.png", tmpDir, { mediaDir: "media", allowCoLocatedMedia: false });
    fail("Expected ../ traversal to be rejected with CC1003");
  } catch (err) {
    if (err.code !== ErrorCode.CC1003) {
      fail(`Expected CC1003 for traversal escape, got ${err.code}`);
    }
  }

  try {
    const absEscape = path.resolve(outsideFile);
    resolveMediaFilePath(absEscape, tmpDir, { mediaDir: "media", allowCoLocatedMedia: false });
    fail("Expected absolute path outside media to be rejected with CC1003");
  } catch (err) {
    if (err.code !== ErrorCode.CC1003) {
      fail(`Expected CC1003 for absolute escape, got ${err.code}`);
    }
  }

  // 3. Symlink escape rejection
  let symlinkCreated = false;
  const symlinkPath = path.join(mediaDir, "symlink-outside.png");
  try {
    symlinkSync(outsideFile, symlinkPath);
    symlinkCreated = true;
  } catch {
    // Symlinks may require privilege on Windows, skip if unpermitted
  }

  if (symlinkCreated) {
    try {
      resolveMediaFilePath("symlink-outside.png", tmpDir, { mediaDir: "media", allowCoLocatedMedia: false });
      fail("Expected symlink pointing outside media root to be rejected with CC1003");
    } catch (err) {
      if (err.code !== ErrorCode.CC1003) {
        fail(`Expected CC1003 for symlink escape, got ${err.code}`);
      }
    }
  }

  // 4. Co-located media resolution
  try {
    resolveMediaFilePath("colocated.png", tmpDir, { mediaDir: "media", sourceDir: "src", allowCoLocatedMedia: false });
    fail("Expected colocated.png to fail when allowCoLocatedMedia is false");
  } catch (err) {
    if (err.code !== ErrorCode.CC2001) {
      fail(`Expected CC2001 for missing media when co-location disabled, got ${err.code}`);
    }
  }

  const resolvedCoLocated = resolveMediaFilePath("colocated.png", tmpDir, {
    mediaDir: "media",
    sourceDir: "src",
    allowCoLocatedMedia: true,
  });
  if (!resolvedCoLocated || !existsSync(resolvedCoLocated)) {
    fail("Expected colocated.png to resolve when allowCoLocatedMedia is true");
  }

  // 5. No project root fallback
  try {
    resolveMediaFilePath("root-only.png", tmpDir, { mediaDir: "media", sourceDir: "src", allowCoLocatedMedia: false });
    fail("Expected root-only.png to fail without silent project root fallback");
  } catch (err) {
    if (err.code !== ErrorCode.CC2001) {
      fail(`Expected CC2001 for root-only file, got ${err.code}`);
    }
  }

  // 6. Validator and renderer parity
  const manifestPath = path.join(tmpDir, "main.js");
  const validationResult = await validateManifestDocument(
    {
      audio: [
        { id: "ok-audio", src: "sample.png" },
        { id: "bad-audio", src: "../secret.png" },
      ],
    },
    {
      rootDir: tmpDir,
      manifestPath,
      config: { mediaDir: "media", allowCoLocatedMedia: false },
    },
  );

  const traversalErr = validationResult.errors.find((e) => e.code === ErrorCode.CC1003);
  if (!traversalErr) {
    fail("Expected validator to reject traversal with CC1003 via unified resolver");
  }

  // 7. Case-insensitive extension comparison
  if (getMediaType("foo.PNG") !== "image") fail("Expected foo.PNG to be recognized as image");
  if (getMediaType("bar.Mp4") !== "video") fail("Expected bar.Mp4 to be recognized as video");
  if (getMediaType("baz.WAV") !== "audio") fail("Expected baz.WAV to be recognized as audio");

  // 8. Canonical path identity (differing case / separators match)
  const idLower = canonicalPathIdentity(path.join(mediaDir, "sample.png"));
  const idUpper = canonicalPathIdentity(path.join(mediaDir, "SAMPLE.PNG"));
  if (process.platform === "win32" && idLower !== idUpper) {
    fail(`Expected case-insensitive canonical path identity match on Windows, got ${idLower} vs ${idUpper}`);
  }

  // 9. POSIX relative paths
  const posixRel = toPosixRelative(tmpDir, path.join(mediaDir, "sample.png"));
  if (posixRel !== "media/sample.png") {
    fail(`Expected POSIX relative 'media/sample.png', got '${posixRel}'`);
  }

  // 10. Explicit output path resolves against project root
  const outResolved = resolveOutputPath(tmpDir, "dist/my-video.mp4");
  const expectedOut = path.resolve(tmpDir, "dist/my-video.mp4");
  if (outResolved !== expectedOut) {
    fail(`Expected resolveOutputPath to equal ${expectedOut}, got ${outResolved}`);
  }

  // 11. Four-root rule in generated documentation
  const refDocs = generateReferenceMarkdown();
  if (!refDocs.includes("## Project roots and media policy")) {
    fail("Missing '## Project roots and media policy' in config reference docs");
  }
  if (!refDocs.includes("read-only except for the opt-in")) {
    fail("Missing read-only statement in config reference docs");
  }

} catch (e) {
  fail(`Unexpected error: ${e.message}\n${e.stack}`);
} finally {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  if (existsSync(outsideDir)) rmSync(outsideDir, { recursive: true, force: true });
}

if (errors > 0) {
  console.error(`check-media-policy failed with ${errors} error(s)`);
  process.exit(1);
} else {
  console.log("check-media-policy: all path and media policy checks passed");
}
