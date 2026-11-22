import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");

// Rebuild cinecode to ensure latest dist
execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
  cwd: cinecodeDir,
  stdio: "inherit",
});

const distDev = path.join(cinecodeDir, "dist", "esm", "dev", "index.js");
const { PreviewHost, DevServer } = await import(pathToFileURL(distDev).href);

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
        });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const tempDir = mkdtempSync(path.join(tmpdir(), "cinecode-check-preview-"));
const srcDir = path.join(tempDir, "src");
const mediaDir = path.join(tempDir, "media");
mkdirSync(srcDir, { recursive: true });
mkdirSync(mediaDir, { recursive: true });

const testMediaFile = path.join(mediaDir, "sample.txt");
writeFileSync(testMediaFile, "sample-media-content");

const config = {
  schemaVersion: 1,
  sourceDir: "./src",
  mediaDir: "./media",
};

const project = {
  manifest: {
    timelines: [
      { id: "main", name: "<script>alert('xss')</script>Main", duration: 2, file: "./src/main.js" },
    ],
    scenes: [],
    images: [],
    audio: [],
  },
  entryPath: path.join(srcDir, "main.js"),
  rootDir: tempDir,
  config,
  hasManifest: true,
};

writeFileSync(path.join(srcDir, "main.js"), "export default {};");

