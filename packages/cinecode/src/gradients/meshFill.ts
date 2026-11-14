import { createCanvas, type Canvas } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";
import { generateMeshGradient, type MeshAnchor, type MeshSample } from "./mesh.js";

const meshCanvasCache = new Map<string, Canvas>();
const MESH_CACHE_MAX = 16;

export function hashAnchors(anchors: readonly MeshAnchor[], width: number, height: number): string {
  const sorted = [...anchors].sort((a, b) => a.x - b.x || a.y - b.y || a.color.localeCompare(b.color));
  return `${width}x${height}:${JSON.stringify(sorted)}`;
}

function samplesToCanvas(samples: readonly MeshSample[], width: number, height: number): Canvas {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]!;
    data[i * 4] = sample.r;
    data[i * 4 + 1] = sample.g;
    data[i * 4 + 2] = sample.b;
    data[i * 4 + 3] = sample.a;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function getCachedMeshCanvas(width: number, height: number, anchors: readonly MeshAnchor[]): Canvas {
  const key = hashAnchors(anchors, width, height);
  const cached = meshCanvasCache.get(key);
  if (cached) return cached;
  const canvas = samplesToCanvas(generateMeshGradient(width, height, anchors), width, height);
  if (meshCanvasCache.size >= MESH_CACHE_MAX) {
    const oldest = meshCanvasCache.keys().next().value;
    if (oldest !== undefined) meshCanvasCache.delete(oldest);
  }
  meshCanvasCache.set(key, canvas);
  return canvas;
}

export function drawMeshGradient(ctx: SKRSContext2D, width: number, height: number, anchors: readonly MeshAnchor[]): void {
  const canvas = getCachedMeshCanvas(width, height, anchors);
  ctx.drawImage(canvas, 0, 0, width, height);
}

export function generateRegularAnchors(cols: number, rows: number, baseColors: readonly string[]): MeshAnchor[] {
  const anchors: MeshAnchor[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = cols === 1 ? 0.5 : col / (cols - 1);
      const y = rows === 1 ? 0.5 : row / (rows - 1);
      anchors.push({ x, y, color: baseColors[(row * cols + col) % baseColors.length]! });
    }
  }
  return anchors;
}
