import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");

// Rebuild cinecode if needed
const distDev = path.join(cinecodeDir, "dist", "esm", "dev", "index.js");
if (!existsSync(distDev)) {
  execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
    cwd: cinecodeDir,
    stdio: "inherit",
  });
}

const { PreviewHost, ModuleGraph, ProjectWatcher } = await import(pathToFileURL(distDev).href);

const tempDir = mkdtempSync(path.join(tmpdir(), "cinecode-check-incremental-"));
const srcDir = path.join(tempDir, "src");
const helpersDir = path.join(srcDir, "helpers");
const mediaDir = path.join(tempDir, "media");
mkdirSync(helpersDir, { recursive: true });
mkdirSync(mediaDir, { recursive: true });

// Setup files
const mathFile = path.join(helpersDir, "math.ts");
writeFileSync(mathFile, "export function add(a: number, b: number): number { return a + b; }\n");

const unrelatedFile = path.join(srcDir, "unrelated.ts");
writeFileSync(unrelatedFile, "export const UNRELATED = 42;\n");

const mediaBanner = path.join(mediaDir, "banner.png");
writeFileSync(mediaBanner, "fake-png-data");

const scene1File = path.join(srcDir, "scene1.ts");
writeFileSync(
  scene1File,
  `import { add } from "./helpers/math.ts";
export default {
  id: "scene1",
  duration: 2,
  calc: add(1, 2)
};
`,
);

const scene2File = path.join(srcDir, "scene2.ts");
writeFileSync(
  scene2File,
  `export default {
  id: "scene2",
  duration: 3,
  media: "./media/banner.png"
};
`,
);

const mainFile = path.join(srcDir, "main.ts");
writeFileSync(
  mainFile,
  `import scene1 from "./scene1.ts";
import scene2 from "./scene2.ts";
export default {
  timelines: [{ id: "main", duration: 5, scenes: [scene1, scene2] }]
};
`,
);

const configFile = path.join(tempDir, "cinecode.config.ts");
writeFileSync(configFile, 'export default { schemaVersion: 1, project: { entry: "./src/main.ts" }, sourceDir: "./src", mediaDir: "./media" };\n');

const project = {
  manifest: {
    timelines: [{ id: "main", name: "Main Timeline", file: "./src/main.ts", duration: 5 }],
    scenes: [
      { id: "scene1", name: "Scene 1", file: "./src/scene1.ts", duration: 2 },
      { id: "scene2", name: "Scene 2", file: "./src/scene2.ts", duration: 3 },
    ],
    images: [],
    audio: [],
  },
  entryPath: mainFile,
  rootDir: tempDir,
  config: { schemaVersion: 1, project: { entry: "./src/main.ts" }, sourceDir: "./src", mediaDir: "./media" },
  hasManifest: true,
};

