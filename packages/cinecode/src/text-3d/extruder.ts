import earcut from "earcut";
import opentype from "opentype.js";
import type { MeshData } from "./mesh.js";

export type ChamferProfile = "linear" | "round" | "convex" | "concave";

export interface TextExtrusionOptions {
  readonly depth?: number;
  readonly bevelOffset?: number;
  readonly bevelSegments?: number;
  readonly chamferProfile?: ChamferProfile;
  readonly growth?: number;
  readonly fontPath?: string;
  readonly fontSize?: number;
}

export interface ContourPoint {
  readonly x: number;
  readonly y: number;
}

export interface GlyphRing {
  readonly points: ContourPoint[];
  readonly isHole: boolean;
}

function sampleQuadraticBezier(
  p0: ContourPoint,
  p1: ContourPoint,
  p2: ContourPoint,
  steps = 4,
): ContourPoint[] {
  const result: ContourPoint[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const inv = 1 - t;
    result.push({
      x: inv * inv * p0.x + 2 * inv * t * p1.x + t * t * p2.x,
      y: inv * inv * p0.y + 2 * inv * t * p1.y + t * t * p2.y,
    });
  }
  return result;
}

function sampleCubicBezier(
  p0: ContourPoint,
  p1: ContourPoint,
  p2: ContourPoint,
  p3: ContourPoint,
  steps = 5,
): ContourPoint[] {
  const result: ContourPoint[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const inv = 1 - t;
    result.push({
      x: inv * inv * inv * p0.x + 3 * inv * inv * t * p1.x + 3 * inv * t * t * p2.x + t * t * t * p3.x,
      y: inv * inv * inv * p0.y + 3 * inv * inv * t * p1.y + 3 * inv * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return result;
}

export function pathCommandsToRings(commands: readonly opentype.PathCommand[]): GlyphRing[] {
  const rings: GlyphRing[] = [];
  let currentRing: ContourPoint[] = [];
  let startPoint: ContourPoint = { x: 0, y: 0 };
  let currentPoint: ContourPoint = { x: 0, y: 0 };

  for (const cmd of commands) {
    if (cmd.type === "M") {
      if (currentRing.length >= 3) {
        rings.push({ points: currentRing, isHole: isClockwise(currentRing) });
      }
      currentRing = [{ x: cmd.x, y: cmd.y }];
      startPoint = { x: cmd.x, y: cmd.y };
      currentPoint = startPoint;
    } else if (cmd.type === "L") {
      currentPoint = { x: cmd.x, y: cmd.y };
      currentRing.push(currentPoint);
    } else if (cmd.type === "Q") {
      const sampled = sampleQuadraticBezier(currentPoint, { x: cmd.x1, y: cmd.y1 }, { x: cmd.x, y: cmd.y });
      currentRing.push(...sampled);
      currentPoint = { x: cmd.x, y: cmd.y };
    } else if (cmd.type === "C") {
      const sampled = sampleCubicBezier(currentPoint, { x: cmd.x1, y: cmd.y1 }, { x: cmd.x2, y: cmd.y2 }, { x: cmd.x, y: cmd.y });
      currentRing.push(...sampled);
      currentPoint = { x: cmd.x, y: cmd.y };
    } else if (cmd.type === "Z") {
      if (currentRing.length >= 3) {
        rings.push({ points: currentRing, isHole: isClockwise(currentRing) });
      }
      currentRing = [];
    }
  }

  if (currentRing.length >= 3) {
    rings.push({ points: currentRing, isHole: isClockwise(currentRing) });
  }

  return rings;
}

function isClockwise(points: readonly ContourPoint[]): boolean {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const cur = points[i]!;
    const next = points[(i + 1) % points.length]!;
    sum += (next.x - cur.x) * (next.y + cur.y);
  }
  return sum > 0;
}

export function chamferProfileOffset(t: number, profile: ChamferProfile): number {
  const clamped = Math.max(0, Math.min(1, t));
  switch (profile) {
    case "linear":
      return clamped;
    case "round":
      return Math.sin(clamped * (Math.PI / 2));
    case "convex":
      return Math.sqrt(1 - (1 - clamped) * (1 - clamped));
    case "concave":
      return 1 - Math.cos(clamped * (Math.PI / 2));
    default:
      return clamped;
  }
}

export function extrudeVectorText(
  text: string,
  options: TextExtrusionOptions = {},
): MeshGeometry {
  const depth = Math.max(0.1, (options.depth ?? 20) * (options.growth ?? 1.0));
  const bevelOffset = options.bevelOffset ?? 2;
  const bevelSegments = Math.max(1, Math.round(options.bevelSegments ?? 3));
  const profile = options.chamferProfile ?? "round";
  const fontSize = options.fontSize ?? 72;

  let rings: GlyphRing[] = [];
  if (options.fontPath) {
    try {
      const font = opentype.loadSync(options.fontPath);
      const path = font.getPath(text, 0, fontSize, fontSize);
      rings = pathCommandsToRings(path.commands);
    } catch {
      rings = [];
    }
  }

  if (rings.length === 0) {
    return createFallbackExtrusion(text, depth);
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const flatCoords: number[] = [];
  const holeIndices: number[] = [];

  for (const ring of rings) {
    if (ring.isHole && flatCoords.length > 0) {
      holeIndices.push(flatCoords.length / 2);
    }
    for (const pt of ring.points) {
      flatCoords.push(pt.x, pt.y);
    }
  }

  const triangles = earcut(flatCoords, holeIndices, 2);
  const frontVertexOffset = positions.length / 3;

  for (let i = 0; i < flatCoords.length; i += 2) {
    const x = flatCoords[i]!;
    const y = flatCoords[i + 1]!;
    positions.push(x, y, depth / 2);
    normals.push(0, 0, 1);
    uvs.push(x / 100, y / 100);
  }
  for (let t = 0; t < triangles.length; t += 3) {
    indices.push(
      frontVertexOffset + triangles[t]!,
      frontVertexOffset + triangles[t + 1]!,
      frontVertexOffset + triangles[t + 2]!,
    );
  }

  const backVertexOffset = positions.length / 3;
  for (let i = 0; i < flatCoords.length; i += 2) {
    const x = flatCoords[i]!;
    const y = flatCoords[i + 1]!;
    positions.push(x, y, -depth / 2);
    normals.push(0, 0, -1);
    uvs.push(x / 100, y / 100);
  }
  for (let t = 0; t < triangles.length; t += 3) {
    indices.push(
      backVertexOffset + triangles[t + 2]!,
      backVertexOffset + triangles[t + 1]!,
      backVertexOffset + triangles[t]!,
    );
  }

  let ringStart = 0;
  for (const ring of rings) {
    const count = ring.points.length;
    for (let i = 0; i < count; i += 1) {
      const next = (i + 1) % count;
      const p1 = ring.points[i]!;
      const p2 = ring.points[next]!;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;

      for (let s = 0; s < bevelSegments; s += 1) {
        const t1 = s / bevelSegments;
        const t2 = (s + 1) / bevelSegments;
        const z1 = depth / 2 - t1 * depth;
        const z2 = depth / 2 - t2 * depth;
        const bo1 = bevelOffset * chamferProfileOffset(t1, profile);
        const bo2 = bevelOffset * chamferProfileOffset(t2, profile);

        const vBase = positions.length / 3;
        positions.push(
          p1.x + nx * bo1, p1.y + ny * bo1, z1,
          p2.x + nx * bo1, p2.y + ny * bo1, z1,
          p1.x + nx * bo2, p1.y + ny * bo2, z2,
          p2.x + nx * bo2, p2.y + ny * bo2, z2,
        );

        normals.push(nx, ny, 0, nx, ny, 0, nx, ny, 0, nx, ny, 0);
        uvs.push(0, t1, 1, t1, 0, t2, 1, t2);

        indices.push(vBase, vBase + 1, vBase + 2, vBase + 1, vBase + 3, vBase + 2);
      }
    }
    ringStart += count;
  }

  void ringStart;
  const posArr = new Float32Array(positions);
  const normArr = new Float32Array(normals);
  const uvArr = new Float32Array(uvs);
  const idxArr = new Uint32Array(indices);
  const tanArr = new Float32Array(positions.length * 4 / 3);

  return {
    positions: posArr,
    normals: normArr,
    uvs: uvArr,
    indices: idxArr,
    tangents: tanArr,
  };
}

function createFallbackExtrusion(text: string, depth: number): MeshGeometry {
  const w = text.length * 15;
  const h = 20;
  const positions = new Float32Array([
    -w, -h, depth / 2, w, -h, depth / 2, w, h, depth / 2, -w, h, depth / 2,
    -w, -h, -depth / 2, w, -h, -depth / 2, w, h, -depth / 2, -w, h, -depth / 2,
  ]);
  const normals = new Float32Array([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
  ]);
  const uvs = new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    6, 5, 4, 7, 6, 4,
  ]);
  const tangents = new Float32Array(8 * 4);
  return { positions, normals, uvs, indices, tangents };
}

import type { MeshGeometry } from "../model-3d/primitives/mesh-builder.js";
