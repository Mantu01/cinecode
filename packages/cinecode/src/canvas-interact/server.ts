import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import { Canvas } from "@napi-rs/canvas";
import type { CanvasState, CanvasMessage, CanvasOperation, CanvasLayer } from "./types.js";
import { DEFAULT_HISTORY_DEPTH } from "./history.js";
import { WebSocketHub } from "../dev/websocket.js";

import type { SKRSContext2D } from "@napi-rs/canvas";
type CanvasRenderContext = SKRSContext2D;

function generateId(): string {
  return randomUUID();
}

function createDefaultState(width: number, height: number): CanvasState {
  const layerId = generateId();
  return {
    width,
    height,
    layers: [{
      id: layerId,
      name: "Layer 1",
      opacity: 1,
      visible: true,
      locked: false,
      operations: [],
    }],
    activeTool: "brush",
    activeLayerId: layerId,
    zoom: 1,
    pan: { x: 0, y: 0 },
    history: [],
    historyIndex: -1,
  };
}

function pushHistory(state: CanvasState, maxDepth: number): CanvasState {
  const snapshot = JSON.parse(JSON.stringify(state)) as CanvasState;
  let history = state.history.slice(0, state.historyIndex + 1);
  history.push({ snapshot, timestamp: Date.now() });
  if (history.length > maxDepth) history = history.slice(history.length - maxDepth);
  return { ...state, history, historyIndex: history.length - 1 };
}

function reorderLayer(layers: readonly CanvasLayer[], layerId: string, toIndex: number): CanvasLayer[] {
  const fromIndex = layers.findIndex((layer) => layer.id === layerId);
  if (fromIndex < 0) return [...layers];
  const target = Math.max(0, Math.min(layers.length - 1, Math.floor(toIndex)));
  if (target === fromIndex) return [...layers];
  const ordered = [...layers];
  const [layer] = ordered.splice(fromIndex, 1);
  if (!layer) return [...layers];
  ordered.splice(target, 0, layer);
  return ordered;
}

function renderOperation(ctx: CanvasRenderContext, op: CanvasOperation): void {
  switch (op.kind) {
    case "rect": {
      if (op.fill) { ctx.fillStyle = op.fill; ctx.fillRect(op.x, op.y, op.w, op.h); }
      if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = op.strokeWidth ?? 2; ctx.strokeRect(op.x, op.y, op.w, op.h); }
      break;
    }
    case "ellipse": {
      ctx.beginPath();
      ctx.ellipse(op.cx, op.cy, op.rx, op.ry, 0, 0, Math.PI * 2);
      if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(); }
      if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.stroke(); }
      break;
    }
    case "line": {
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(op.x2, op.y2);
      ctx.strokeStyle = op.stroke ?? "#000000";
      ctx.lineWidth = op.strokeWidth ?? 2;
      ctx.stroke();
      break;
    }
    case "path": {
      if (op.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(op.points[0]![0]!, op.points[0]![1]!);
      for (let i = 1; i < op.points.length; i++) {
        ctx.lineTo(op.points[i]![0]!, op.points[i]![1]!);
      }
      if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(); }
      if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = op.strokeWidth ?? 2; ctx.stroke(); }
      break;
    }
    case "text": {
      const font = `${op.fontSize ?? 24}px ${op.font ?? "sans-serif"}`;
      ctx.font = font;
      ctx.fillStyle = op.color ?? "#000000";
      ctx.fillText(op.text, op.x, op.y);
      break;
    }
    case "brush": {
      if (op.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(op.points[0]![0]!, op.points[0]![1]!);
      for (let i = 1; i < op.points.length; i++) {
        ctx.lineTo(op.points[i]![0]!, op.points[i]![1]!);
      }
      ctx.strokeStyle = op.color ?? "#000000";
      ctx.lineWidth = op.strokeWidth ?? 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      break;
    }
  }
}

export interface CanvasServerOptions {
  readonly port: number;
  readonly defaultWidth?: number;
  readonly defaultHeight?: number;
  readonly historyDepth?: number;
}

export class CanvasServer {
  private readonly hub = new WebSocketHub();
  private readonly canvases = new Map<string, CanvasState>();
  private readonly clientCanvases = new Map<number, string>();
  private readonly defaultWidth: number;
  private readonly defaultHeight: number;
  private readonly historyDepth: number;

  constructor(options: CanvasServerOptions) {
    this.defaultWidth = options.defaultWidth ?? 1920;
    this.defaultHeight = options.defaultHeight ?? 1080;
    this.historyDepth = options.historyDepth ?? DEFAULT_HISTORY_DEPTH;
    this.hub.onMessage((client, data) => {
      this.handleMessage(client, data);
    });
  }

