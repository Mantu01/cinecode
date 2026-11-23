import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createProjectResolver } from "../resolve/project-resolver.js";
import { downloadFileAtomic } from "../pipeline/media-download.js";
import { ensureGitignoreEntries } from "../../config/gitignore.js";
import { ErrorCode } from "../../errors/index.js";

const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

function makeProject(options: {
  config?: Record<string, unknown>;
  files?: Record<string, string | Buffer>;
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), "cinecode-media-roots-"));
  const config = {
    schemaVersion: 2,
    project: {
      entry: "./main.ts",
      sourceDir: "./src",
      mediaDir: "./media",
      outputDir: "./output",
      cacheDir: "./.cache",
    },
    video: { width: 320, height: 240, fps: 24, background: "#000000" },
    ...options.config,
  };
  writeFileSync(join(root, "cinecode.config.json"), JSON.stringify(config, null, 2));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "media"), { recursive: true });

  const defaultMain = `
export default {
  timelines: [{ id: "t1", duration: 1, sceneRefs: ["s1"] }],
  scenes: [{ id: "s1", file: "./src/scene.ts" }],
};
`;
  const defaultScene = `export default { kind: "scene", duration: 1, tracks: [] };\n`;

  writeFileSync(join(root, "main.ts"), defaultMain);
  writeFileSync(join(root, "src", "scene.ts"), defaultScene);

  for (const [relPath, content] of Object.entries(options.files ?? {})) {
    const fullPath = join(root, relPath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

test("media reference found in media root", async () => {
  const root = makeProject({
    files: {
      "media/logo.png": TINY_PNG,
    },
  });
  const resolver = createProjectResolver({ root });
  const resolution = await resolver.resolve();
  const media = await resolution.media();
  const resolved = await media.catalog.resolve("logo.png");
  assert.equal(resolved.name, "logo.png");
  assert.equal(resolved.path, resolve(root, "media", "logo.png"));
  assert.equal(resolved.type, "image");
});

test("found co-located under source root when explicitly allowed", async () => {
  const root = makeProject({
    config: {
      allowCoLocatedMedia: true,
    },
    files: {
      "src/co-logo.png": TINY_PNG,
    },
  });
  const resolver = createProjectResolver({ root });
  const resolution = await resolver.resolve();
  const media = await resolution.media();
  const resolved = await media.catalog.resolve("co-logo.png");
  assert.equal(resolved.name, "co-logo.png");
  assert.equal(resolved.path, resolve(root, "src", "co-logo.png"));

  // When allowCoLocatedMedia is false, co-located lookup is refused
  const rootDisallowed = makeProject({
    config: {
      allowCoLocatedMedia: false,
    },
    files: {
      "src/co-logo.png": TINY_PNG,
    },
  });
  const resolverDisallowed = createProjectResolver({ root: rootDisallowed });
  const resolutionDisallowed = await resolverDisallowed.resolve();
  const mediaDisallowed = await resolutionDisallowed.media();
  await assert.rejects(mediaDisallowed.catalog.resolve("co-logo.png"), (error: any) => {
    assert.equal(error.code, ErrorCode.CC2001);
    assert.match(error.message, /co-located search disabled/);
    return true;
  });
});

test("missing media reference reports searched locations in error", async () => {
  const root = makeProject();
  const resolver = createProjectResolver({ root });
  const resolution = await resolver.resolve();
  const media = await resolution.media();
  await assert.rejects(media.catalog.resolve("nonexistent.mp4"), (error: any) => {
    assert.equal(error.code, ErrorCode.CC2001);
    assert.match(error.message, /Searched locations:/);
    assert.ok(error.message.includes(resolve(root, "media", "nonexistent.mp4")));
    return true;
  });
});

test("atomic download failure leaves no partial file in media tree", async () => {
  const root = makeProject();
  const mediaDir = join(root, "media");
  const destPath = join(mediaDir, "test.dat");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("corrupted or mismatched payload", { status: 200 });

  try {
    // Provide an expected hash that will mismatch
    await assert.rejects(
      downloadFileAtomic("http://example.com/test.dat", destPath, "0000000000000000000000000000000000000000000000000000000000000000", { mediaDir }),
      (err: any) => {
        assert.equal(err.code, ErrorCode.CC6003);
        return true;
      },
    );

    // Verify neither target nor any .tmp file exists
    assert.equal(existsSync(destPath), false);
    const files = readdirSync(mediaDir);
    assert.equal(files.filter((f) => f.includes(".tmp")).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("downloader refuses to target source directory", async () => {
  const root = makeProject();
  const sourceDir = join(root, "src");
  const targetInSource = join(sourceDir, "asset.png");

  await assert.rejects(
    downloadFileAtomic("http://127.0.0.1:9999/asset.png", targetInSource, undefined, {
      mediaDir: join(root, "media"),
      sourceDir,
    }),
    (err: any) => {
      assert.equal(err.code, ErrorCode.CC1010);
      assert.match(err.message, /refusing to target authored source/i);
      return true;
    },
  );
  assert.equal(existsSync(targetInSource), false);
});

test("ignore-file never adds authored source root", async () => {
  const root = makeProject();
  const added = await ensureGitignoreEntries({
    sourceDir: "src",
    mediaDir: "media",
    outputDir: "output",
    cacheDir: ".cinecode/cache",
    projectRoot: root,
    enabled: true,
    ignoreMedia: false,
  });

  const content = readFileSync(join(root, ".gitignore"), "utf-8");
  assert.ok(!content.includes("src"), "source directory must never be added to gitignore");
  assert.ok(content.includes("output"));
  assert.ok(content.includes(".cinecode/cache"));
  assert.ok(!content.includes("media"));
  assert.deepEqual(added, ["output", ".cinecode/cache"]);
});

test("media listing truthfully reports real type, presence and referenced-by with no duplicates", async () => {
  const root = makeProject({
    files: {
      "media/video.mp4": Buffer.alloc(100),
      "media/sample.wav": Buffer.alloc(50),
      "main.ts": `
export default {
  timelines: [{ id: "t1", duration: 1, sceneRefs: ["s1"] }],
  scenes: [{ id: "s1", file: "./src/scene.ts" }],
  audio: [{ id: "a1", src: "sample.wav", duration: 1 }],
};
`,
    },
  });

  const resolver = createProjectResolver({ root });
  const resolution = await resolver.resolve();
  const media = await resolution.media();
  const list = media.index.list();

  // Find sample.wav
  const sample = list.find((e) => e.name === "sample.wav");
  assert.ok(sample, "sample.wav must be in index");
  assert.equal(sample.type, "audio");
  assert.equal(sample.state, "referenced");
  assert.ok(sample.referencedBy.includes("audio:a1"));

  // Find video.mp4
  const video = list.find((e) => e.name === "video.mp4");
  assert.ok(video, "video.mp4 must be in index");
  assert.equal(video.type, "video");
  assert.equal(video.state, "unreferenced");

  // Ensure no duplicate paths in index
  const paths = list.map((e) => e.absolutePath);
  const uniquePaths = new Set(paths);
  assert.equal(paths.length, uniquePaths.size, "Media index must contain no duplicate entries");
});
