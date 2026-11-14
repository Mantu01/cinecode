import { buildMesh, type MeshGeometry } from "./mesh-builder.js";

export interface VoronoiMeshOptions {
  readonly pointCount?: number;
  readonly radius?: number;
  readonly seed?: number;
  readonly relaxation?: number;
}

function lcgRandom(seed: { value: number }): number {
  seed.value = (seed.value * 1664525 + 1013904223) >>> 0;
  return seed.value / 4294967296;
}

export function createVoronoiMesh(options: VoronoiMeshOptions = {}): MeshGeometry {
  const count = Math.max(8, Math.min(64, Math.round(options.pointCount ?? 24)));
  const radius = options.radius ?? 1;
  const seed = { value: options.seed ?? 42 };

  const points: [number, number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const phi = lcgRandom(seed) * Math.PI * 2;
    const costheta = lcgRandom(seed) * 2 - 1;
    const theta = Math.acos(costheta);
    const r = radius * (0.3 + 0.7 * Math.cbrt(lcgRandom(seed)));
    points.push([
      r * Math.sin(theta) * Math.cos(phi),
      r * Math.sin(theta) * Math.sin(phi),
      r * Math.cos(theta),
    ]);
  }

  const positionsList: number[] = [];
  const normalsList: number[] = [];
  const uvsList: number[] = [];
  const indicesList: number[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const center = points[i]!;
    const neighbors = points
      .map((p, idx) => ({ p, idx, dist: Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]) }))
      .filter((item) => item.idx !== i)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5);

    const cellRadius = neighbors[0]?.dist ? neighbors[0].dist * 0.45 : radius * 0.2;
    const segments = 6;
    const startIndex = positionsList.length / 3;

    positionsList.push(center[0], center[1], center[2]);
    const cNorm = Math.hypot(center[0], center[1], center[2]) || 1;
    normalsList.push(center[0] / cNorm, center[1] / cNorm, center[2] / cNorm);
    uvsList.push(0.5, 0.5);

    for (let s = 0; s < segments; s += 1) {
      const angle = (s / segments) * Math.PI * 2;
      const px = center[0] + cellRadius * Math.cos(angle);
      const py = center[1] + cellRadius * Math.sin(angle);
      const pz = center[2] + cellRadius * 0.3 * Math.sin(angle * 2);

      positionsList.push(px, py, pz);
      const pNorm = Math.hypot(px, py, pz) || 1;
      normalsList.push(px / pNorm, py / pNorm, pz / pNorm);
      uvsList.push((Math.cos(angle) + 1) / 2, (Math.sin(angle) + 1) / 2);

      const nextS = (s + 1) % segments;
      indicesList.push(startIndex, startIndex + 1 + s, startIndex + 1 + nextS);
    }
  }

  return buildMesh(
    new Float32Array(positionsList),
    new Float32Array(normalsList),
    new Float32Array(uvsList),
    new Uint32Array(indicesList),
  );
}
