import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { compositionTotalFrames } from "../core/time/index.js";
import { clampResolutionScale } from "../renderer/scale.js";
import { getViewerDocument, getViewerAsset } from "./viewer-assets.js";
import type { PreviewServerContext } from "./server-types.js";

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

export function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new URIError("Malformed percent-encoding in request path.");
  }
}

export async function handleServerRequest(
  context: PreviewServerContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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
  let url: URL;
  try {
    url = new URL(rawUrl, "http://localhost");
  } catch {
    throw new URIError("Malformed request URL.");
  }
  const pathname = url.pathname;

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");

  const sendPayload = (status: number, headers: Record<string, string>, body?: Buffer | string): void => {
    res.writeHead(status, headers);
    if (method === "HEAD") {
      res.end();
    } else {
      res.end(body);
    }
  };

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

  if (pathname === "/" || pathname === "/index.html") {
    const doc = getViewerDocument();
    sendPayload(200, doc.headers, doc.html);
    return;
  }

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

  if (pathname === "/health" || pathname === "/api/health") {
    const payload = JSON.stringify({
      status: "ok",
      readOnly: true,
      mode: context.options.mode ?? "preview",
      targets: context.graph.nodes.length,
      scale: context.scale,
      sessions: context.sessions.size,
      uptime: Math.floor(process.uptime()),
    });
    sendPayload(200, { "Content-Type": "application/json" }, payload);
    return;
  }

  if (pathname === "/nodes" || pathname === "/api/project") {
    sendPayload(200, { "Content-Type": "application/json" }, JSON.stringify(context.graph.nodes));
    return;
  }

  if (pathname.startsWith("/composition/")) {
    const id = decodePath(pathname.slice("/composition/".length));
    const node = context.graph.get(id);
    if (!node) {
      sendPayload(404, { "Content-Type": "application/json" }, JSON.stringify({ error: `Unknown node: ${id}` }));
      return;
    }
    try {
      const composition = await context.resolveComposition(node);
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
        scale: context.scale,
        clipCount: tracks.reduce((total, track) => total + track.clipCount, 0),
        tracks,
      }));
    } catch (error) {
      sendPayload(500, { "Content-Type": "application/json" }, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  if (pathname.startsWith("/frames/")) {
    const id = decodePath(pathname.slice("/frames/".length));
    const node = context.graph.get(id);
    if (!node) {
      sendPayload(404, { "Content-Type": "application/json" }, JSON.stringify({ error: `Unknown node: ${id}` }));
      return;
    }
    try {
      const composition = await context.resolveComposition(node);
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
        scale: context.scale,
      }));
    } catch (error) {
      sendPayload(500, { "Content-Type": "application/json" }, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  if (pathname === "/validate") {
    const report = await context.validate();
    sendPayload(200, { "Content-Type": "application/json" }, JSON.stringify(report));
    return;
  }

  if (pathname.startsWith("/media/")) {
    const mediaRoot = resolve(context.options.rootDir, context.options.config.mediaDir ?? "./media");
    const rel = pathname.slice("/media/".length);
    const safePath = resolve(mediaRoot, decodePath(rel));
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

  if (pathname.startsWith("/preview/")) {
    const id = decodePath(pathname.slice("/preview/".length));
    const node = context.graph.get(id);
    const requestedVersion = url.searchParams.get("v");
    const currentVersion = context.previews.get(id)?.version;

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
        const reqScale = scaleParam ? clampResolutionScale(Number(scaleParam)) : context.scale;
        const version = context.previews.get(id)?.version ?? 0;
        const key = `${node.id}:${safeFrame}:${reqScale}:${version}`;
        const cached = context.previewLru.get(key);
        const preview = cached ?? context.cachePreview(key, await context.producePreview(node, safeFrame, reqScale));
        sendPayload(200, { "Content-Type": preview.contentType, "Cache-Control": "no-cache" }, preview.buffer);
        return;
      } catch (error) {
        sendPayload(500, { "Content-Type": "application/json" }, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        return;
      }
    }

    const preview = context.previews.get(id);
    if (!preview) {
      sendPayload(404, { "Content-Type": "text/plain" }, "No preview yet");
      return;
    }
    sendPayload(200, { "Content-Type": preview.contentType, "Cache-Control": "no-store" }, preview.buffer);
    return;
  }

  sendPayload(404, { "Content-Type": "text/plain" }, "Not found");
}
