import type { WsClient } from "./transport.js";
import {
  encodeFrameBinary,
  FRAME_FORMAT_PNG,
  MODE_ALLOWLISTS,
  parseClientMessage,
  PROTOCOL_READ_ONLY,
  PROTOCOL_VERSION,
  validateServerMessage,
  type ClientMessage,
  type ServerFrameMessage,
} from "./protocol.js";
import { runReport } from "../cli/output/run-report.js";
import type { ResolutionScale } from "../renderer/scale.js";
import type { PreviewCameraState } from "../renderer/preview-engine.js";
import type { ClientSession, PreviewServerContext, SessionCachedFrame } from "./server-types.js";

export function formatFrameCacheKey(
  nodeId: string,
  frame: number,
  scale: number,
  camera?: PreviewCameraState,
): string {
  if (!camera) return `${nodeId}:${frame}:${scale}:default`;
  const orbit = camera.orbit ? `${camera.orbit.theta},${camera.orbit.phi}` : "0,0";
  const pan = camera.pan ? `${camera.pan.x},${camera.pan.y}` : "0,0";
  const zoom = camera.zoom ?? 1;
  return `${nodeId}:${frame}:${scale}:${orbit}:${pan}:${zoom}`;
}

export function putSessionFrameCache(
  session: ClientSession,
  key: string,
  entry: SessionCachedFrame,
  maxEntries = 64,
  maxBytes = 32 * 1024 * 1024,
): void {
  const existing = session.frameCache.get(key);
  if (existing) {
    session.cacheBytes -= existing.buffer.length;
    session.frameCache.delete(key);
  }
  session.frameCache.set(key, entry);
  session.cacheBytes += entry.buffer.length;

  while (session.frameCache.size > maxEntries || session.cacheBytes > maxBytes) {
    const oldestKey = session.frameCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    const oldestEntry = session.frameCache.get(oldestKey);
    if (oldestEntry) session.cacheBytes -= oldestEntry.buffer.length;
    session.frameCache.delete(oldestKey);
  }
}

export function invalidateSessionNode(session: ClientSession, nodeId: string): void {
  for (const [key, entry] of session.frameCache.entries()) {
    if (key.startsWith(`${nodeId}:`)) {
      session.cacheBytes -= entry.buffer.length;
      session.frameCache.delete(key);
    }
  }
}

export function checkValidServerMessage(message: unknown): boolean {
  const issues = validateServerMessage(message);
  if (issues.length === 0) return true;
  runReport.debug(`[preview] invalid server message: ${issues.join("; ")}`);
  return false;
}

export async function processWsMessage(
  context: PreviewServerContext,
  client: WsClient,
  data: unknown,
): Promise<void> {
  const parsed = parseClientMessage(data);
  if (!parsed.ok) {
    context.reject(client, parsed.code, parsed.type, parsed.message);
    return;
  }
  const message: ClientMessage = parsed.message;
  const allowlist = MODE_ALLOWLISTS[context.options.mode ?? "preview"];
  if (!allowlist.includes(message.type)) {
    context.reject(client, PROTOCOL_READ_ONLY, message.type, `Read-only preview rejects '${message.type}'.`);
    return;
  }

  let session = context.sessions.get(client.id);
  if (!session) {
    session = {
      client,
      selectedNodeId: context.graph.nodes[0]?.id ?? "",
      isRendering: false,
      pendingFrame: null,
      currentFrame: 0,
      generation: 0,
      frameCache: new Map(),
      cacheBytes: 0,
    };
    context.sessions.set(client.id, session);
  }

  switch (message.type) {
    case "hello":
      context.send(client, {
        type: "welcome",
        version: PROTOCOL_VERSION,
        nodes: context.graph.nodes.map((n) => ({ id: n.id, kind: n.kind, name: n.name })),
      });
      context.send(client, context.getStatus(session));
      return;
    case "status:request":
      context.send(client, context.getStatus(session));
      return;
    case "ping":
      context.send(client, {
        type: "pong",
        version: PROTOCOL_VERSION,
        timestamp: typeof message.timestamp === "number" ? message.timestamp : Date.now(),
      });
      return;
    case "select": {
      const nodeId = message.node as string;
      if (!context.graph.get(nodeId)) {
        context.reject(client, "CC1014", "select", `Unknown node '${nodeId}'.`);
        return;
      }
      if (session.selectedNodeId !== nodeId) {
        invalidateSessionNode(session, session.selectedNodeId);
        session.selectedNodeId = nodeId;
      }
      session.pendingFrame = null;
      context.requestFrame(session, 0);
      return;
    }
    case "view:set":
    case "camera:zoom":
      invalidateSessionNode(session, session.selectedNodeId);
      session.camera = { ...session.camera, zoom: message.zoom as number };
      context.send(client, { type: "view:ack", version: PROTOCOL_VERSION, state: { ...session.camera } });
      context.requestFrame(session, session.currentFrame);
      return;
    case "camera:orbit":
      invalidateSessionNode(session, session.selectedNodeId);
      session.camera = {
        ...session.camera,
        orbit: { theta: message.theta as number, phi: message.phi as number },
      };
      context.send(client, { type: "view:ack", version: PROTOCOL_VERSION, state: { ...session.camera } });
      context.requestFrame(session, session.currentFrame);
      return;
    case "view:reset":
      invalidateSessionNode(session, session.selectedNodeId);
      session.camera = undefined;
      context.send(client, { type: "view:ack", version: PROTOCOL_VERSION, state: { reset: true } });
      context.requestFrame(session, session.currentFrame);
      return;
  }
}