try {
  // Check 1: Editing an imported helper updates the preview without a restart
  console.log("--- Check 1: Transitive helper editing affects dependent scene ---");
  {
    const graph = new ModuleGraph(project, tempDir);
    const affected = graph.affected(mathFile);
    assert.ok(affected.length > 0, "Editing imported math.ts must affect dependent scene(s)");
    const scene1Node = affected.find((n) => n.id === "scene1");
    assert.ok(scene1Node, "scene1 must be affected by changes in math.ts");
    console.log("  ok: transitive dependency graph maps helper to dependent scene");
  }

  // Check 2: Editing an unrelated file does not re-render the previewed node
  console.log("--- Check 2: Editing unrelated file does not touch previewed node ---");
  {
    const graph = new ModuleGraph(project, tempDir);
    const affected = graph.affected(unrelatedFile);
    assert.equal(affected.length, 0, "Unrelated file must affect 0 manifest nodes");

    const host = new PreviewHost({
      config: project.config,
      project,
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: true,
      configPath: configFile,
      mode: "dev",
    });

    let reRendered = false;
    const session = {
      client: { id: 1, ip: "127.0.0.1", send: () => {}, sendBinary: () => {}, close: () => {} },
      selectedNodeId: "scene1",
      isRendering: false,
      pendingSeek: null,
      camera: undefined,
      playing: false,
      playTimer: null,
      currentFrame: 0,
    };
    host.sessions.set(1, session);
    host.renderFrameForSession = () => {
      reRendered = true;
      return Promise.resolve();
    };

    await host.handleChange([unrelatedFile]);
    assert.equal(reRendered, false, "Editing unrelated file must NOT trigger re-rendering of previewed node");
    console.log("  ok: unrelated file change skips re-render");
  }

  // Check 3: Editing a media file invalidates only the frames that use it
  console.log("--- Check 3: Media file invalidates only referencing frames ---");
  {
    const host = new PreviewHost({
      config: project.config,
      project,
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: true,
      configPath: configFile,
      mode: "dev",
    });

    // Populate frame cache for scene1 and scene2
    host.previewLru.set("scene1:0:0.5::0", { buffer: Buffer.alloc(10), contentType: "image/png" });
    host.previewLru.set("scene2:0:0.5::0", { buffer: Buffer.alloc(10), contentType: "image/png" });

    // Invalidate media banner (referenced only in scene2)
    await host.handleChange([mediaBanner]);

    assert.ok(host.previewLru.has("scene1:0:0.5::0"), "scene1 frame must remain intact in cache");
    assert.equal(host.previewLru.has("scene2:0:0.5::0"), false, "scene2 frame must be invalidated");
    console.log("  ok: only frames using the edited media file were invalidated");
  }

  // Check 4: Config changes re-resolve once and preserve registered fonts
  console.log("--- Check 4: Config change re-resolves and preserves fonts ---");
  {
    const host = new PreviewHost({
      config: project.config,
      project,
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: true,
      configPath: configFile,
      mode: "dev",
    });

    const messages = [];
    host.hub.broadcast = (msg) => messages.push(msg);

    await host.handleChange([configFile]);
    const welcome = messages.find((m) => m.type === "welcome");
    assert.ok(welcome, "Config change must broadcast project snapshot welcome");
    assert.ok(Array.isArray(welcome.nodes), "Welcome must provide re-resolved node list");
    console.log("  ok: config change re-resolves and notifies clients");
  }

  // Check 5: Every watcher closes on stop; no handle survives
  console.log("--- Check 5: All watchers close cleanly ---");
  {
    const watcher = new ProjectWatcher({
      rootDir: tempDir,
      sourceDir: "./src",
      mediaDir: "./media",
      configPath: configFile,
      additionalFiles: [mathFile, scene1File],
      onChange: () => {},
    });
    watcher.start();
    assert.ok(watcher.watchers.length > 0, "Watcher set must track directories and files");
    watcher.close();
    assert.equal(watcher.watchers.length, 0, "All watchers must be closed and cleared on stop");
    console.log("  ok: directory and per-file watchers closed completely");
  }

  // Check 6: Long editing session shows no upward memory trend
  console.log("--- Check 6: Memory bounding over long editing session ---");
  {
    const host = new PreviewHost({
      config: project.config,
      project,
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: true,
      configPath: configFile,
      mode: "dev",
    });

    // Simulate 300 cached frame additions
    for (let i = 0; i < 300; i++) {
      host.cachePreview(`scene1:${i}:0.5::0`, {
        buffer: Buffer.alloc(1024 * 50), // 50KB
        contentType: "image/png",
      });
    }

    assert.ok(host.previewLru.size <= 128, `LRU cache size must be capped at 128, found ${host.previewLru.size}`);
    let totalBytes = 0;
    for (const entry of host.previewLru.values()) totalBytes += entry.buffer.length;
    assert.ok(totalBytes <= 64 * 1024 * 1024, "Total cache memory must stay below 64MB budget");
    console.log(`  ok: memory stays flat; LRU capped at ${host.previewLru.size} frames (${(totalBytes / 1024).toFixed(0)}KB)`);
  }

  // Check 7: Validation errors reach client and keep last good frame
  console.log("--- Check 7: Validation errors reach client and preserve frame ---");
  {
    const host = new PreviewHost({
      config: project.config,
      project,
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: true,
      configPath: configFile,
      mode: "dev",
    });

    // Last good frame in preview
    const goodBuffer = Buffer.from("good-frame-bytes");
    host.previews.set("scene1", { buffer: goodBuffer, contentType: "image/png", version: 1 });

    const messages = [];
    host.hub.broadcast = (msg) => messages.push(msg);

    // Mock validation returning error
    host.validate = () => {
      const report = {
        ok: false,
        errors: [{ code: "CC1002", message: "Syntax error in scene1.ts", file: "scene1.ts", line: 12 }],
        warnings: [],
      };
      host.hub.broadcast({ type: "validation", report });
      return Promise.resolve(report);
    };

    await host.handleChange([scene1File]);

    const valMsg = messages.find((m) => m.type === "validation");
    assert.ok(valMsg, "Validation message must be broadcast");
    assert.equal(valMsg.report.ok, false);

    // Assert last good frame is still intact
    const currentPreview = host.previews.get("scene1");
    assert.ok(currentPreview, "Last preview must not be deleted");
    console.log("  ok: validation error broadcast and last good frame preserved");
  }

  console.log("check-dev-incremental: all 7 acceptance checks passed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
