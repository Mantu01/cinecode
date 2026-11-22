import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const distDefinitions = path.join(cinecodeDir, "dist", "esm", "core", "define", "definitions.js");
const distManifest = path.join(cinecodeDir, "dist", "esm", "manifest", "index.js");
const distValidation = path.join(cinecodeDir, "dist", "esm", "manifest", "validation.js");
const distTarget = path.join(cinecodeDir, "dist", "esm", "manifest", "target.js");
const distRender = path.join(cinecodeDir, "dist", "esm", "cli", "render.js");
const distSchema = path.join(cinecodeDir, "dist", "esm", "config", "json-schema.js");
const distErrors = path.join(cinecodeDir, "dist", "esm", "errors", "codes.js");

if (!existsSync(distDefinitions) || !existsSync(distManifest)) {
  execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
    cwd: cinecodeDir,
    stdio: "inherit",
  });
}

const { defineSound } = await import(pathToFileURL(distDefinitions).href);
const { resolveAudioBuffer, assembleAudioTracks } = await import(pathToFileURL(distManifest).href);
const { validateManifestDocument } = await import(pathToFileURL(distValidation).href);
const { resolveCompositionGeometry } = await import(pathToFileURL(distTarget).href);
const { assertFormatFlags } = await import(pathToFileURL(distRender).href);
const { generateManifestReferenceMarkdown } = await import(pathToFileURL(distSchema).href);
const { ErrorCode } = await import(pathToFileURL(distErrors).href);

let errors = 0;
function fail(msg) {
  console.error(`check-audio-contract error: ${msg}`);
  errors++;
}

const tmpDir = path.join(root, "node_modules", ".tmp-audio-check");
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

