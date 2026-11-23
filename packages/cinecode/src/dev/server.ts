import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import type { Composition } from "../core/types/index.js";
import { setMediaCacheForRenderer } from "../renderer/engine.js";
import { createMediaCache } from "../media/cache.js";
import { createRenderCache } from "../pipeline/cache.js";
import type { CheckReport } from "../cli/gate/check.js";
import { createError, ErrorCode } from "../errors/index.js";
import { ModuleGraph } from "./module-graph.js";
import { disposeUserModuleCache } from "../loader/index.js";
import { WebSocketHub, type WsClient } from "./transport.js";
import { ProjectWatcher } from "./watcher.js";
import type { DevNode, DevServerOptions, PreviewFrame } from "./types.js";
import type { PreviewCameraState } from "../renderer/preview-engine.js";
import { clampResolutionScale, type ResolutionScale } from "../renderer/scale.js";
import { runReport } from "../cli/output/run-report.js";
import { PROTOCOL_VERSION, type ServerStatusMessage } from "./protocol.js";
import type { ManifestProject } from "../manifest/index.js";
import type { ClientSession, PreviewServerContext } from "./server-types.js";
import { handleServerRequest } from "./server-routes.js";
import { produceServerPreview, resolveServerComposition } from "./server-render.js";
import { checkValidServerMessage, processWsMessage, renderFrameForSession } from "./server-ws.js";
import { handleFileChanges, validateProject } from "./server-watcher.js";

