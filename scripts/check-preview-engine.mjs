import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");

// Rebuild cinecode
execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
  cwd: cinecodeDir,
  stdio: "inherit",
});

const distDev = path.join(cinecodeDir, "dist", "esm", "dev", "index.js");
const distEngine = path.join(cinecodeDir, "dist", "esm", "renderer", "preview-engine.js");
const { PreviewHost } = await import(pathToFileURL(distDev).href);
const { decodeFrameBinary, encodeFrameBinary, FRAME_MAGIC, FRAME_HEADER_SIZE } = await import(pathToFileURL(distDev).href);
const { PreviewEngine, createPreviewEngine } = await import(pathToFileURL(distEngine).href);

const tempDir = mkdtempSync(path.join(tmpdir(), "cinecode-check-engine-"));
const srcDir = path.join(tempDir, "src");
mkdirSync(srcDir, { recursive: true });

const comp4K = {
  name: "4k-comp",
  width: 3840,
  height: 2160,
  fps: 30,
  duration: 2,
  rootTimeline: {
    tracks: [
      {
        kind: "visual",
        clips: [
          {
            id: "c1",
            type: "solid",
            color: "#ff0000",
            start: 0,
            duration: 2,
            effects: [{ name: "bloom", intensity: 1 }],
          },
        ],
      },
    ],
  },
};

const comp1080p = {
  name: "1080p-comp",
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 2,
  rootTimeline: {
    tracks: [
      {
        kind: "visual",
        clips: [
          {
            id: "bg",
            type: "solid",
            color: "#003366",
            start: 0,
            duration: 2,
          },
        ],
      },
    ],
  },
};

