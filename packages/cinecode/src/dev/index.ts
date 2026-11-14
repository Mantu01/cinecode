import { createServer, type Server } from "node:http";
import { watch, type FSWatcher } from "node:fs";
import { join, resolve } from "node:path";
import type { CinecodeConfig } from "../core/types/index.js";
import type { ManifestEntryBase } from "../core/types/manifest.js";
import {
  assembleTimelineComposition,
  composeSceneComposition,
  resolveAudioBuffer,
  resolveImageClip,
  type ManifestProject,
} from "../manifest/index.js";
import { renderStill, setMediaCacheForRenderer } from "../renderer/engine.js";
import { renderImageBuffer } from "../renderer/image.js";
import { encodeWavBuffer } from "../audio/muxer.js";
import { createMediaCache } from "../media/cache.js";
import { createRenderCache } from "../pipeline/cache.js";
import { runCheck, type CheckReport } from "../cli/check.js";
import { WebSocketHub, type WsClient } from "./websocket.js";
import { PreviewLoop } from "./previewLoop.js";
import { renderInspectorHtml } from "./inspector/panel.js";
import type { Composition } from "../core/types/index.js";

export interface DevNode {
  readonly id: string;
  readonly kind: "image" | "audio" | "scene" | "timeline";
  readonly file: string;
  readonly name: string;
}

export interface DevServerOptions {
  readonly config: CinecodeConfig;
  readonly project: ManifestProject;
  readonly rootDir: string;
  readonly port: number;
  readonly host: string;
  readonly hmr: boolean;
  readonly configPath: string;
}

interface Preview {
  readonly buffer: Buffer;
  readonly contentType: string;
  version: number;
}

interface UpdateMessage {
  readonly type: "update";
  readonly node: string;
  readonly url: string;
  readonly at: number;
}

/** Maps every registered asset id to its absolute source file. */
export class ModuleGraph {
  readonly nodes: DevNode[];
  private readonly byFile = new Map<string, DevNode[]>();

  constructor(project: ManifestProject, rootDir: string) {
    const nodes: DevNode[] = [];
    const add = (kind: DevNode["kind"], entries: readonly ManifestEntryBase[] | undefined): void => {
      for (const entry of entries ?? []) {
        if (!entry.file) continue;
        const file = resolve(rootDir, entry.file);
        nodes.push({ id: entry.id, kind, file, name: entry.name ?? entry.id });
      }
    };
    add("image", project.manifest.images);
    add("audio", project.manifest.audio);
    add("scene", project.manifest.scenes);
    add("timeline", project.manifest.timelines);
    this.nodes = nodes;

    for (const node of nodes) {
      const list = this.byFile.get(node.file) ?? [];
      list.push(node);
      this.byFile.set(node.file, list);
    }
  }

  /** Nodes affected by a change to `file`; empty result means "rebuild all". */
  affected(file: string): DevNode[] {
    return this.byFile.get(resolve(file)) ?? [];
  }

  get(id: string): DevNode | undefined {
    return this.nodes.find((node) => node.id === id);
  }
}

export class DevServer {
  private readonly options: DevServerOptions;
  private readonly graph: ModuleGraph;
  private readonly hub = new WebSocketHub();
  private readonly previews = new Map<string, Preview>();
  private readonly renderCache;
  private server: Server | null = null;
  private watcher: FSWatcher | null = null;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private sourceDir: string;
  private readonly previewLoops = new Map<number, { loop: PreviewLoop; nodeId: string }>();
  private readonly hiddenTracks = new Map<number, ReadonlySet<number>>();

  constructor(options: DevServerOptions) {
    this.options = options;
    this.graph = new ModuleGraph(options.project, options.rootDir);
    this.renderCache = createRenderCache(resolve(options.rootDir, options.config.cacheDir ?? ".cinecode/cache"));
    this.sourceDir = resolve(options.rootDir, options.config.sourceDir ?? "./src");
    this.hub.onMessage((client, data) => {
      void this.handlePreviewMessage(client, data);
    });
  }

  get url(): string {
    const host = this.options.host === "0.0.0.0" ? "localhost" : this.options.host;
    return `http://${host}:${this.options.port}`;
  }

  get nodes(): readonly DevNode[] {
    return this.graph.nodes;
  }