  private handleMessage(client: import("../dev/websocket.js").WsClient, data: unknown): void {
    if (typeof data !== "object" || data === null) return;
    const message = data as CanvasMessage;
    if (message.type === "canvas:create") {
      const state = createDefaultState(message.props.width, message.props.height);
      const initialized: CanvasState = {
        ...state,
        history: [{ snapshot: state, timestamp: Date.now() }],
        historyIndex: 0,
      };
      this.canvases.set(message.id, initialized);
      this.clientCanvases.set(client.id, message.id);
      client.send({ type: "canvas:state:reply", id: message.id, state: initialized });
      return;
    }

    const canvasId = this.clientCanvases.get(client.id) ?? ("id" in message ? message.id : undefined);
    if (!canvasId) return;
    const state = this.canvases.get(canvasId);
    if (!state) {
      client.send({ type: "canvas:error", id: canvasId, error: "Canvas not found" });
      return;
    }

    let next: CanvasState = state;
    if (message.type === "canvas:draw") {
      next = pushHistory({
        ...state,
        layers: state.layers.map((layer) => layer.id === state.activeLayerId
          ? { ...layer, operations: [...layer.operations, message.operation] }
          : layer),
      }, this.historyDepth);
    } else if (message.type === "canvas:undo" && state.historyIndex > 0) {
      const index = state.historyIndex - 1;
      next = { ...state.history[index]!.snapshot, history: state.history, historyIndex: index };
    } else if (message.type === "canvas:redo" && state.historyIndex < state.history.length - 1) {
      const index = state.historyIndex + 1;
      next = { ...state.history[index]!.snapshot, history: state.history, historyIndex: index };
    } else if (message.type === "canvas:layer:reorder") {
      next = pushHistory({ ...state, layers: reorderLayer(state.layers, message.layerId, message.toIndex) }, this.historyDepth);
    } else if (message.type === "canvas:layer:move") {
      const index = state.layers.findIndex((layer) => layer.id === message.layerId);
      const target = message.direction === "up" ? index + 1 : index - 1;
      if (index >= 0) next = pushHistory({ ...state, layers: reorderLayer(state.layers, message.layerId, target) }, this.historyDepth);
    } else if (message.type === "canvas:layer:toggle") {
      next = pushHistory({
        ...state,
        layers: state.layers.map((layer) => layer.id === message.layerId ? { ...layer, visible: message.visible } : layer),
      }, this.historyDepth);
    } else if (message.type === "canvas:state:request") {
      next = state;
    }

    this.canvases.set(canvasId, next);
    client.send({ type: "canvas:state:reply", id: canvasId, state: next });
  }

  createHttpServer(): import("node:http").Server {
    const server = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", canvases: this.canvases.size }));
        return;
      }
      if (req.url === "/canvas" && req.headers.upgrade?.toLowerCase() === "websocket") {
        try {
          const canvasId = generateId();
          const defaultState = createDefaultState(this.defaultWidth, this.defaultHeight);
          const state: CanvasState = {
            ...defaultState,
            history: [{ snapshot: defaultState, timestamp: Date.now() }],
            historyIndex: 0,
          };
          this.canvases.set(canvasId, state);

          const wsClient = this.hub.handleUpgrade(req, req as unknown as Duplex, Buffer.alloc(0));
          this.clientCanvases.set(wsClient.id, canvasId);
          wsClient.send(JSON.stringify({
            type: "connected",
            canvasId,
            defaultWidth: this.defaultWidth,
            defaultHeight: this.defaultHeight,
          }));

          wsClient.send(JSON.stringify({ type: "canvas:state:reply", id: canvasId, state }));
        } catch {
          (req as unknown as Duplex).destroy();
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });
    return server;
  }

  async exportCanvas(canvasId: string, format: "png" | "jpg" | "pdf", quality?: number): Promise<Buffer> {
    const state = this.canvases.get(canvasId);
    if (!state) throw new Error(`Canvas ${canvasId} not found`);

    if (format === "png") return this.renderToPng(state);
    if (format === "jpg") return this.renderToJpg(state, quality ?? 90);
    if (format === "pdf") {
      const { generatePdf } = await import("../pdf/index.js");
      const pngBuffer = await this.renderToPng(state);
      return generatePdf([[{ type: "canvas" as const, data: pngBuffer, width: state.width, height: state.height }]], {
        width: state.width / 72,
        height: state.height / 72,
        dpi: 72,
      });
    }
    throw new Error(`Unsupported export format: ${format}`);
  }

  toCinecodeSnippet(canvasId: string): string | null {
    const state = this.canvases.get(canvasId);
    if (!state) return null;
    return `import { image } from 'cinecode';\n\nconst canvasImage = image("./exports/${canvasId}.png", {\n  fit: "cover",\n  width: ${state.width},\n  height: ${state.height},\n});`;
  }

  private renderToPng(state: CanvasState): Buffer {
    const canvas = new Canvas(state.width, state.height);
    const ctx = canvas.getContext("2d") as CanvasRenderContext;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, state.width, state.height);
    for (const layer of [...state.layers].reverse()) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      for (const op of layer.operations) {
        renderOperation(ctx, op);
      }
    }
    return canvas.toBuffer("image/png");
  }

  private renderToJpg(state: CanvasState, quality: number): Buffer {
    const canvas = new Canvas(state.width, state.height);
    const ctx = canvas.getContext("2d") as CanvasRenderContext;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, state.width, state.height);
    for (const layer of [...state.layers].reverse()) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      for (const op of layer.operations) {
        renderOperation(ctx, op);
      }
    }
    return canvas.toBuffer("image/jpeg", quality);
  }
}