export async function renderFrameForSession(
  context: PreviewServerContext,
  session: ClientSession,
  frame: number,
  requestedScale?: ResolutionScale,
  generation = session.generation,
): Promise<void> {
  session.isRendering = true;
  session.currentFrame = frame;
  const node = context.graph.get(session.selectedNodeId) ?? context.graph.nodes[0];
  if (!node) {
    session.isRendering = false;
    return;
  }

  const scale = requestedScale ?? context.scale;
  const started = Date.now();

  try {
    if (context.sessions.get(session.client.id) !== session) return;
    const kind: string = node.kind;
    if (kind === "audio" || (kind !== "image" && kind !== "scene" && kind !== "timeline")) {
      context.send(session.client, {
        type: "preview:unavailable",
        version: PROTOCOL_VERSION,
        node: node.id,
        kind,
        reason: kind === "audio"
          ? "Audio nodes are not previewable as frames."
          : `Node kind '${kind}' is not previewable.`,
        metadata: { name: node.name, file: node.file, contentType: kind === "audio" ? "audio/wav" : undefined },
      });
      return;
    }

    const cacheKey = formatFrameCacheKey(node.id, frame, scale, session.camera);
    const cachedEntry = session.frameCache.get(cacheKey);

    if (cachedEntry) {
      session.frameCache.delete(cacheKey);
      session.frameCache.set(cacheKey, cachedEntry);

      const frameMessage: ServerFrameMessage = {
        type: "frame",
        version: PROTOCOL_VERSION,
        node: node.id,
        frame: cachedEntry.frame,
        generation,
        camera: session.camera ? { ...session.camera } : null,
        scale: cachedEntry.scale,
        width: cachedEntry.width,
        height: cachedEntry.height,
        cached: true,
      };
      context.send(session.client, frameMessage);
      session.client.sendBinary(encodeFrameBinary(cachedEntry.frame, cachedEntry.width, cachedEntry.height, FRAME_FORMAT_PNG, cachedEntry.buffer));

      const latencyMs = Date.now() - started;
      runReport.debug(`[preview] frame ${frame} served from cache in ${latencyMs}ms (scale: ${scale})`);
      return;
    }

    const preview = await context.producePreview(node, frame, scale, session.camera);
    if (context.sessions.get(session.client.id) !== session) return;
    const frameIndex = preview.frame ?? 0;
    const width = preview.width ?? 0;
    const height = preview.height ?? 0;

    putSessionFrameCache(session, cacheKey, {
      buffer: preview.buffer,
      width,
      height,
      frame: frameIndex,
      scale,
    });

    const frameMessage: ServerFrameMessage = {
      type: "frame",
      version: PROTOCOL_VERSION,
      node: node.id,
      frame: frameIndex,
      generation,
      camera: session.camera ? { ...session.camera } : null,
      scale,
      width,
      height,
      cached: false,
    };
    context.send(session.client, frameMessage);
    session.client.sendBinary(encodeFrameBinary(frameIndex, width, height, FRAME_FORMAT_PNG, preview.buffer));

    const elapsed = Date.now() - started;
    runReport.diagnostic(`[preview] frame ${frameIndex} rendered in ${elapsed}ms (scale: ${scale})`);

    if (elapsed > 100 && context.scale > 0.1) {
      if (context.scale >= 0.5) context.setScale(0.25);
      else if (context.scale >= 0.25) context.setScale(0.1);
      context.send(session.client, context.getStatus(session));
    }
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code ?? "CC4001";
    context.send(session.client, {
      type: "error",
      version: PROTOCOL_VERSION,
      node: node.id,
      code,
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    session.isRendering = false;
    if (context.sessions.get(session.client.id) !== session) {
      session.pendingFrame = null;
      return;
    }
    const next = session.pendingFrame;
    session.pendingFrame = null;
    if (next) {
      void renderFrameForSession(context, session, next.frame, next.scale, next.generation);
    }
  }
}
