import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const distBuilders = path.join(cinecodeDir, "dist", "esm", "core", "clips", "builders.js");
const distFactories = path.join(cinecodeDir, "dist", "esm", "core", "clips", "factories.js");
const distValidation = path.join(cinecodeDir, "dist", "esm", "core", "validation", "timeline.js");
const distTime = path.join(cinecodeDir, "dist", "esm", "core", "time", "index.js");
const distRenderer = path.join(cinecodeDir, "dist", "esm", "renderer", "engine.js");
const distSchema = path.join(cinecodeDir, "dist", "esm", "config", "json-schema.js");

if (!existsSync(distBuilders) || !existsSync(distFactories)) {
  execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
    cwd: cinecodeDir,
    stdio: "inherit",
  });
}

const { sequence, track, audioTrack, subtitleTrack, timeline, composition } = await import(pathToFileURL(distBuilders).href);
const { text, shape, solid, video } = await import(pathToFileURL(distFactories).href);
const { computeClipSpan, validateTimeline } = await import(pathToFileURL(distValidation).href);
const { createConversion } = await import(pathToFileURL(distTime).href);
const { renderFrame } = await import(pathToFileURL(distRenderer).href);
const { generateManifestReferenceMarkdown } = await import(pathToFileURL(distSchema).href);

let errors = 0;
function fail(msg) {
  console.error(`check-builder-semantics error: ${msg}`);
  errors++;
}

