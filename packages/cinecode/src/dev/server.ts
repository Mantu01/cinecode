import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import type { Composition } from "../core/types/index.js";
import { compositionTotalFrames } from "../core/time/index.js";
import {
  assembleTimelineComposition,
  composeSceneComposition,
  loadManifestProject,
  resolveAudioBuffer,
  resolveImageClip,
  type ManifestProject,
} from "../manifest/index.js";
import { setMediaCacheForRenderer } from "../renderer/engine.js";
import { renderImageBuffer } from "../renderer/image.js";
import { encodeWavBuffer } from "../audio/muxer.js";
import { createMediaCache } from "../media/cache.js";
import { createRenderCache } from "../pipeline/cache.js";
import { runCheck, type CheckReport } from "../cli/check.js";
import { createProjectResolver } from "../cli/project-resolver.js";
import { createError, ErrorCode } from "../errors/index.js";
import { ModuleGraph } from "./module-graph.js";
import { WebSocketHub, type WsClient } from "./transport.js";
import { ProjectWatcher } from "./watcher.js";
import { getViewerDocument, getViewerAsset } from "./viewer-assets.js";
import type { DevNode, DevServerOptions, PreviewFrame } from "./types.js";
import {
  PreviewEngine,
  type PreviewCameraState,
  type PreviewRenderResult,
} from "../renderer/preview-engine.js";
import { clampResolutionScale, type ResolutionScale } from "../renderer/scale.js";
import {
  encodeFrameBinary,
  FRAME_FORMAT_PNG,
  PROTOCOL_VERSION,
  type ServerStatusMessage,
} from "./protocol.js";

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".json": "application/json",
};

interface ClientSession {
  readonly client: WsClient;
  selectedNodeId: string;
  isRendering: boolean;
  pendingSeek: { frame: number; scale?: number } | null;
  camera?: PreviewCameraState;
  playing: boolean;
  playTimer: ReturnType<typeof setInterval> | null;
  currentFrame: number;
}

// Unified host for dev and preview with incremental updates and memory bounds
export class PreviewHost {
  private readonly options: DevServerOptions;
  graph: ModuleGraph;
  readonly hub = new WebSocketHub();
  readonly previews = new Map<string, PreviewFrame>();
  readonly previewLru = new Map<string, PreviewFrame>();
  private readonly hiddenTracks = new Map<number, ReadonlySet<number>>();
  readonly sessions = new Map<number, ClientSession>();
  private readonly validationCache = new Map<string, CheckReport>();
  private readonly registeredFontMtimes = new Map<string, number>();
  private server: Server | null = null;
  private watcher: ProjectWatcher | null = null;
  private actualPort = 0;
  private nonLoopbackWarned = false;
  private scale: ResolutionScale = 0.5;
  private projectSnapshot: ManifestProject;

  constructor(options: DevServerOptions) {
    this.options = options;
    this.projectSnapshot = options.project;
    this.graph = new ModuleGraph(options.project, options.rootDir);
    this.actualPort = options.port;
    this.hub.onMessage((client, data) => {
      void this.handleWsMessage(client, data);
    });
  }

  get url(): string {
    const host = this.options.host === "0.0.0.0" ? "127.0.0.1" : this.options.host;
    return `http://${host}:${this.actualPort}`;
  }

  get port(): number {
    return this.actualPort;
  }

  get nodes(): readonly DevNode[] {
    return this.graph.nodes;
  }

  get currentScale(): ResolutionScale {
    return this.scale;
  }

  setScale(scale: number): void {
    this.scale = clampResolutionScale(scale);
  }

