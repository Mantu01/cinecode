import { parseColor } from "../renderer/color/parse.js";

export interface MeshAnchor {
  readonly x: number;
  readonly y: number;
  readonly color: string;
}

export interface MeshSample {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export function sampleMeshGradient(
  x: number,
  y: number,
  anchors: readonly MeshAnchor[],
  width: number,
  height: number,
): MeshSample {
  let totalWeight = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  const spread = Math.max(width, height) * 0.3;
  const spreadSq = spread * spread;
  for (const anchor of anchors) {
    const nx = anchor.x * width;
    const ny = anchor.y * height;
    const dist = Math.hypot(x - nx, y - ny);
    const weight = Math.exp(-(dist * dist) / spreadSq);
    const color = parseColor(anchor.color);
    r += color.r * weight;
    g += color.g * weight;
    b += color.b * weight;
    a += color.a * 255 * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: Math.round(r / totalWeight),
    g: Math.round(g / totalWeight),
    b: Math.round(b / totalWeight),
    a: Math.round(a / totalWeight),
  };
}

export function generateMeshGradient(
  width: number,
  height: number,
  anchors: readonly MeshAnchor[],
): MeshSample[] {
  const samples = new Array<MeshSample>(width * height);
  const colors = anchors.map((anchor) => ({ x: anchor.x * width, y: anchor.y * height, color: parseColor(anchor.color) }));
  const spread = Math.max(width, height) * 0.3;
  const spreadSq = spread * spread;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let totalWeight = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const anchor of colors) {
        const dx = x - anchor.x;
        const dy = y - anchor.y;
        const weight = Math.exp(-(dx * dx + dy * dy) / spreadSq);
        r += anchor.color.r * weight;
        g += anchor.color.g * weight;
        b += anchor.color.b * weight;
        a += anchor.color.a * 255 * weight;
        totalWeight += weight;
      }
      samples[y * width + x] = totalWeight === 0
        ? { r: 0, g: 0, b: 0, a: 0 }
        : { r: Math.round(r / totalWeight), g: Math.round(g / totalWeight), b: Math.round(b / totalWeight), a: Math.round(a / totalWeight) };
    }
  }
  return samples;
}