export * from "./server-types.js";

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export class PreviewHost {
  private options: DevServerOptions;
  graph: ModuleGraph;
  readonly hub = new WebSocketHub();
  readonly previews = new Map<string, PreviewFrame>();
  readonly previewLru = new Map<string, PreviewFrame>();
  readonly sessions = new Map<number, ClientSession>();
  private readonly rejectedTypes = new Set<string>();
  readonly validationCache = new Map<string, CheckReport>();
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
      void this.safeHandleWsMessage(client, data);
    });
    this.hub.onClose((client) => this.dropSession(client));
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

  private createContext(): PreviewServerContext {
    return {
      options: this.options,
      setOptions: (opts) => { this.options = opts; },
      graph: this.graph,
      projectSnapshot: this.projectSnapshot,
      setProjectSnapshot: (p) => { this.projectSnapshot = p; },
      previews: this.previews,
      previewLru: this.previewLru,
      sessions: this.sessions,
      validationCache: this.validationCache,
      scale: this.scale,
      setScale: (s) => { this.scale = s; },
      cachePreview: (k, p) => this.cachePreview(k, p),
      producePreview: (n, f, s, c) => this.producePreview(n, f, s, c),
      resolveComposition: (n) => this.resolveComposition(n),
      validate: () => this.validate(),
      requestFrame: (s, f, sc) => this.requestFrame(s, f, sc),
      send: (c, m) => this.send(c, m),
      broadcast: (m) => this.broadcast(m),
      reject: (c, code, type, msg) => this.reject(c, code, type, msg),
      getStatus: (s) => this.getStatus(s),
      rebuildCaches: () => this.rebuildCaches(),
      startWatcher: () => this.startWatcher(),
    };
  }

  async start(): Promise<void> {
    if (!isLoopback(this.options.host)) {
      if (!this.options.allowNetwork) {
        throw createError(
          ErrorCode.CC1012,
          { reason: `Non-loopback host '${this.options.host}' requires explicit opt-in` },
          { fixHint: "Pass --allow-network to expose the server beyond loopback." },
        );
      }
      if (!this.nonLoopbackWarned) {
        this.nonLoopbackWarned = true;
        const warning = `Binding to non-loopback host '${this.options.host}'. Server is exposed to the local network.`;
        runReport.warn("CC1012", warning);
        runReport.diagnostic(`Warning: ${warning}`);
      }
    }

    await this.rebuildCaches();

    const server = createServer((req, res) => { void this.handleRequest(req, res); });
    this.server = server;

    server.on("upgrade", (request, socket, head) => {
      const url = request.url ?? "";
      if (url.startsWith("/ws") || url.startsWith("/hmr") || url.startsWith("/preview-stream")) {
        const client = this.hub.handleUpgrade(request, socket, head);
        const session = this.createSession(client);
        this.sessions.set(client.id, session);
        this.send(client, {
          type: "welcome",
          version: PROTOCOL_VERSION,
          nodes: this.graph.nodes.map((n) => ({ id: n.id, kind: n.kind, name: n.name })),
        });
        this.send(client, this.getStatus(session));
      } else {
        socket.destroy();
      }
    });

    const basePort = this.options.port;
    const triedPorts: number[] = [];
    let bound = false;

    for (let offset = 0; offset < 10; offset++) {
      const portToTry = basePort + offset;
      triedPorts.push(portToTry);
      try {
        await new Promise<void>((resolveListen, rejectListen) => {
          const onListen = (): void => { server.off("error", onError); resolveListen(); };
          const onError = (err: unknown): void => { server.off("listening", onListen); rejectListen(err); };
          server.once("listening", onListen);
          server.once("error", onError);
          server.listen(portToTry, this.options.host);
        });
        const addr = this.server?.address();
        this.actualPort = addr && typeof addr === "object" ? addr.port : portToTry;
        bound = true;
        break;
      } catch (err: unknown) {
        if (err && (err as { code?: string }).code === "EADDRINUSE") continue;
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

    const modeName = this.options.mode ?? "dev";
    runReport.diagnostic(`Cinecode ${modeName} server running at ${this.url}`);
    runReport.diagnostic(`Host: ${this.options.host}, Port: ${this.actualPort}, Targets: ${this.graph.nodes.length}`);

    this.startWatcher();
    void this.primeFirstFrame();
  }

  async rebuildCaches(): Promise<void> {
    const cacheDir = resolve(this.options.rootDir, this.options.config.cacheDir ?? ".cinecode/cache");
    const mediaCache = createMediaCache(join(cacheDir, "media"));
    await mediaCache.initialize();
    setMediaCacheForRenderer(mediaCache);
    const renderCache = createRenderCache(cacheDir);
    await renderCache.initialize();
  }

  startWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
    if ((this.options.mode ?? "dev") !== "dev" || !this.options.hmr) return;
    this.watcher = new ProjectWatcher({
      rootDir: this.options.rootDir,
      sourceDir: this.options.config.sourceDir ?? "./src",
      mediaDir: this.options.config.mediaDir ?? "./media",
      entryPath: this.projectSnapshot.entryPath,
      configPath: this.options.configPath,
      additionalFiles: this.graph.allTrackedFiles(),
      onChange: (files) => void this.handleChange(files),
    });
    this.watcher.start();
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
    await handleFileChanges(this.createContext(), files);
  }

  async validate(): Promise<CheckReport> {
    return validateProject(this.createContext());
  }

  getStatus(session?: ClientSession): ServerStatusMessage {
    return {
      type: "status",
      version: PROTOCOL_VERSION,
      ready: session ? !session.isRendering : true,
      cachedFrames: session ? session.frameCache.size : this.previewLru.size,
      scale: this.scale,
      reducedEffects: true,
    };
  }

  async dispatchRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await this.handleRequest(req, res);
  }

  async dispatchWsMessage(client: WsClient, data: unknown): Promise<void> {
    await this.handleWsMessage(client, data);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await handleServerRequest(this.createContext(), req, res);
    } catch (error) {
      this.failRequest(res, error);
    }
  }

  private failRequest(res: ServerResponse, error: unknown): void {
    if (res.headersSent) { res.end(); return; }
    const malformed = error instanceof URIError;
    const code = malformed ? "CC1012" : (error as { code?: string } | null)?.code ?? "CC9001";
    const message = error instanceof Error ? error.message : String(error);
    res.writeHead(malformed ? 400 : 500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ code, error: message }));
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

  async producePreview(
    node: DevNode,
    frame: number,
    scale: ResolutionScale = this.scale,
    camera?: PreviewCameraState,
  ): Promise<PreviewFrame> {
    return produceServerPreview(this.projectSnapshot, node, frame, scale, camera);
  }

  async resolveComposition(node: DevNode): Promise<Composition | null> {
    return resolveServerComposition(this.projectSnapshot, node);
  }

  private createSession(client: WsClient): ClientSession {
    return {
      client,
      selectedNodeId: this.graph.nodes[0]?.id ?? "",
      isRendering: false,
      pendingFrame: null,
      currentFrame: 0,
      generation: 0,
      frameCache: new Map(),
      cacheBytes: 0,
    };
  }

  send(client: WsClient, message: unknown): void {
    if (checkValidServerMessage(message)) client.send(message);
  }

  broadcast(message: unknown): void {
    if (checkValidServerMessage(message)) this.hub.broadcast(message);
  }

  reject(client: WsClient, code: string, type: string, message: string): void {
    this.send(client, { type: "error", version: PROTOCOL_VERSION, code, message });
    const key = `${code}:${type || "payload"}`;
    if (!this.rejectedTypes.has(key)) {
      this.rejectedTypes.add(key);
      runReport.debug(`[preview] rejected ${type || "payload"} (${code})`);
    }
  }

  private dropSession(client: WsClient): void {
    const session = this.sessions.get(client.id);
    if (!session) return;
    session.pendingFrame = null;
    session.frameCache.clear();
    session.cacheBytes = 0;
    this.sessions.delete(client.id);
  }

  requestFrame(session: ClientSession, frame: number, requestedScale?: ResolutionScale): void {
    if (this.sessions.get(session.client.id) !== session) return;
    session.currentFrame = frame;
    session.generation += 1;
    if (session.isRendering) {
      session.pendingFrame = {
        frame,
        scale: requestedScale ?? session.pendingFrame?.scale,
        generation: session.generation,
      };
      return;
    }
    void renderFrameForSession(this.createContext(), session, frame, requestedScale, session.generation);
  }

  private async safeHandleWsMessage(client: WsClient, data: unknown): Promise<void> {
    try {
      await this.handleWsMessage(client, data);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? "CC9001";
      this.send(client, {
        type: "error",
        version: PROTOCOL_VERSION,
        code,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleWsMessage(client: WsClient, data: unknown): Promise<void> {
    await processWsMessage(this.createContext(), client, data);
  }

  async stop(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.pendingFrame = null;
      session.frameCache.clear();
      session.cacheBytes = 0;
    }
    this.sessions.clear();
    this.watcher?.close();
    this.watcher = null;
    this.hub.closeAll();
    this.previews.clear();
    this.previewLru.clear();
    this.validationCache.clear();
    this.registeredFontMtimes.clear();
    disposeUserModuleCache();
    await new Promise<void>((resolvePromise) => {
      if (!this.server) return resolvePromise();
      this.server.close(() => resolvePromise());
    });
    this.server = null;
  }
}

export { PreviewHost as DevServer };