try {
  // 1. Sound definition produces declared duration at resolved rate and channel count
  const soundFile = path.join(tmpDir, "sound-gen.js");
  writeFileSync(
    soundFile,
    `import { defineSound } from "${pathToFileURL(distDefinitions).href}";
export default defineSound("synth", (ctx) => {
  for (let i = 0; i < ctx.lengthSamples; i++) {
    const s = Math.sin((i / ctx.sampleRate) * 440 * 2 * Math.PI);
    ctx.write(i, s, s);
  }
});
`,
  );

  const mockProject = {
    rootDir: tmpDir,
    entryPath: path.join(tmpDir, "main.js"),
    config: { video: { fps: 30 }, audio: { sampleRate: 44100, channels: 1 } },
    manifest: {
      audio: [
        {
          id: "synth-audio",
          file: "./sound-gen.js",
          sampleRate: 44100,
          channels: 1,
          duration: 2.5,
          gain: 0.8,
        },
      ],
      timelines: [],
    },
  };

  const buffer = await resolveAudioBuffer(mockProject, "synth-audio");
  if (buffer.sampleRate !== 44100) {
    fail(`Expected sampleRate 44100, got ${buffer.sampleRate}`);
  }
  if (buffer.channels !== 1) {
    fail(`Expected channels 1, got ${buffer.channels}`);
  }
  const expectedLength = Math.round(44100 * 2.5);
  if (buffer.length !== expectedLength) {
    fail(`Expected length ${expectedLength}, got ${buffer.length}`);
  }

  // 2. Reject sound definition whose duration cannot be produced by its generator
  const soundFixedFile = path.join(tmpDir, "sound-fixed.js");
  writeFileSync(
    soundFixedFile,
    `import { defineSound } from "${pathToFileURL(distDefinitions).href}";
export default defineSound("fixed", (ctx) => {}, { duration: 1.0 });
`,
  );

  const mockProjectFixed = {
    rootDir: tmpDir,
    entryPath: path.join(tmpDir, "main.js"),
    config: { video: { fps: 30 } },
    manifest: {
      audio: [
        {
          id: "fixed-audio",
          file: "./sound-fixed.js",
          duration: 3.0,
        },
      ],
      timelines: [],
    },
  };

  try {
    await resolveAudioBuffer(mockProjectFixed, "fixed-audio");
    fail("Expected resolveAudioBuffer to throw CC5002 for mismatched duration");
  } catch (err) {
    if (err.code !== ErrorCode.CC5002) {
      fail(`Expected error CC5002 for mismatched sound duration, got ${err.code}`);
    }
  }

  // 3. Audio placement model: one bed per timeline, starting at 0, spanning duration with gain
  const placementProject = {
    rootDir: tmpDir,
    config: { video: { fps: 30 } },
    manifest: {
      audio: [
        { id: "bed-1", file: "./sound-gen.js", gain: 0.5 },
      ],
    },
  };
  const { placements } = await assembleAudioTracks(placementProject, ["bed-1"], 10.0);
  if (placements.length !== 1) {
    fail(`Expected 1 placement, got ${placements.length}`);
  } else {
    const p = placements[0];
    if (p.id !== "bed-1" || p.start !== 0 || p.duration !== 10.0 || p.gain !== 0.5) {
      fail(`Placement incorrect: ${JSON.stringify(p)}`);
    }
  }

  // 4. Reject placement settings mixer cannot honor (gain > 4, invalid sample rates, invalid channels)
  const validationRes = await validateManifestDocument(
    {
      audio: [
        { id: "bad-gain", file: "./sound-gen.js", gain: 5 },
        { id: "bad-rate", file: "./sound-gen.js", sampleRate: 12345 },
        { id: "bad-ch", file: "./sound-gen.js", channels: 4 },
      ],
    },
    {
      rootDir: tmpDir,
      manifestPath: path.join(tmpDir, "main.js"),
      config: { video: { fps: 30 } },
    },
  );

  const gainErr = validationRes.errors.find((e) => e.message?.includes("gain must be a number between 0 and 4"));
  if (!gainErr) fail("Expected validation error for gain > 4");

  const rateErr = validationRes.errors.find((e) => e.message?.includes("sampleRate must be one of"));
  if (!rateErr) fail("Expected validation error for invalid sampleRate");

  const chErr = validationRes.errors.find((e) => e.message?.includes("channels must be 1 (mono) or 2 (stereo)"));
  if (!chErr) fail("Expected validation error for invalid channels");

  // 5. Reject audio on non-audio plan before rendering
  try {
    resolveCompositionGeometry({
      entry: {
        id: "t1",
        format: "gif",
        audioRef: ["bed-1"],
      },
      config: {},
      kind: "timeline",
    });
    fail("Expected resolveCompositionGeometry to reject audio on gif format with CC1008");
  } catch (err) {
    if (err.code !== ErrorCode.CC1008) {
      fail(`Expected error CC1008 for audio on gif format, got ${err.code}`);
    }
  }

  try {
    assertFormatFlags("gif", { withAudio: true });
    fail("Expected assertFormatFlags to reject --with-audio on gif with CC1008");
  } catch (err) {
    if (err.code !== ErrorCode.CC1008) {
      fail(`Expected error CC1008 for --with-audio on gif format, got ${err.code}`);
    }
  }

  try {
    assertFormatFlags("png", { audioCodec: "aac" });
    fail("Expected assertFormatFlags to reject --audio-codec on png with CC1008");
  } catch (err) {
    if (err.code !== ErrorCode.CC1008) {
      fail(`Expected error CC1008 for --audio-codec on png format, got ${err.code}`);
    }
  }

  // 6. Documentation describes audio placement, gain range, sample rates, channels and trim policy
  const docs = generateManifestReferenceMarkdown();
  if (!docs.includes("## Audio placement")) {
    fail("Manifest reference markdown missing '## Audio placement' section");
  }
  if (!docs.includes("gain` is linear (`0`")) {
    fail("Manifest reference markdown missing linear gain specification");
  }
  if (!docs.includes("22050, 44100, 48000, 96000 Hz")) {
    fail("Manifest reference markdown missing supported sample rates");
  }
  if (!docs.includes("no time stretching")) {
    fail("Manifest reference markdown missing trim policy stating no time stretching");
  }

} catch (e) {
  fail(`Unexpected exception: ${e.message}\n${e.stack}`);
} finally {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
}

if (errors > 0) {
  console.error(`check-audio-contract failed with ${errors} error(s)`);
  process.exit(1);
} else {
  console.log("check-audio-contract: all acceptance checks passed");
}