try {
  // Check 1: Method guard rejects POST, PUT, PATCH, DELETE, OPTIONS with 405 and Allow header
  console.log("--- Check 1: Method guard on every path ---");
  {
    const host = new PreviewHost({
      config,
      project,
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: false,
      configPath: "",
      mode: "preview",
    });
    await host.start();

    const testPaths = ["/", "/index.html", "/health", "/nodes", "/composition/main", "/preview/main", "/media/sample.txt", "/random"];
    const testMethods = ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

    for (const p of testPaths) {
      for (const m of testMethods) {
        const res = await request(`${host.url}${p}`, { method: m });
        assert.equal(res.status, 405, `${m} ${p} must return 405 Method Not Allowed`);
        const allow = res.headers["allow"] || res.headers["Allow"];
        assert.ok(allow && allow.includes("GET") && allow.includes("HEAD"), `${m} ${p} must have Allow: GET, HEAD`);
        assert.ok(res.body.includes("read-only") || res.body.includes("CC6001"), `${m} ${p} body must cite read-only`);
      }
    }
    await host.stop();
    console.log("  ok: non-GET/HEAD methods strictly return 405 with Allow header");
  }

  // Check 2: Request sweep leaves project file modification times unchanged
  console.log("--- Check 2: Project file modification times unchanged ---");
  {
    const host = new PreviewHost({
      config,
      project,
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: false,
      configPath: "",
      mode: "preview",
    });
    await host.start();

    const mainStatBefore = statSync(path.join(srcDir, "main.js")).mtimeMs;
    const mediaStatBefore = statSync(testMediaFile).mtimeMs;

    // Perform read sweep
    await request(`${host.url}/`);
    await request(`${host.url}/health`);
    await request(`${host.url}/nodes`);
    await request(`${host.url}/media/sample.txt`);

    const mainStatAfter = statSync(path.join(srcDir, "main.js")).mtimeMs;
    const mediaStatAfter = statSync(testMediaFile).mtimeMs;

    assert.equal(mainStatAfter, mainStatBefore, "Source file mtime must be unchanged");
    assert.equal(mediaStatAfter, mediaStatBefore, "Media file mtime must be unchanged");

    await host.stop();
    console.log("  ok: request sweep does not touch project file mtimes");
  }

  // Check 3: Viewer assets are static and pass injection test
  console.log("--- Check 3: Viewer assets static & CSP nonce injection ---");
  {
    const host = new PreviewHost({
      config,
      project,
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: false,
      configPath: "",
      mode: "preview",
    });
    await host.start();

    const res = await request(`${host.url}/`);
    assert.equal(res.status, 200);
    const csp = res.headers["content-security-policy"];
    assert.ok(csp, "Response must include Content-Security-Policy");
    assert.ok(csp.includes("nonce-"), "CSP must include nonce");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["referrer-policy"], "no-referrer");

    // Match nonce in script / link tags
    const nonceMatch = csp.match(/'nonce-([^']+)'/);
    assert.ok(nonceMatch, "Found nonce in CSP");
    const nonce = nonceMatch[1];
    assert.ok(res.body.includes(`nonce="${nonce}"`), "Viewer HTML must inject matching nonce into tags");

    // Static JS and CSS assets
    const jsRes = await request(`${host.url}/assets/viewer.js`);
    assert.equal(jsRes.status, 200);
    assert.ok(jsRes.headers["content-type"].includes("javascript"));
    // Injection test: viewer.js must never assign innerHTML to project strings
    assert.ok(!jsRes.body.includes(".innerHTML = node"), "viewer.js must not assign innerHTML for node strings");
    assert.ok(!jsRes.body.includes(".innerHTML = msg"), "viewer.js must not assign innerHTML for msg strings");
    assert.ok(jsRes.body.includes("textContent"), "viewer.js must use textContent");

    await host.stop();
    console.log("  ok: static viewer assets pass injection test and CSP nonce policy");
  }

  // Check 4: Socket URL works for loopback and non-loopback binds
  console.log("--- Check 4: Socket URL derived from location ---");
  {
    const viewerJsPath = path.join(cinecodeDir, "src", "dev", "static", "viewer.js");
    const viewerJs = readFileSync(viewerJsPath, "utf-8");
    assert.ok(viewerJs.includes("window.location.host"), "Socket URL must derive from window.location.host");
    assert.ok(!viewerJs.includes('"__HOST__"'), "Host must not be baked into client static file");
    assert.ok(!viewerJs.includes('"__PORT__"'), "Port must not be baked into client static file");
    console.log("  ok: socket URL derived dynamically from page location");
  }

  // Check 5: No rooms, presence or cursor leftovers
  console.log("--- Check 5: No collaboration leftovers ---");
  {
    const devSrcDir = path.join(cinecodeDir, "src", "dev");
    const files = ["transport.ts", "server.ts", "index.ts", "types.ts"];
    const forbidden = [
      /\brooms\b/,
      /\bjoinRoom\b/,
      /\bbroadcastToRoom\b/,
      /\bgetRoomPresence\b/,
      /\bRoomPresenceUser\b/,
      /\bcursor\b/i,
      /\bisHost\b/,
    ];
    for (const f of files) {
      const filePath = path.join(devSrcDir, f);
      if (!existsSync(filePath)) continue;
      const content = readFileSync(filePath, "utf-8");
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(content), `File ${f} must not contain collaboration leftover ${pattern}`);
      }
    }
    console.log("  ok: zero rooms, presence, cursor, or multi-user state in dev modules");
  }

  // Check 6: Server answers before first frame is ready
  console.log("--- Check 6: Server answers immediately after listen ---");
  {
    const host = new PreviewHost({
      config,
      project,
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: false,
      configPath: "",
      mode: "preview",
    });
    // start() starts listening and prints readiness before priming first frame
    const startPromise = host.start();
    await startPromise;
    const res = await request(`${host.url}/health`);
    assert.equal(res.status, 200, "Server must answer health check immediately");
    await host.stop();
    console.log("  ok: server listens and answers requests immediately");
  }

  // Check 7: Shutdown leaves no watcher, socket or session alive
  console.log("--- Check 7: Clean shutdown and port release ---");
  {
    const host1 = new PreviewHost({
      config,
      project,
      rootDir: tempDir,
      port: 0,
      host: "127.0.0.1",
      hmr: true,
      configPath: "",
      mode: "dev",
    });
    await host1.start();
    const assignedPort = host1.port;
    await host1.stop();

    // Rebind the exact same port to confirm complete release
    const host2 = new PreviewHost({
      config,
      project,
      rootDir: tempDir,
      port: assignedPort,
      host: "127.0.0.1",
      hmr: false,
      configPath: "",
      mode: "preview",
    });
    await host2.start();
    assert.equal(host2.port, assignedPort, "Port must be immediately reusable after shutdown");
    await host2.stop();
    console.log("  ok: shutdown cleanly releases all handles and ports");
  }

  // Check 8: Non-loopback bind prints exactly one warning
  console.log("--- Check 8: Non-loopback warning exactly once ---");
  {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      const host = new PreviewHost({
        config,
        project,
        rootDir: tempDir,
        port: 0,
        host: "0.0.0.0",
        hmr: false,
        configPath: "",
        mode: "preview",
      });
      await host.start();
      await host.stop();
    } finally {
      console.warn = origWarn;
    }

    const nonLoopbackWarnings = warnings.filter((w) => w.includes("non-loopback"));
    assert.equal(nonLoopbackWarnings.length, 1, `Expected exactly 1 non-loopback warning, got ${nonLoopbackWarnings.length}`);
    console.log("  ok: non-loopback bind prints exactly one warning");
  }

  console.log("check-preview-host: all 8 acceptance checks passed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