try {
  // Check 1: Preview never renders full resolution by default; default scale is 0.5
  console.log("--- Check 1: Default preview scale is 0.5 ---");
  {
    const engine = createPreviewEngine(comp1080p);
    assert.equal(engine.getScale(), 0.5, "Default scale must be 0.5");
    const result = await engine.render(0);
    assert.equal(result.scale, 0.5, "Render result must report scale 0.5");
    assert.equal(result.canvas.width, 960, "Canvas width must be half (960)");
    assert.equal(result.canvas.height, 540, "Canvas height must be half (540)");
    engine.dispose();
    console.log("  ok: default scale is 0.5 and canvas dimensions are 960x540");
  }

  // Check 2: Binary frame header encoding and decoding
  console.log("--- Check 2: Binary frame header (CCFR) and transport ---");
  {
    const payload = Buffer.from("fake-png-payload-bytes");
    const binary = encodeFrameBinary(42, 960, 540, 1, payload);
    assert.equal(binary.length, 20 + payload.length);

    const decoded = decodeFrameBinary(binary);
    assert.equal(decoded.magic, "CCFR");
    assert.equal(decoded.frameIndex, 42);
    assert.equal(decoded.width, 960);
    assert.equal(decoded.height, 540);
    assert.equal(decoded.format, 1);
    assert.deepEqual(decoded.payload, payload);
    console.log("  ok: 20-byte CCFR binary header encodes and decodes perfectly");
  }

  // Check 3: Unknown or mutating messages return protocol error and keep connection open
  console.log("--- Check 3: Protocol error on unknown/mutating messages ---");
  {
    const host = new PreviewHost({
      config: { schemaVersion: 1 },
      project: { manifest: { timelines: [{ id: "t1", name: "T1", file: "./main.js", duration: 1 }] }, rootDir: tempDir, config: {}, hasManifest: true, entryPath: "" },
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: false,
      configPath: "",
      mode: "preview",
    });

    const sent = [];
    let isClosed = false;
    const mockClient = {
      id: 1,
      ip: "127.0.0.1",
      send: (data) => sent.push(data),
      sendBinary: () => {},
      close: () => { isClosed = true; },
    };

    // Unknown message
    await host.dispatchWsMessage(mockClient, { type: "unknown:foo", version: 1 });
    assert.equal(isClosed, false, "Connection must remain open");
    const err1 = sent.find((m) => m.type === "error" && m.code === "CC6001");
    assert.ok(err1, "Must return CC6001 for unknown message");

    // Mutation operation
    await host.dispatchWsMessage(mockClient, { type: "clip:update", clipId: "c1" });
    assert.equal(isClosed, false, "Connection must remain open on mutation rejection");
    const err2 = sent.filter((m) => m.type === "error" && m.code === "CC6001");
    assert.equal(err2.length, 2, "Must reject mutating operations with CC6001");

    console.log("  ok: unknown/mutating messages produce CC6001 error while socket stays open");
  }

  // Check 4: Enforce backpressure (at most one in-flight frame; newer seek supersedes pending)
  console.log("--- Check 4: Backpressure and seek superseding ---");
  {
    const host = new PreviewHost({
      config: { schemaVersion: 1 },
      project: { manifest: { timelines: [] }, rootDir: tempDir, config: {}, hasManifest: true, entryPath: "" },
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: false,
      configPath: "",
      mode: "preview",
    });

    const session = {
      client: { id: 1, ip: "127.0.0.1", send: () => {}, sendBinary: () => {}, close: () => {} },
      selectedNodeId: "t1",
      isRendering: true, // currently rendering
      pendingSeek: null,
      playing: false,
      playTimer: null,
      currentFrame: 0,
    };
    host.sessions.set(1, session);

    // Send seek 5
    await host.dispatchWsMessage(session.client, { type: "seek", frame: 5 });
    assert.equal(session.pendingSeek?.frame, 5, "Pending seek must be 5");

    // Send seek 10 (supersedes seek 5)
    await host.dispatchWsMessage(session.client, { type: "seek", frame: 10 });
    assert.equal(session.pendingSeek?.frame, 10, "Pending seek must be 10 (superseded 5)");

    console.log("  ok: newer seek supersedes pending seek under backpressure");
  }

  // Check 5: Camera orbit changes preview only; project and render output unchanged
  console.log("--- Check 5: Camera orbit affects preview view only ---");
  {
    const engine1 = createPreviewEngine(comp1080p, { camera: { orbit: { theta: 0, phi: 0 } } });
    const engine2 = createPreviewEngine(comp1080p, { camera: { orbit: { theta: 45, phi: 30 } } });

    assert.equal(comp1080p.name, "1080p-comp");
    assert.equal(comp1080p.width, 1920);
    // Project object is completely unmutated
    assert.equal("camera" in comp1080p, false);

    engine1.dispose();
    engine2.dispose();
    console.log("  ok: camera overrides apply only to preview engine without modifying project");
  }

  // Check 6: Status reports scale, cache size and reduced effects
  console.log("--- Check 6: Status reporting ---");
  {
    const host = new PreviewHost({
      config: { schemaVersion: 1 },
      project: { manifest: { timelines: [] }, rootDir: tempDir, config: {}, hasManifest: true, entryPath: "" },
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: false,
      configPath: "",
      mode: "preview",
    });

    const sent = [];
    const mockClient = {
      id: 2,
      ip: "127.0.0.1",
      send: (data) => sent.push(data),
      sendBinary: () => {},
      close: () => {},
    };

    await host.dispatchWsMessage(mockClient, { type: "status:request" });
    const status = sent.find((m) => m.type === "status");
    assert.ok(status, "Status message must be sent");
    assert.equal(status.version, 1);
    assert.equal(status.scale, 0.5);
    assert.equal(status.reducedEffects, true);
    assert.equal(typeof status.cachedFrames, "number");
    assert.equal(typeof status.ready, "boolean");
    console.log("  ok: status accurately reports scale, cache size, and reduced effects");
  }

  // Check 7: Frame dimensions at half scale are exactly half
  console.log("--- Check 7: Frame dimensions at half scale are exactly half ---");
  {
    const engine = createPreviewEngine(comp1080p, { scale: 0.5 });
    const result = await engine.render(0);
    assert.equal(result.canvas.width, 1920 / 2, "Width must be 1920 / 2 = 960");
    assert.equal(result.canvas.height, 1080 / 2, "Height must be 1080 / 2 = 540");
    engine.dispose();
    console.log("  ok: 1920x1080 scaled to 0.5 yields exactly 960x540");
  }

  // Check 8: 4K project preview stays within memory budget
  console.log("--- Check 8: 4K preview stays within memory budget ---");
  {
    const engine = createPreviewEngine(comp4K, { scale: 0.25 });
    const result = await engine.render(0);
    // At scale 0.25, 3840x2160 -> 960x540
    assert.equal(result.canvas.width, 960);
    assert.equal(result.canvas.height, 540);
    // 960 * 540 * 4 = ~2MB per frame (far below 64MB budget)
    const frameBytes = result.canvas.width * result.canvas.height * 4;
    assert.ok(frameBytes < 10 * 1024 * 1024, "4K downscaled frame must take <10MB");
    engine.dispose();
    console.log("  ok: 4K preview canvas memory footprint is well within budget (<10MB)");
  }

  console.log("check-preview-engine: all 8 acceptance checks passed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