try {
  const conversion = createConversion(30);

  // 1. A sequence with a leading transition never validates a negative start
  const leadingClip = solid("#ffffff", {
    duration: 5,
    transitionIn: { name: "crossfade", duration: 1 },
  });
  const secondClip = solid("#000000", { duration: 5 });
  const seqLeading = sequence([leadingClip, secondClip]);

  if (seqLeading.clips[0].start < 0) {
    fail(`Leading clip in sequence has negative start: ${seqLeading.clips[0].start}`);
  }
  if (seqLeading.clips[0].start !== 0) {
    fail(`Leading clip in sequence expected start 0, got ${seqLeading.clips[0].start}`);
  }

  const timelineValidation = validateTimeline(
    timeline([seqLeading]),
    { conversion },
  );
  const outsideErrors = timelineValidation.filter((i) => i.code === "AUTH0004" || i.message.includes("starts before"));
  if (outsideErrors.length > 0) {
    fail(`Sequence with leading transition triggered outsideComposition error: ${outsideErrors[0].message}`);
  }

  // 2. Sequence start is applied
  const seqWithStart = sequence([solid("#ffffff", { duration: 4 })], { start: 2.5 });
  if (seqWithStart.clips[0].start !== 2.5) {
    fail(`Sequence start option not applied; expected 2.5, got ${seqWithStart.clips[0].start}`);
  }

  // 3. Track options (muted, opacity, blend) reach the composition model and unsupported options are rejected
  const customTrack = track("custom", [solid("#ffffff", { duration: 5 })], {
    muted: true,
    opacity: 0.75,
    blend: "multiply",
  });
  if (customTrack.muted !== true) fail(`Track muted not preserved: ${customTrack.muted}`);
  if (customTrack.opacity !== 0.75) fail(`Track opacity not preserved: ${customTrack.opacity}`);
  if (customTrack.blend !== "multiply") fail(`Track blend not preserved: ${customTrack.blend}`);

  try {
    track("bad-track", [], { unsupportedOpt: 123 });
    fail("track with unsupported option should throw CC1014");
  } catch (err) {
    if (err?.code !== "CC1014" || !err.message.includes("unsupportedOpt")) {
      fail(`expected CC1014 naming unsupportedOpt, got: ${err}`);
    }
  }

  // 4. Timeline speed and offset are applied or rejected, never ignored
  const speedTimeline = timeline([track("t1", [solid("#ffffff", { duration: 5 })])], {
    speed: 2,
    offset: 1,
  });
  if (speedTimeline.speed !== 2) fail(`Timeline speed not preserved: ${speedTimeline.speed}`);
  if (speedTimeline.offset !== 1) fail(`Timeline offset not preserved: ${speedTimeline.offset}`);

  try {
    timeline([], { speed: -1 });
    fail("timeline with negative speed should throw CC1012");
  } catch (err) {
    if (err?.code !== "CC1012") fail(`expected CC1012 for negative speed, got: ${err}`);
  }

  try {
    timeline([], { offset: -2 });
    fail("timeline with negative offset should throw CC1012");
  } catch (err) {
    if (err?.code !== "CC1012") fail(`expected CC1012 for negative offset, got: ${err}`);
  }

  try {
    timeline([], { unknownTimelineKey: true });
    fail("timeline with unknown option should throw CC1014");
  } catch (err) {
    if (err?.code !== "CC1014" || !err.message.includes("unknownTimelineKey")) {
      fail(`expected CC1014 naming unknownTimelineKey, got: ${err}`);
    }
  }

  // 5. Nested timeline metadata survives construction
  const innerTimeline = timeline([track("inner-track", [])], {
    name: "nested-inner",
    speed: 1.5,
    offset: 0.25,
    duration: 8,
  });
  const copiedTimeline = timeline(innerTimeline);
  if (copiedTimeline.name !== "nested-inner") fail(`nested name not copied: ${copiedTimeline.name}`);
  if (copiedTimeline.speed !== 1.5) fail(`nested speed not copied: ${copiedTimeline.speed}`);
  if (copiedTimeline.offset !== 0.25) fail(`nested offset not copied: ${copiedTimeline.offset}`);
  if (copiedTimeline.duration !== 8) fail(`nested duration not copied: ${copiedTimeline.duration}`);

  // Explicit option overrides nested metadata
  const overrideTimeline = timeline(innerTimeline, { name: "outer-override", speed: 3 });
  if (overrideTimeline.name !== "outer-override") fail(`override name expected outer-override, got ${overrideTimeline.name}`);
  if (overrideTimeline.speed !== 3) fail(`override speed expected 3, got ${overrideTimeline.speed}`);
  if (overrideTimeline.offset !== 0.25) fail(`offset should still carry over from nested: ${overrideTimeline.offset}`);

  // 6. An unknown clip option fails with the key name and valid keys
  try {
    text("hello", 24, { filll: "#ff0000" });
    fail("text with typo filll should throw CC1014");
  } catch (err) {
    if (err?.code !== "CC1014" || !err.message.includes("filll")) {
      fail(`expected CC1014 naming filll, got: ${err}`);
    }
    if (!err.message.includes("fill") && !err.fixHint?.includes("fill")) {
      fail(`error should list valid keys including fill, got: ${err.message}`);
    }
  }

  try {
    shape("rectangle", { radiusss: 5 });
    fail("shape with typo radiusss should throw CC1014");
  } catch (err) {
    if (err?.code !== "CC1014" || !err.message.includes("radiusss")) {
      fail(`expected CC1014 naming radiusss, got: ${err}`);
    }
  }

  // 7. Unknown transition names fail at construction
  try {
    solid("#ffffff", {
      transitionIn: { name: "nonexistent-super-wipe", duration: 1 },
    });
    fail("clip with unknown transition name should throw CC3007 at construction");
  } catch (err) {
    if (err?.code !== "CC3007" || !err.message.includes("nonexistent-super-wipe")) {
      fail(`expected CC3007 naming nonexistent-super-wipe, got: ${err}`);
    }
  }

  // 8. Timing rules: duration wins over end when both are present
  const durationWinsClip = solid("#ffffff", {
    start: 0,
    end: 10,
    duration: 3,
  });
  const span = computeClipSpan(durationWinsClip, conversion);
  // duration is 3s -> 90 frames; if end won it would be 10s -> 300 frames
  if (span.endFrames !== 90) {
    fail(`duration should win over end: expected endFrames 90, got ${span.endFrames}`);
  }

  // 9. Documentation matches timing and builder rules
  const docs = generateManifestReferenceMarkdown();
  if (!docs.includes("Sequence and track builders")) {
    fail("docs should document Sequence and track builders");
  }
  if (!docs.includes("Timing and keyframe rules")) {
    fail("docs should document Timing and keyframe rules");
  }

} catch (err) {
  fail(`Unexpected exception: ${err?.stack || err}`);
}

if (errors > 0) {
  console.error(`FAILED: ${errors} errors found in check-builder-semantics.`);
  process.exit(1);
} else {
  console.log("PASS: check-builder-semantics passed all checks.");
}