  async start(): Promise<void> {
    const isDev = (this.options.mode ?? "dev") === "dev";

    // Non-loopback warning exactly once
    if (!isLoopback(this.options.host) && !this.nonLoopbackWarned) {
      this.nonLoopbackWarned = true;
      console.warn(`[CC1012] Warning: Binding to non-loopback host '${this.options.host}'. Server is exposed to the local network.`);
    }

    // Initialize media and render caches
    const cacheDir = resolve(this.options.rootDir, this.options.config.cacheDir ?? ".cinecode/cache");
    const mediaCache = createMediaCache(join(cacheDir, "media"));
    await mediaCache.initialize();
    setMediaCacheForRenderer(mediaCache);
    const renderCache = createRenderCache(cacheDir);
    await renderCache.initialize();

    // Create HTTP server
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    // WebSocket upgrade handler
    this.server.on("upgrade", (request, socket, head) => {
      const url = request.url ?? "";
      if (url.startsWith("/ws") || url.startsWith("/hmr") || url.startsWith("/preview-stream")) {
        const client = this.hub.handleUpgrade(request, socket, head);
        const session: ClientSession = {
          client,
          selectedNodeId: this.graph.nodes[0]?.id ?? "",
          isRendering: false,
          pendingSeek: null,
          playing: false,
          playTimer: null,
          currentFrame: 0,
        };
        this.sessions.set(client.id, session);

        client.send({
          type: "welcome",
          version: PROTOCOL_VERSION,
          nodes: this.graph.nodes.map((n) => ({ id: n.id, kind: n.kind, name: n.name })),
          error: this.options.initialError,
        });

        // Initial status
        client.send(this.getStatus(session));
      } else {
        socket.destroy();
      }
    });

    // Port retry policy: try up to 10 consecutive ports
    const basePort = this.options.port;
    const triedPorts: number[] = [];
    let bound = false;

    for (let offset = 0; offset < 10; offset++) {
      const portToTry = basePort + offset;
      triedPorts.push(portToTry);
      try {
        await new Promise<void>((resolveListen, rejectListen) => {
          const onListen = (): void => {
            this.server?.off("error", onError);
            resolveListen();
          };
          const onError = (err: unknown): void => {
            this.server?.off("listening", onListen);
            rejectListen(err);
          };
          this.server!.once("listening", onListen);
          this.server!.once("error", onError);
          this.server!.listen(portToTry, this.options.host);
        });
        const addr = this.server?.address();
        this.actualPort = addr && typeof addr === "object" ? addr.port : portToTry;
        bound = true;
        break;
      } catch (err: unknown) {
        if (err && (err as { code?: string }).code === "EADDRINUSE") {
          continue;
        }
        throw err;
      }
    }

    if (!bound) {
      throw createError(
        ErrorCode.CC7004,
        { reason: `Could not bind server: ports ${triedPorts.join(", ")} are in use` },
        { fixHint: "Specify an available port using --port <number>." },
      );
    }

    // Print readiness before first frame
    const modeName = this.options.mode ?? "dev";
    console.log(`Cinecode ${modeName} server running at ${this.url}`);
    console.log(`Host: ${this.options.host}, Port: ${this.actualPort}, Targets: ${this.graph.nodes.length}`);

    // Dev mode watchers
    if (isDev && this.options.hmr) {
      this.watcher = new ProjectWatcher({
        rootDir: this.options.rootDir,
        sourceDir: this.options.config.sourceDir ?? "./src",
        mediaDir: this.options.config.mediaDir ?? "./media",
        entryPath: this.options.project.entryPath,
        configPath: this.options.configPath,
        additionalFiles: this.graph.allTrackedFiles(),
        onChange: (files) => void this.handleChange(files),
      });
      this.watcher.start();
    }

    // Push first frame asynchronously
    void this.primeFirstFrame();
  }

  private async primeFirstFrame(): Promise<void> {
    const first = this.graph.nodes[0];
    if (first) {
      await this.producePreview(first, 0).catch((error) => {
        process.stderr.write(`preview prime notice: ${String(error)}\n`);
      });
    }
  }

