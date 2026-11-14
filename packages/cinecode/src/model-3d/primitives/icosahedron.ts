import { buildMesh, type MeshGeometry } from "./mesh-builder.js";

export interface IcosahedronOptions {
  readonly radius?: number;
  readonly subdivisions?: number;
}

export function createIcosahedron(options: IcosahedronOptions = {}): MeshGeometry {
  const radius = options.radius ?? 1;
  const subdivisions = Math.max(0, Math.min(5, Math.round(options.subdivisions ?? 2)));

  const t = (1.0 + Math.sqrt(5.0)) / 2.0;

  const basePositions: number[][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];

  let faces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  const vertices: number[][] = basePositions.map((p) => {
    const len = Math.hypot(p[0]!, p[1]!, p[2]!) || 1;
    return [p[0]! / len, p[1]! / len, p[2]! / len];
  });

  const midpointCache = new Map<string, number>();

  function getMidpoint(p1: number, p2: number): number {
    const key = p1 < p2 ? `${p1}_${p2}` : `${p2}_${p1}`;
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;

    const v1 = vertices[p1]!;
    const v2 = vertices[p2]!;
    const mx = (v1[0]! + v2[0]!) / 2;
    const my = (v1[1]! + v2[1]!) / 2;
    const mz = (v1[2]! + v2[2]!) / 2;
    const len = Math.hypot(mx, my, mz) || 1;
    const index = vertices.length;
    vertices.push([mx / len, my / len, mz / len]);
    midpointCache.set(key, index);
    return index;
  }

  for (let s = 0; s < subdivisions; s += 1) {
    const nextFaces: [number, number, number][] = [];
    for (const [v1, v2, v3] of faces) {
      const a = getMidpoint(v1, v2);
      const b = getMidpoint(v2, v3);
      const c = getMidpoint(v3, v1);
      nextFaces.push([v1, a, c], [v2, b, a], [v3, c, b], [a, b, c]);
    }
    faces = nextFaces;
  }

  const positions = new Float32Array(vertices.length * 3);
  const normals = new Float32Array(vertices.length * 3);
  const uvs = new Float32Array(vertices.length * 2);

  for (let i = 0; i < vertices.length; i += 1) {
    const v = vertices[i]!;
    positions[i * 3] = v[0]! * radius;
    positions[i * 3 + 1] = v[1]! * radius;
    positions[i * 3 + 2] = v[2]! * radius;
    normals[i * 3] = v[0]!;
    normals[i * 3 + 1] = v[1]!;
    normals[i * 3 + 2] = v[2]!;

    const u = Math.atan2(v[2]!, v[0]!) / (Math.PI * 2) + 0.5;
    const phi = Math.asin(Math.max(-1, Math.min(1, v[1]!)));
    const vCoord = phi / Math.PI + 0.5;
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = vCoord;
  }

  const indices = new Uint32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i += 1) {
    indices[i * 3] = faces[i]![0];
    indices[i * 3 + 1] = faces[i]![1];
    indices[i * 3 + 2] = faces[i]![2];
  }

  return buildMesh(positions, normals, uvs, indices);
}