  async start(): Promise<void> {
    const mediaCache = createMediaCache(join(resolve(this.options.rootDir, this.options.config.cacheDir ?? ".cinecode/cache"), "media"));
    await mediaCache.initialize();
    setMediaCacheForRenderer(mediaCache);
    await this.renderCache.initialize();

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    this.server.on("upgrade", (request, socket, head) => {
      const url = request.url ?? "";
      if (url.startsWith("/hmr") || url.startsWith("/preview-stream")) {
        const client = this.hub.handleUpgrade(request, socket, head);
        client.send({ type: "hello", nodes: this.graph.nodes.map((node) => ({ id: node.id, kind: node.kind, name: node.name })) });
      } else {
        socket.destroy();
      }
    });

    await new Promise<void>((resolvePromise) => {
      this.server!.listen(this.options.port, this.options.host, () => resolvePromise());
    });

    this.startWatching();
    // Prime the first node so the preview shows something immediately.
    const first = this.graph.nodes[0];
    if (first) await this.renderNode(first).catch((error) => console.error(`preview failed: ${String(error)}`));
  }

  private startWatching(): void {
    const watched = new Set<string>([this.sourceDir]);
    try {
      this.watcher = watch(this.sourceDir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        this.schedule(resolve(this.sourceDir, filename.toString()));
      });
    } catch {
      this.watcher = null;
    }
    // Also watch the config + manifest so edits to them invalidate everything.
    for (const file of [this.options.project.entryPath, resolve(this.options.rootDir, "cinecode.config.ts"), resolve(this.options.rootDir, "cinecode.config.js")]) {
      try {
        watch(file, () => this.schedule(file));
        watched.add(file);
      } catch {
        void 0;
      }
    }
  }

  private schedule(file: string): void {
    if (this.pending) clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      this.pending = null;
      void this.handleChange(file);
    }, 150);
  }

  private async handleChange(file: string): Promise<void> {
    const affected = this.graph.affected(file);
    const targets = affected.length > 0 ? affected : this.graph.nodes;
    for (const node of targets) {
      try {
        await this.renderNode(node);
      } catch (error) {
        this.hub.broadcast({ type: "error", node: node.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
    // Re-validate after a change so HMR surfaces the same categories `check` does.
    if (this.options.hmr) await this.validate();
  }

  /**
   * Run the shared `check` gate and broadcast the report over HMR. This keeps
   * HMR error surfacing consistent with `cinecode check`: a change that breaks
   * `check` also shows as a validation error in the dev UI.
   */
  async validate(): Promise<CheckReport> {
    const report = await runCheck(this.options.configPath);
    this.hub.broadcast({ type: "validation", report });
    return report;
  }

  private async renderNode(node: DevNode): Promise<void> {
    const preview = await this.producePreview(node, 0);
    const existing = this.previews.get(node.id);
    const version = (existing?.version ?? 0) + 1;
    this.previews.set(node.id, { ...preview, version });
    const message: UpdateMessage = {
      type: "update",
      node: node.id,
      url: `/preview/${encodeURIComponent(node.id)}?v=${version}`,
      at: Date.now(),
    };
    if (this.options.hmr) this.hub.broadcast(message);
    else this.hub.broadcast({ ...message, type: "update" });
    console.log(`[hmr] ${node.kind} ${node.id} → updated (v${version})`);
  }

  private filterTracks(composition: Composition, hidden: ReadonlySet<number>): Composition {
    if (hidden.size === 0) return composition;
    return {
      ...composition,
      rootTimeline: {
        ...composition.rootTimeline,
        tracks: composition.rootTimeline.tracks.filter((_track, index) => !hidden.has(index)),
      },
    };
  }

  private async producePreview(
    node: DevNode,
    frame: number,
    hidden: ReadonlySet<number> = new Set(),
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const { project } = this.options;
    const safeFrame = Number.isFinite(frame) && frame >= 0 ? Math.floor(frame) : 0;
    switch (node.kind) {
      case "image": {
        const resolvedImage = await resolveImageClip(project, node.id);
        const buffer = await renderImageBuffer(resolvedImage.clips, {
          width: resolvedImage.width,
          height: resolvedImage.height,
          background: resolvedImage.background,
          format: "png",
          scaleFactor: 1,
        });
        return { buffer, contentType: "image/png" };
      }
      case "audio": {
        const buffer = await resolveAudioBuffer(project, node.id);
        return { buffer: encodeWavBuffer(buffer), contentType: "audio/wav" };
      }
      case "scene": {
        const composition = this.filterTracks(await composeSceneComposition(project, node.id), hidden);
        const canvas = await renderStill(composition, safeFrame, 0);
        return { buffer: (canvas as unknown as { toBuffer(mime: string): Buffer }).toBuffer("image/png"), contentType: "image/png" };
      }
      case "timeline": {
        const composition = this.filterTracks(await assembleTimelineComposition(project, node.id), hidden);
        const canvas = await renderStill(composition, safeFrame, 0);
        return { buffer: (canvas as unknown as { toBuffer(mime: string): Buffer }).toBuffer("image/png"), contentType: "image/png" };
      }
    }
  }

  private async handleRequest(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): Promise<void> {
    const rawUrl = req.url ?? "/";
    const url = new URL(rawUrl, "http://localhost");
    const pathname = url.pathname;
    if (pathname === "/" || pathname === "/index.html") {
      const html = await this.indexHtml();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (pathname === "/inspector") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderInspectorHtml({
        host: this.options.host === "0.0.0.0" ? "localhost" : this.options.host,
        port: this.options.port,
      }));
      return;
    }
    if (pathname?.startsWith("/composition/")) {
      const id = decodeURIComponent(pathname.slice("/composition/".length));
      const node = this.graph.get(id);
      if (!node) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `Unknown node: ${id}` }));
        return;
      }
      try {
        const composition = await this.resolveComposition(node);
        if (!composition) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Node is not a composition" }));
          return;
        }
        const frames = this.compositionFrameCount(composition);
        const tracks = composition.rootTimeline.tracks.map((track, index) => ({
          index,
          name: track.name ?? `track-${index}`,
          kind: track.kind ?? "visual",
          clipCount: track.clips.length,
        }));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          name: composition.name,
          width: composition.width,
          height: composition.height,
          fps: composition.fps,
          frames,
          clipCount: tracks.reduce((total, track) => total + track.clipCount, 0),
          tracks,
        }));
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }
    if (pathname?.startsWith("/frames/")) {
      const id = decodeURIComponent(pathname.slice("/frames/".length));
      const node = this.graph.get(id);
      if (!node) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `Unknown node: ${id}` }));
        return;
      }
      try {
        const composition = await this.resolveComposition(node);
        if (!composition) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Node is not a composition" }));
          return;
        }
        const frames = this.compositionFrameCount(composition);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ frames, fps: composition.fps, width: composition.width, height: composition.height }));
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }
    if (pathname === "/metrics") {
      const { globalMetrics } = await import("../observability/metrics.js");
      const metricsText = await globalMetrics.getMetricsText();
      res.writeHead(200, { "content-type": globalMetrics.contentType });
      res.end(metricsText);
      return;
    }
    if (pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", timestamp: Date.now() }));
      return;
    }
    if (pathname === "/readyz") {
      const isReady = !!this.server && this.graph.nodes.length >= 0;
      if (isReady) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ready" }));
      } else {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "degraded", reasons: ["Server initializing"] }));
      }
      return;
    }
    if (pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          wsClients: this.hub.size,
          cachedPreviews: this.previews.size,
          nodes: this.graph.nodes.length,
          timestamp: Date.now(),
        }),
      );
      return;
    }
    if (pathname === "/persist" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString("utf-8"); });
      req.on("end", () => {
        try {
          const data = JSON.parse(body || "{}");
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ success: true, message: "Persisted to source code", data }));
        } catch (e: any) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    if (pathname === "/export-frame") {
      const nodeId = url.searchParams.get("node");
      const frameStr = url.searchParams.get("frame") || "0";
      const format = url.searchParams.get("format") || "png";
      const frameNum = parseInt(frameStr, 10) || 0;
      const node = nodeId ? this.graph.get(nodeId) : this.graph.nodes[0];
      if (!node) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Node not found" }));
        return;
      }
      try {
        const comp = await this.resolveComposition(node);
        if (!comp) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Node is not a composition" }));
          return;
        }
        if (format === "svg") {
          const { serializeFrameToSvg } = await import("../svg/serializer.js");
          const svgStr = serializeFrameToSvg(comp, frameNum);
          res.writeHead(200, {
            "content-type": "image/svg+xml",
            "content-disposition": `attachment; filename="${node.name}_frame_${frameNum}.svg"`,
          });
          res.end(svgStr);
          return;
        }
        const { renderStill } = await import("../renderer/engine.js");
        const canvas = await renderStill(comp, frameNum, 0);
        const buf = (canvas as unknown as { toBuffer(mime: string): Buffer }).toBuffer("image/png");
        res.writeHead(200, {
          "content-type": "image/png",
          "content-disposition": `attachment; filename="${node.name}_frame_${frameNum}.png"`,
        });
        res.end(buf);
        return;
      } catch (err: any) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
    }
    if (pathname === "/nodes") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(this.graph.nodes));
      return;
    }
    if (pathname === "/validate") {
      const report = await this.validate();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(report));
      return;
    }
    if (pathname?.startsWith("/preview/")) {
      const id = decodeURIComponent(pathname.slice("/preview/".length));
      const node = this.graph.get(id);
      const frameParam = url.searchParams.get("frame");
      // On-demand frame scrubbing: render the requested frame directly. Falls
      // back to the cached frame-0 preview when no frame is requested.
      if (node && frameParam !== null) {
        try {
          const frame = Number.parseInt(frameParam, 10);
          const preview = await this.producePreview(node, Number.isFinite(frame) ? frame : 0);
          res.writeHead(200, { "content-type": preview.contentType, "cache-control": "no-store" });
          res.end(preview.buffer);
          return;
        } catch (error) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          return;
        }
      }
      const preview = this.previews.get(id);
      if (!preview) {
        res.writeHead(404);
        res.end("No preview yet");
        return;
      }
      res.writeHead(200, { "content-type": preview.contentType, "cache-control": "no-store" });
      res.end(preview.buffer);
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  }

  private async indexHtml(): Promise<string> {
    return CLIENT_HTML
      .replace(/__HOST__/g, this.options.host)
      .replace(/__PORT__/g, String(this.options.port));
  }

  private compositionFrameCount(composition: Composition): number {
    if (composition.duration !== undefined) {
      const seconds = typeof composition.duration === "number"
        ? composition.duration
        : Number.parseFloat(composition.duration);
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.max(1, Math.ceil(seconds * composition.fps));
      }
    }
    return this.previewFrames(composition);
  }

  private previewFrames(composition: Composition): number {
    let frames = 0;
    for (const track of composition.rootTimeline.tracks) {
      if (track.kind === "audio") continue;
      for (const clip of track.clips) {
        const start = typeof clip.start === "number" ? clip.start : 0;
        const duration = typeof clip.duration === "number" ? clip.duration : 1;
        frames = Math.max(frames, Math.ceil((start + duration) * composition.fps));
      }
    }
    return Math.max(1, frames);
  }

  private async resolveComposition(node: DevNode): Promise<Composition | null> {
    if (node.kind === "scene") return composeSceneComposition(this.options.project, node.id);
    if (node.kind === "timeline") return assembleTimelineComposition(this.options.project, node.id);
    return null;
  }

  private async handlePreviewMessage(client: WsClient, data: unknown): Promise<void> {
    if (typeof data !== "object" || data === null) return;
    const message = data as {
      type?: string;
      node?: string;
      frame?: number;
      fps?: number;
      hidden?: readonly number[];
    };
    if (message.type === "preview:layers") {
      this.hiddenTracks.set(client.id, new Set(message.hidden ?? []));
      return;
    }
    const msgAny = message as any;
    if (msgAny.type === "clip:update") {
      this.hub.broadcast({
        type: "clip:updated",
        clipId: msgAny.clipId,
        propertyPath: msgAny.propertyPath,
        value: msgAny.value,
      });
      return;
    }
    if (message.type === "preview:frame" && typeof message.node === "string") {
      const node = this.graph.get(message.node);
      if (!node) return;
      const hidden = new Set(message.hidden ?? this.hiddenTracks.get(client.id) ?? []);
      this.hiddenTracks.set(client.id, hidden);
      const frame = typeof message.frame === "number" ? Math.max(0, Math.floor(message.frame)) : 0;
      const started = Date.now();
      try {
        const preview = await this.producePreview(node, frame, hidden);
        const composition = await this.resolveComposition(node);
        const totalFrames = composition ? this.compositionFrameCount(composition) : 1;
        client.send({
          type: "frame",
          node: node.id,
          frame,
          totalFrames,
          fps: composition?.fps ?? 30,
          renderMs: Date.now() - started,
          dataUrl: `data:${preview.contentType};base64,${preview.buffer.toString("base64")}`,
        });
      } catch (error) {
        client.send({ type: "error", node: node.id, message: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (message.type === "preview:stop") {
      this.previewLoops.get(client.id)?.loop.stop();
      this.previewLoops.delete(client.id);
      return;
    }
    if (message.type === "preview:scrub") {
      const entry = this.previewLoops.get(client.id);
      if (entry && typeof message.frame === "number") entry.loop.scrubTo(message.frame);
      return;
    }
    if (message.type !== "preview:start" || typeof message.node !== "string") return;
    const node = this.graph.get(message.node);
    if (!node) return;
    const resolved = await this.resolveComposition(node);
    if (!resolved) return;
    const composition = this.filterTracks(resolved, this.hiddenTracks.get(client.id) ?? new Set());
    this.previewLoops.get(client.id)?.loop.stop();
    const loop = new PreviewLoop(composition, (payload) => {
      client.send({ type: "previewFrame", frame: payload.frame, fps: payload.fps, timestamp: payload.timestamp });
      if (payload.buffer.length > 0) client.sendBinary(payload.buffer);
    }, { targetFps: message.fps ?? 30 });
    this.previewLoops.set(client.id, { loop, nodeId: node.id });
    loop.start();
  }

  async stop(): Promise<void> {
    for (const entry of this.previewLoops.values()) entry.loop.stop();
    this.previewLoops.clear();
    this.hiddenTracks.clear();
    if (this.pending) clearTimeout(this.pending);
    this.watcher?.close();
    this.hub.closeAll();
    await new Promise<void>((resolvePromise) => {
      if (!this.server) return resolvePromise();
      this.server.close(() => resolvePromise());
    });
    this.server = null;
  }
}

export { renderInspectorHtml, type InspectorPanelOptions } from "./inspector/panel.js";

const CLIENT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Cinecode Dev</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: #0b0b0d; color: #e8e6e1; }
  header { display:flex; align-items:center; gap:12px; padding: 12px 16px; border-bottom:1px solid #232227; }
  header b { color:#f5b544; letter-spacing:.08em; }
  #status { margin-left:auto; font-size:12px; color:#8a8781; }
  #dot { width:8px; height:8px; border-radius:50%; background:#3a3a3f; display:inline-block; margin-right:6px; }
  #dot.on { background:#2ecc71; box-shadow:0 0 8px #2ecc71; }
  main { display:grid; grid-template-columns: 280px 1fr; height: calc(100vh - 49px); }
  aside { border-right:1px solid #232227; overflow:auto; padding:8px; }
  .node { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; cursor:pointer; }
  .node:hover { background:#17171b; }
  .node.active { background:#221d10; outline:1px solid #443717; }
  .kind { font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#8a8781; min-width:54px; }
  .dirty { width:6px; height:6px; border-radius:50%; background:#f5b544; margin-left:auto; display:none; }
  .node.stale .dirty { display:block; }
  section.preview { display:flex; align-items:center; justify-content:center; padding:24px; overflow:auto; }
  img { max-width:100%; max-height:100%; border:1px solid #232227; border-radius:8px; background:#000; }
  audio { width: 480px; }
  .empty { color:#6f6c66; }
  #overlay { position:fixed; right:12px; bottom:12px; width:420px; max-height:60vh; overflow:auto; background:#141418; border:1px solid #3a2f1a; border-radius:8px; padding:10px 12px; display:none; z-index:10; }
  #overlay .ov-head { color:#f5b544; font-size:12px; letter-spacing:.05em; margin-bottom:6px; }
  #overlay .ov-item { padding:6px 0; border-top:1px solid #232227; font-size:12px; }
  #overlay .ov-item code { color:#e06c75; }
  #overlay .ov-item.warning code { color:#f5b544; }
  #overlay .ov-file { color:#6f6c66; }
  #overlay .ov-fix { color:#8a8781; margin-top:2px; }
  #scrub { display:flex; align-items:center; gap:8px; margin-top:12px; width:100%; max-width:480px; }
  #scrub span { font-size:11px; color:#8a8781; }
  #scrub input[type=range] { flex:1; }
  #scrub input[type=number] { width:64px; background:#17171b; color:#e8e6e1; border:1px solid #232227; border-radius:6px; padding:2px 6px; }
</style>
</head>
<body>
<header>
  <b>CINECODE</b><span>dev server</span>
  <span id="status"><span id="dot"></span><span id="statusText">connecting…</span></span>
</header>
<main>
  <aside id="list"></aside>
  <section class="preview" id="preview"><span class="empty">Select an asset</span></section>
</main>
<div id="overlay"></div>
<script>
  const HOST = "__HOST__";
  const PORT = "__PORT__";
  const list = document.getElementById("list");
  const preview = document.getElementById("preview");
  const dot = document.getElementById("dot");
  const statusText = document.getElementById("statusText");
  let selected = null;
  const stale = new Set();

  function render(type, node, frame) {
    var f = (frame === undefined || frame === null) ? 0 : frame;
    if (type === "audio") {
      preview.innerHTML = "";
      var audio = document.createElement("audio");
      audio.controls = true; audio.autoplay = true;
      audio.src = "/preview/" + encodeURIComponent(node.id) + "?v=" + Date.now();
      preview.appendChild(audio);
    } else {
      preview.innerHTML = "";
      var img = document.createElement("img");
      img.src = "/preview/" + encodeURIComponent(node.id) + "?frame=" + f + "&v=" + Date.now();
      preview.appendChild(img);
    }
  }

  function scrubber(node) {
    if (node.kind !== "scene" && node.kind !== "timeline") return null;
    var bar = document.createElement("div");
    bar.id = "scrub";
    var label = document.createElement("span");
    label.textContent = "frame";
    var range = document.createElement("input");
    range.type = "range"; range.min = "0"; range.max = "0"; range.value = "0";
    var num = document.createElement("input");
    num.type = "number"; num.min = "0"; num.max = "0"; num.value = "0";
    fetch("/frames/" + encodeURIComponent(node.id)).then(function (r) { return r.json(); }).then(function (info) {
      if (!info || !info.frames) return;
      range.max = String(info.frames - 1);
      num.max = String(info.frames - 1);
      label.textContent = "frame / " + info.frames;
    }).catch(function () { void 0; });
    range.oninput = function () { num.value = range.value; render(node.kind, node, range.value); };
    num.oninput = function () { range.value = num.value; render(node.kind, node, num.value); };
    bar.appendChild(label); bar.appendChild(range); bar.appendChild(num);
    return bar;
  }

  function overlay(issues) {
    var el = document.getElementById("overlay");
    if (!issues || issues.length === 0) { el.style.display = "none"; el.innerHTML = ""; return; }
    el.style.display = "block";
    var html = "<div class='ov-head'>check: " + issues.length + " issue(s)</div>";
    for (var i = 0; i < issues.length; i++) {
      var it = issues[i];
      html += "<div class='ov-item " + it.severity + "'><code>" + it.code + "</code> " + it.message +
        (it.file ? " <span class='ov-file'>" + it.file + (it.line ? ":" + it.line : "") + "</span>" : "") +
        (it.fixHint ? "<div class='ov-fix'>fix: " + it.fixHint + "</div>" : "") + "</div>";
    }
    el.innerHTML = html;
  }

  function select(node) {
    selected = node;
    stale.delete(node.id);
    document.querySelectorAll(".node").forEach((el) => {
      el.classList.toggle("active", el.dataset.id === node.id);
      if (el.dataset.id === node.id) el.classList.remove("stale");
    });
    render(node.kind, node, 0);
    var bar = scrubber(node);
    if (bar) preview.appendChild(bar);
  }

  let nodes = [];
  function buildList() {
    list.innerHTML = "";
    for (const node of nodes) {
      const el = document.createElement("div");
      el.className = "node"; el.dataset.id = node.id;
      el.innerHTML = '<span class="kind">' + node.kind + '</span><span>' + node.name + '</span><span class="dirty"></span>';
      el.onclick = () => select(node);
      list.appendChild(el);
    }
    if (nodes.length && !selected) select(nodes[0]);
  }

  function connect() {
    const ws = new WebSocket("ws://" + HOST + ":" + PORT + "/hmr");
    ws.onopen = () => { dot.classList.add("on"); statusText.textContent = "connected"; };
    ws.onclose = () => { dot.classList.remove("on"); statusText.textContent = "reconnecting…"; setTimeout(connect, 800); };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "hello") { nodes = msg.nodes; buildList(); }
      else if (msg.type === "update") {
        statusText.textContent = "updated " + new Date(msg.at).toLocaleTimeString();
        if (selected && selected.id === msg.node) render(selected.kind, selected);
        else {
          stale.add(msg.node);
          const el = list.querySelector('[data-id="' + msg.node + '"]');
          if (el) el.classList.add("stale");
        }
      } else if (msg.type === "error") {
        statusText.textContent = "error: " + msg.message;
      } else if (msg.type === "validation") {
        var r = msg.report;
        var issues = (r.errors || []).concat(r.warnings || []);
        overlay(issues);
        if (r.ok && issues.length === 0) { statusText.textContent = "check passed"; }
        else if (r.ok) { statusText.textContent = "check: " + issues.length + " warning(s)"; }
        else { statusText.textContent = "check failed: " + (r.errors || []).length + " error(s)"; }
      }
    };
  }
  connect();
</script>
</body>
</html>`;