  async handleChange(files: readonly string[]): Promise<void> {
    const isConfigChange = files.some((f) => basename(f).includes("cinecode.config."));
    const mediaRoot = resolve(this.options.rootDir, this.options.config.mediaDir ?? "./media");
    const mediaFiles = files.filter((f) => resolve(f).startsWith(mediaRoot));

    // 1. Config change: re-resolve whole project snapshot once and notify clients
    if (isConfigChange) {
      try {
        this.projectSnapshot = await loadManifestProject(this.options.config, this.options.rootDir);
        this.graph = new ModuleGraph(this.projectSnapshot, this.options.rootDir);
        this.hub.broadcast({
          type: "welcome",
          version: PROTOCOL_VERSION,
          nodes: this.graph.nodes.map((n) => ({ id: n.id, kind: n.kind, name: n.name })),
        });
      } catch (err) {
        this.hub.broadcast({
          type: "error",
          version: PROTOCOL_VERSION,
          code: "CC1001",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      await this.validate();
      return;
    }

    // 2. Media change: invalidate only frames that use this media
    if (mediaFiles.length > 0) {
      for (const mediaFile of mediaFiles) {
        try {
          const stat = statSync(mediaFile);
          const identity = `${mediaFile}:${stat.mtimeMs}:${stat.size}`;
          void identity;

          // Find nodes referencing this media file
          const affectedNodeIds = new Set(this.graph.nodesUsingMedia(mediaFile));
          const mediaBase = basename(mediaFile);
          for (const node of this.graph.nodes) {
            try {
              if (existsSync(node.file)) {
                const content = readFileSync(node.file, "utf-8");
                if (content.includes(mediaBase)) affectedNodeIds.add(node.id);
              }
            } catch {
              // Note: ignore error reading candidate node file
            }
          }

          // Delete cache entries for affected nodes only
          for (const key of [...this.previewLru.keys()]) {
            for (const nid of affectedNodeIds) {
              if (key.startsWith(`${nid}:`)) this.previewLru.delete(key);
            }
          }

          // Re-render only if previewed node was affected
          for (const session of this.sessions.values()) {
            if (affectedNodeIds.has(session.selectedNodeId)) {
              void this.renderFrameForSession(session, session.currentFrame);
            }
          }
        } catch {
          // Note: File may have been deleted
        }
      }
      await this.validate();
      return;
    }

    // 3. Source changes: transitive dependency resolution
    const affectedNodes = new Set<DevNode>();
    for (const file of files) {
      for (const node of this.graph.affected(file)) {
        affectedNodes.add(node);
      }
    }

    // Run incremental validation
    const report = await this.validate();

    // If source file does not affect the previewed node, send validation only (no re-render!)
    for (const session of this.sessions.values()) {
      const isPreviewedAffected = [...affectedNodes].some((n) => n.id === session.selectedNodeId);
      if (isPreviewedAffected) {
        // Invalidate preview cache for affected node
        for (const key of [...this.previewLru.keys()]) {
          if (key.startsWith(`${session.selectedNodeId}:`)) this.previewLru.delete(key);
        }
        void this.renderFrameForSession(session, session.currentFrame);
      }
    }

    // Broadcast versioned update notice
    for (const node of affectedNodes) {
      const existing = this.previews.get(node.id);
      const version = (existing?.version ?? 0) + 1;
      this.previews.set(node.id, { buffer: Buffer.alloc(0), contentType: "image/png", version });
      this.hub.broadcast({
        type: "update",
        node: node.id,
        url: `/preview/${encodeURIComponent(node.id)}?v=${version}`,
        at: Date.now(),
      });
    }

    void report;
  }

  async validate(): Promise<CheckReport> {
    let report: CheckReport;
    try {
      const resolver = createProjectResolver({
        root: this.options.rootDir,
        config: this.options.configPath,
        fresh: true,
      });
      report = await runCheck(await resolver.resolve());
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string; location?: { file?: string }; fixHint?: string } | null;
      report = {
        ok: false,
        errors: [
          {
            code: e?.code ?? "CC1009",
            message: e?.message ?? String(err),
            file: e?.location?.file ?? this.options.project.entryPath,
            fixHint: e?.fixHint,
            severity: "error",
            category: "config",
          },
        ],
        warnings: [],
        notes: [],
        categories: {
          config: { errors: 1, warnings: 0 },
          authoring: { errors: 0, warnings: 0 },
          media: { errors: 0, warnings: 0 },
          fonts: { errors: 0, warnings: 0 },
          determinism: { errors: 0, warnings: 0 },
        },
      };
    }

    // Cap validation cache to 32 entries
    if (this.validationCache.size >= 32) {
      const oldest = this.validationCache.keys().next().value;
      if (oldest) this.validationCache.delete(oldest);
    }
    this.validationCache.set(Date.now().toString(), report);

    this.hub.broadcast({ type: "validation", version: PROTOCOL_VERSION, report });
    return report;
  }

  private getStatus(session?: ClientSession): ServerStatusMessage {
    return {
      type: "status",
      version: PROTOCOL_VERSION,
      ready: session ? !session.isRendering : true,
      cachedFrames: this.previewLru.size,
      scale: this.scale,
      reducedEffects: true,
    };
  }

  // Pure request dispatcher for testing and server loop
  async dispatchRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await this.handleRequest(req, res);
  }

  async dispatchWsMessage(client: WsClient, data: unknown): Promise<void> {
    await this.handleWsMessage(client, data);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Instruction 3: Method guard FIRST on every request
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, {
        "Allow": "GET, HEAD",
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify({
        code: "CC6001",
        error: "Preview server is read-only. Only GET and HEAD methods are allowed.",
      }));
      return;
    }

    const rawUrl = req.url ?? "/";
    const url = new URL(rawUrl, "http://localhost");
    const pathname = url.pathname;

    // Security headers on all read responses
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");

    // Head request: respond with headers only
    const sendPayload = (status: number, headers: Record<string, string>, body?: Buffer | string): void => {
      res.writeHead(status, headers);
      if (method === "HEAD") {
        res.end();
      } else {
        res.end(body);
      }
    };

    // Reject persist/mutation endpoints with 405 Method Not Allowed
    if (pathname === "/persist" || pathname.startsWith("/persist/")) {
      sendPayload(405, {
        "Allow": "GET, HEAD",
        "Content-Type": "application/json; charset=utf-8",
      }, JSON.stringify({
        code: "CC6001",
        error: "Preview server is read-only. Persistence operations are forbidden.",
      }));
      return;
    }

    // Route: Viewer document
    if (pathname === "/" || pathname === "/index.html") {
      const doc = getViewerDocument();
      sendPayload(200, doc.headers, doc.html);
      return;
    }

    // Route: Viewer static assets
    if (pathname.startsWith("/assets/")) {
      const filename = pathname.slice("/assets/".length);
      const asset = getViewerAsset(filename);
      if (!asset) {
        sendPayload(404, { "Content-Type": "application/json" }, JSON.stringify({ error: "Asset not found" }));
        return;
      }
      sendPayload(200, { "Content-Type": asset.contentType, "Cache-Control": "no-cache" }, asset.content);
      return;
    }

    // Route: Health check
    if (pathname === "/health" || pathname === "/api/health") {
      const payload = JSON.stringify({
        status: "ok",
        readOnly: true,
        mode: this.options.mode ?? "preview",
        targets: this.graph.nodes.length,
        scale: this.scale,
        uptime: Math.floor(process.uptime()),
      });
      sendPayload(200, { "Content-Type": "application/json" }, payload);
      return;
    }

    // Route: Nodes list
    if (pathname === "/nodes" || pathname === "/api/project") {
      sendPayload(200, { "Content-Type": "application/json" }, JSON.stringify(this.graph.nodes));
      return;
    }

    // Route: Composition summary
    if (pathname.startsWith("/composition/")) {
      const id = decodeURIComponent(pathname.slice("/composition/".length));
      const node = this.graph.get(id);
      if (!node) {
        sendPayload(404, { "Content-Type": "application/json" }, JSON.stringify({ error: `Unknown node: ${id}` }));
        return;
      }
      try {
        const composition = await this.resolveComposition(node);
        if (!composition) {
          sendPayload(400, { "Content-Type": "application/json" }, JSON.stringify({ error: "Node is not a composition" }));
          return;
        }
        const frames = Math.max(1, compositionTotalFrames(composition));
        const tracks = composition.rootTimeline.tracks.map((track, index) => ({
          index,
          name: track.name ?? `track-${index}`,
          kind: track.kind ?? "visual",
          clipCount: track.clips.length,
        }));
        sendPayload(200, { "Content-Type": "application/json" }, JSON.stringify({
          name: composition.name,
          width: composition.width,
          height: composition.height,
          fps: composition.fps,
          frames,
          scale: this.scale,
          clipCount: tracks.reduce((total, track) => total + track.clipCount, 0),
          tracks,
        }));
      } catch (error) {
        sendPayload(500, { "Content-Type": "application/json" }, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    // Route: Frame count
    if (pathname.startsWith("/frames/")) {
      const id = decodeURIComponent(pathname.slice("/frames/".length));
      const node = this.graph.get(id);
      if (!node) {
        sendPayload(404, { "Content-Type": "application/json" }, JSON.stringify({ error: `Unknown node: ${id}` }));
        return;
      }
      try {
        const composition = await this.resolveComposition(node);
        if (!composition) {
          sendPayload(400, { "Content-Type": "application/json" }, JSON.stringify({ error: "Node is not a composition" }));
          return;
        }
        const frames = Math.max(1, compositionTotalFrames(composition));
        sendPayload(200, { "Content-Type": "application/json" }, JSON.stringify({
          frames,
          fps: composition.fps,
          width: composition.width,
          height: composition.height,
          scale: this.scale,
        }));
      } catch (error) {
        sendPayload(500, { "Content-Type": "application/json" }, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    // Route: Validate
    if (pathname === "/validate") {
      const report = await this.validate();
      sendPayload(200, { "Content-Type": "application/json" }, JSON.stringify(report));
      return;
    }

    // Route: Media files strictly inside mediaRoot
    if (pathname.startsWith("/media/")) {
      const mediaRoot = resolve(this.options.rootDir, this.options.config.mediaDir ?? "./media");
      const rel = pathname.slice("/media/".length);
      const safePath = resolve(mediaRoot, decodeURIComponent(rel));
      const rootWithSep = mediaRoot.endsWith(sep) ? mediaRoot : mediaRoot + sep;

      if (!safePath.startsWith(rootWithSep) && safePath !== mediaRoot) {
        sendPayload(403, { "Content-Type": "application/json" }, JSON.stringify({ error: "Access denied: outside media directory" }));
        return;
      }

      if (!existsSync(safePath) || statSync(safePath).isDirectory()) {
        sendPayload(404, { "Content-Type": "application/json" }, JSON.stringify({ error: "Media file not found" }));
        return;
      }

      const ext = extname(safePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      try {
        const buffer = readFileSync(safePath);
        sendPayload(200, { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" }, buffer);
      } catch (err) {
        sendPayload(500, { "Content-Type": "application/json" }, JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // Route: Preview frame
    if (pathname.startsWith("/preview/")) {
      const id = decodeURIComponent(pathname.slice("/preview/".length));
      const node = this.graph.get(id);
      const requestedVersion = url.searchParams.get("v");
      const currentVersion = this.previews.get(id)?.version;

      if (requestedVersion !== null && currentVersion !== undefined && Number(requestedVersion) !== currentVersion) {
        sendPayload(409, { "Content-Type": "application/json" }, JSON.stringify({ error: "Stale preview version", refresh: true }));
        return;
      }

      const frameParam = url.searchParams.get("frame");
      if (node && frameParam !== null) {
        try {
          const frame = Number.parseInt(frameParam, 10);
          const safeFrame = Number.isFinite(frame) ? Math.max(0, frame) : 0;
          const scaleParam = url.searchParams.get("scale");
          const reqScale = scaleParam ? clampResolutionScale(Number(scaleParam)) : this.scale;
          const hiddenParam = url.searchParams.get("hidden");
          const hidden = new Set(hiddenParam ? hiddenParam.split(",").map((v) => Number(v)).filter(Number.isFinite) : []);
          const version = this.previews.get(id)?.version ?? 0;
          const key = `${node.id}:${safeFrame}:${reqScale}:${[...hidden].sort().join(",")}:${version}`;
          const cached = this.previewLru.get(key);
          const preview = cached ?? this.cachePreview(key, await this.producePreview(node, safeFrame, hidden, reqScale));
          sendPayload(200, { "Content-Type": preview.contentType, "Cache-Control": "no-cache" }, preview.buffer);
          return;
        } catch (error) {
          sendPayload(500, { "Content-Type": "application/json" }, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          return;
        }
      }

      const preview = this.previews.get(id);
      if (!preview) {
        sendPayload(404, { "Content-Type": "text/plain" }, "No preview yet");
        return;
      }
      sendPayload(200, { "Content-Type": preview.contentType, "Cache-Control": "no-store" }, preview.buffer);
      return;
    }

    sendPayload(404, { "Content-Type": "text/plain" }, "Not found");
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

  cachePreview(key: string, preview: PreviewFrame): PreviewFrame {
    this.previewLru.delete(key);
    this.previewLru.set(key, preview);
    let bytes = 0;
    for (const entry of this.previewLru.values()) bytes += entry.buffer.length;
    while (this.previewLru.size > 128 || bytes > 64 * 1024 * 1024) {
      const oldest = this.previewLru.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      bytes -= this.previewLru.get(oldest)?.buffer.length ?? 0;
      this.previewLru.delete(oldest);
    }
    return preview;
  }

  private async producePreview(
    node: DevNode,
    frame: number,
    hidden: ReadonlySet<number> = new Set(),
    scale: ResolutionScale = this.scale,
    camera?: PreviewCameraState,
  ): Promise<PreviewFrame> {
    const project = this.projectSnapshot;
    const safeFrame = Number.isFinite(frame) && frame >= 0 ? Math.floor(frame) : 0;
    switch (node.kind) {
      case "image": {
        const resolvedImage = await resolveImageClip(project, node.id);
        const buffer = await renderImageBuffer(resolvedImage.clips, {
          width: Math.max(1, Math.round(resolvedImage.width * scale)),
          height: Math.max(1, Math.round(resolvedImage.height * scale)),
          background: resolvedImage.background,
          format: "png",
          scaleFactor: scale,
        });
        return { buffer, contentType: "image/png" };
      }
      case "audio": {
        const buffer = await resolveAudioBuffer(project, node.id);
        return { buffer: encodeWavBuffer(buffer), contentType: "audio/wav" };
      }
      case "scene": {
        const composition = this.filterTracks(await composeSceneComposition(project, node.id), hidden);
        const engine = new PreviewEngine(composition, { scale, bypassEffects: true, camera });
        const renderResult = await engine.render(safeFrame);
        const buffer = (renderResult.canvas as unknown as { toBuffer(mime: string): Buffer }).toBuffer("image/png");
        engine.dispose();
        return { buffer, contentType: "image/png" };
      }
      case "timeline": {
        const composition = this.filterTracks(await assembleTimelineComposition(project, node.id), hidden);
        const engine = new PreviewEngine(composition, { scale, bypassEffects: true, camera });
        const renderResult = await engine.render(safeFrame);
        const buffer = (renderResult.canvas as unknown as { toBuffer(mime: string): Buffer }).toBuffer("image/png");
        engine.dispose();
        return { buffer, contentType: "image/png" };
      }
    }
  }

  private async resolveComposition(node: DevNode): Promise<Composition | null> {
    if (node.kind === "scene") return composeSceneComposition(this.projectSnapshot, node.id);
    if (node.kind === "timeline") return assembleTimelineComposition(this.projectSnapshot, node.id);
    return null;
  }

  private async handleWsMessage(client: WsClient, data: unknown): Promise<void> {
    if (typeof data !== "object" || data === null) return;
    const message = data as Record<string, unknown>;
    const type = typeof message.type === "string" ? message.type : "";

    // Reject mutating operations on read-only server
    if (type === "clip:update" || type === "layer:update" || type === "layer:reorder") {
      client.send({
        type: "error",
        version: PROTOCOL_VERSION,
        code: "CC6001",
        message: "Preview server is read-only. Mutation operations are forbidden.",
      });
      return;
    }

    let session = this.sessions.get(client.id);
    if (!session) {
      session = {
        client,
        selectedNodeId: this.graph.nodes[0]?.id ?? "",
        isRendering: false,
        pendingSeek: null,
        playing: false,
        playTimer: null,
        currentFrame: 0,
      };
      this.sessions.set(client.id, session);
    }

    if (type === "hello") {
      client.send({
        type: "welcome",
        version: PROTOCOL_VERSION,
        nodes: this.graph.nodes.map((n) => ({ id: n.id, kind: n.kind, name: n.name })),
        error: this.options.initialError,
      });
      client.send(this.getStatus(session));
      return;
    }

    if (type === "status:request") {
      client.send(this.getStatus(session));
      return;
    }

    if (type === "ping") {
      client.send({
        type: "pong",
        version: PROTOCOL_VERSION,
        timestamp: typeof message.timestamp === "number" ? message.timestamp : Date.now(),
      });
      return;
    }

    if (type === "select" && typeof message.node === "string") {
      session.selectedNodeId = message.node;
      session.currentFrame = 0;
      void this.renderFrameForSession(session, 0);
      return;
    }

    if (type === "preview:layers") {
      this.hiddenTracks.set(client.id, new Set(Array.isArray(message.hidden) ? (message.hidden as number[]) : []));
      return;
    }

    if (type === "view:set" || type === "view:state" || type === "camera:orbit" || type === "camera:pan" || type === "camera:zoom") {
      const orbit = (message.orbit ?? (typeof message.theta === "number" ? { theta: message.theta, phi: Number(message.phi) || 0 } : undefined)) as { theta: number; phi: number } | undefined;
      const pan = (message.pan ?? (typeof message.panX === "number" ? { x: message.panX, y: Number(message.panY) || 0 } : undefined)) as { x: number; y: number } | undefined;
      const zoom = typeof message.zoom === "number" ? message.zoom : undefined;
      session.camera = { orbit, pan, zoom };
      client.send({
        type: "view:ack",
        version: PROTOCOL_VERSION,
        state: message,
      });
      void this.renderFrameForSession(session, session.currentFrame);
      return;
    }

    if (type === "view:reset") {
      session.camera = undefined;
      client.send({
        type: "view:ack",
        version: PROTOCOL_VERSION,
        state: { reset: true },
      });
      void this.renderFrameForSession(session, session.currentFrame);
      return;
    }

    if (type === "seek" || type === "preview:frame") {
      const rawFrame = typeof message.frame === "number" ? message.frame : 0;
      const targetFrame = Math.max(0, Math.floor(rawFrame));
      const targetScale = typeof message.scale === "number" ? clampResolutionScale(message.scale) : undefined;
      if (typeof message.node === "string") session.selectedNodeId = message.node;

      // Backpressure: if currently rendering, queue seek (superseding older pending seek)
      if (session.isRendering) {
        session.pendingSeek = { frame: targetFrame, scale: targetScale };
        return;
      }
      void this.renderFrameForSession(session, targetFrame, targetScale);
      return;
    }

    if (type === "play") {
      if (session.playing) return;
      session.playing = true;
      const fps = Math.min(60, Math.max(1, typeof message.fps === "number" ? message.fps : 30));
      const intervalMs = Math.floor(1000 / fps);

      session.playTimer = setInterval(() => {
        if (!session.playing) return;
        const node = this.graph.get(session.selectedNodeId) ?? this.graph.nodes[0];
        if (!node) return;
        session.currentFrame = session.currentFrame + 1;
        void this.renderFrameForSession(session, session.currentFrame);
      }, intervalMs);
      return;
    }

    if (type === "pause") {
      session.playing = false;
      if (session.playTimer) {
        clearInterval(session.playTimer);
        session.playTimer = null;
      }
      return;
    }

    // Unknown message types rejected with protocol error code; connection kept open
    client.send({
      type: "error",
      version: PROTOCOL_VERSION,
      code: "CC6001",
      message: `Preview server is read-only. Unknown or unsupported operation '${type}' rejected.`,
    });
  }

  async renderFrameForSession(
    session: ClientSession,
    frame: number,
    requestedScale?: ResolutionScale,
  ): Promise<void> {
    session.isRendering = true;
    session.currentFrame = frame;
    const node = this.graph.get(session.selectedNodeId) ?? this.graph.nodes[0];
    if (!node) {
      session.isRendering = false;
      return;
    }

    const scale = requestedScale ?? this.scale;
    const hidden = this.hiddenTracks.get(session.client.id) ?? new Set();
    const started = Date.now();

    try {
      const composition = await this.resolveComposition(node);
      const totalFrames = composition ? Math.max(1, compositionTotalFrames(composition)) : 1;
      const safeFrame = frame % totalFrames;

      const engine = new PreviewEngine(composition!, {
        scale,
        bypassEffects: true,
        camera: session.camera,
      });

      const renderResult: PreviewRenderResult = await engine.render(safeFrame);
      const pngBuffer = (renderResult.canvas as unknown as { toBuffer(mime: string): Buffer }).toBuffer("image/png");
      engine.dispose();

      // Encode into binary message with documented CCFR header
      const binaryFrame = encodeFrameBinary(
        safeFrame,
        renderResult.canvas.width,
        renderResult.canvas.height,
        FRAME_FORMAT_PNG,
        pngBuffer,
      );

      session.client.sendBinary(binaryFrame);

      // Adaptive degradation: lower scale if frame exceeds budget (100ms), min 0.1
      const elapsed = Date.now() - started;
      if (elapsed > 100 && this.scale > 0.1) {
        if (this.scale >= 0.5) this.scale = 0.25;
        else if (this.scale >= 0.25) this.scale = 0.1;
        session.client.send(this.getStatus(session));
      }
    } catch (err: unknown) {
      session.client.send({
        type: "error",
        version: PROTOCOL_VERSION,
        node: node.id,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      session.isRendering = false;
      // Drain pending seek if arrived while rendering
      if (session.pendingSeek) {
        const next = session.pendingSeek;
        session.pendingSeek = null;
        void this.renderFrameForSession(session, next.frame, next.scale ? clampResolutionScale(next.scale) : undefined);
      }
    }
  }

  async stop(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.playTimer) clearInterval(session.playTimer);
    }
    this.sessions.clear();
    this.hiddenTracks.clear();
    this.watcher?.close();
    this.watcher = null;
    this.hub.closeAll();
    this.previews.clear();
    this.previewLru.clear();
    this.validationCache.clear();
    this.registeredFontMtimes.clear();
    await new Promise<void>((resolvePromise) => {
      if (!this.server) return resolvePromise();
      this.server.close(() => resolvePromise());
    });
    this.server = null;
  }
}

// DevServer alias for backwards compatibility
export { PreviewHost as DevServer };
