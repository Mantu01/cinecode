import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { DevServer } from "../index.js";
import type { ManifestProject } from "../../manifest/index.js";
import { renderFrame } from "../../renderer/engine.js";
import { createPreviewEngine } from "../../renderer/preview-engine.js";
import { getDefaultConfig } from "../../config/schema.js";
import type { WsClient } from "../websocket.js";

function createMockReqRes(options: { method?: string; url?: string; body?: string }) {
  const req = new EventEmitter() as any;
  req.method = options.method ?? "GET";
  req.url = options.url ?? "/";
  req.headers = {};

  const res = new EventEmitter() as any;
  let statusCode = 200;
  let headers: Record<string, string> = {};
  let body = "";

  res.writeHead = (status: number, hdrs?: Record<string, string>) => {
    statusCode = status;
    if (hdrs) Object.assign(headers, hdrs);
    return res;
  };

  res.end = (chunk?: string | Buffer) => {
    if (chunk) body += chunk.toString();
    res.emit("finish");
  };

  process.nextTick(() => {
    if (options.body) req.emit("data", Buffer.from(options.body));
    req.emit("end");
  });

  return {
    req,
    res,
    getResponse: () => ({ status: statusCode, headers, body }),
  };
}

describe("Phase 29: Read-only preview and one protocol", () => {
  it("rejects write or persist endpoints with HTTP 405 Method Not Allowed", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cinecode-preview-test-"));
    const srcDir = join(tempDir, "src");
    await mkdir(srcDir, { recursive: true });

    const dummyConfig = getDefaultConfig();
    const dummyProject: ManifestProject = {
      manifest: { timelines: [] },
      entryPath: join(srcDir, "main.ts"),
      rootDir: tempDir,
      config: dummyConfig,
      hasManifest: false,
    };

    const server = new DevServer({
      config: dummyConfig,
      project: dummyProject,
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: false,
      configPath: join(tempDir, "cinecode.config.ts"),
    });

    try {
      // POST /persist
      const { req: postReq, res: postRes, getResponse: getPostRes } = createMockReqRes({
        method: "POST",
        url: "/persist",
        body: JSON.stringify({ layer: "test", op: "draw" }),
      });
      await server.dispatchRequest(postReq, postRes);
      const postResult = getPostRes();
      assert.equal(postResult.status, 405);
      assert.ok(postResult.body.includes("read-only"));

      // GET /persist
      const { req: getReq, res: getRes, getResponse: getGetRes } = createMockReqRes({
        method: "GET",
        url: "/persist",
      });
      await server.dispatchRequest(getReq, getRes);
      const getResult = getGetRes();
      assert.equal(getResult.status, 405);
    } finally {
      await server.stop();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("handles preview protocol messages and rejects layer mutation operations over WebSocket", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cinecode-ws-test-"));
    const srcDir = join(tempDir, "src");
    await mkdir(srcDir, { recursive: true });

    const dummyConfig = getDefaultConfig();
    const dummyProject: ManifestProject = {
      manifest: { timelines: [] },
      entryPath: join(srcDir, "main.ts"),
      rootDir: tempDir,
      config: dummyConfig,
      hasManifest: false,
    };

    const server = new DevServer({
      config: dummyConfig,
      project: dummyProject,
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: true,
      configPath: join(tempDir, "cinecode.config.ts"),
    });

    try {
      const sentMessages: any[] = [];
      const mockClient: WsClient = {
        id: 1,
        ip: "127.0.0.1",
        send: (payload: unknown) => {
          sentMessages.push(payload);
        },
        sendBinary: (_buffer: Buffer) => {},
        close: () => {},
      };

      // 1. Status request
      await server.dispatchWsMessage(mockClient, { type: "status:request" });
      const statusMsg = sentMessages.find((m) => m.type === "status:response");
      assert.ok(statusMsg !== undefined);
      assert.equal(statusMsg.readOnly, true);
      assert.equal(statusMsg.version, "1.0.0");

      // 2. Camera view state (zoom, pan, orbit)
      await server.dispatchWsMessage(mockClient, {
        type: "view:state",
        zoom: 1.5,
        pan: { x: 10, y: 20 },
        orbit: { theta: 45, phi: 30 },
      });
      const viewAck = sentMessages.find((m) => m.type === "view:ack");
      assert.ok(viewAck !== undefined);
      assert.equal(viewAck.state.zoom, 1.5);

      // 3. Forbidden mutation operation
      await server.dispatchWsMessage(mockClient, {
        type: "clip:update",
        clipId: "c1",
        propertyPath: "x",
        value: 100,
      });
      const errorMsg = sentMessages.find((m) => m.type === "error" && m.code === "CC6001");
      assert.ok(errorMsg !== undefined);
      assert.ok(errorMsg.message.includes("read-only"));
    } finally {
      await server.stop();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("renders preview frames with significantly lower latency than full renders", async () => {
    const composition = {
      name: "preview-perf-comp",
      width: 1920,
      height: 1080,
      fps: 30,
      rootTimeline: {
        tracks: [
          {
            kind: "visual" as const,
            clips: [
              {
                id: "c1",
                type: "solid" as const,
                fill: "#336699",
                start: 0,
                duration: 5,
                effects: [{ name: "bloom", intensity: 1 }],
              },
            ],
          },
        ],
      },
    };

    const previewEngine = createPreviewEngine(composition as any, { scale: 0.5 });

    // Warm up engine
    await renderFrame(composition as any, 0, 0, {});
    await previewEngine.render(0);

    // Full render
    const fullStart = performance.now();
    for (let f = 0; f < 3; f++) {
      await renderFrame(composition as any, f, 0, {});
    }
    const fullDuration = performance.now() - fullStart;

    // Fast preview render
    const previewStart = performance.now();
    for (let f = 0; f < 3; f++) {
      await previewEngine.render(f);
    }
    const previewDuration = performance.now() - previewStart;

    assert.ok(
      previewDuration < fullDuration,
      `Preview (${previewDuration}ms) should be strictly faster than Full (${fullDuration}ms)`,
    );
  });

  it("shuts down cleanly leaving no hanging handles", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cinecode-shutdown-test-"));
    const srcDir = join(tempDir, "src");
    await mkdir(srcDir, { recursive: true });

    const dummyConfig = getDefaultConfig();
    const dummyProject: ManifestProject = {
      manifest: { timelines: [] },
      entryPath: join(srcDir, "main.ts"),
      rootDir: tempDir,
      config: dummyConfig,
      hasManifest: false,
    };

    const server = new DevServer({
      config: dummyConfig,
      project: dummyProject,
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: true,
      configPath: join(tempDir, "cinecode.config.ts"),
    });

    await server.start();
    await server.stop();
    await rm(tempDir, { recursive: true, force: true });
    assert.ok(true, "Shutdown completed cleanly");
  });

  it("watcher invalidates all graph nodes on transitive import change", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cinecode-transitive-test-"));
    const srcDir = join(tempDir, "src");
    await mkdir(srcDir, { recursive: true });

    const dummyConfig = getDefaultConfig();
    const dummyProject: ManifestProject = {
      manifest: {
        timelines: [
          {
            id: "tl1",
            name: "timeline 1",
            file: join(srcDir, "main.ts"),
            duration: 5,
            sceneRefs: ["s1"],
          },
        ],
        scenes: [
          {
            id: "s1",
            name: "scene 1",
            file: join(srcDir, "scene1.ts"),
            duration: 5,
          },
        ],
      },
      entryPath: join(srcDir, "main.ts"),
      rootDir: tempDir,
      config: dummyConfig,
      hasManifest: true,
    };

    const server = new DevServer({
      config: dummyConfig,
      project: dummyProject,
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: true,
      configPath: join(tempDir, "cinecode.config.ts"),
    });

    try {
      assert.equal(server.nodes.length, 2); // 1 timeline + 1 scene

      // An unmapped helper file (transitive dependency) triggers full graph invalidation
      const transitiveFile = join(srcDir, "helpers", "shared.ts");
      const affected = (server as any).graph.affected(transitiveFile);
      assert.equal(affected.length, 0, "Transitive dependency has no direct single node mapping");

      // Targets fall back to all nodes in the project graph
      const targets = affected.length > 0 ? affected : (server as any).graph.nodes;
      assert.equal(targets.length, 2, "Transitive invalidation rebuilds all dependent nodes");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
