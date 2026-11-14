import { buildMesh, type MeshGeometry } from "./mesh-builder.js";

export interface TorusKnotOptions {
  readonly radius?: number;
  readonly tube?: number;
  readonly tubularSegments?: number;
  readonly radialSegments?: number;
  readonly p?: number;
  readonly q?: number;
}

export function createTorusKnot(options: TorusKnotOptions = {}): MeshGeometry {
  const radius = options.radius ?? 1;
  const tube = options.tube ?? 0.3;
  const tubularSegments = Math.max(3, Math.round(options.tubularSegments ?? 64));
  const radialSegments = Math.max(3, Math.round(options.radialSegments ?? 16));
  const p = Math.round(options.p ?? 2);
  const q = Math.round(options.q ?? 3);

  const vertexCount = (tubularSegments + 1) * (radialSegments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(tubularSegments * radialSegments * 6);

  const calculatePosition = (u: number): [number, number, number] => {
    const phi = u * p * Math.PI * 2;
    const r0 = 0.5 * (2 + Math.sin(q * (u * Math.PI * 2)));
    const x = radius * r0 * Math.cos(phi);
    const y = radius * r0 * Math.sin(phi);
    const z = radius * Math.cos(q * (u * Math.PI * 2));
    return [x, y, z];
  };

  let vertexIndex = 0;
  for (let i = 0; i <= tubularSegments; i += 1) {
    const u = i / tubularSegments;
    const p1 = calculatePosition(u);
    const p2 = calculatePosition(u + 0.001);

    const tx = p2[0] - p1[0];
    const ty = p2[1] - p1[1];
    const tz = p2[2] - p1[2];
    const tLen = Math.hypot(tx, ty, tz) || 1;
    const T: [number, number, number] = [tx / tLen, ty / tLen, tz / tLen];

    let B: [number, number, number] = [-T[1], T[0], 0];
    const bLen = Math.hypot(B[0], B[1], B[2]);
    if (bLen < 1e-4) B = [0, -T[2], T[1]];
    const bNorm = Math.hypot(B[0], B[1], B[2]) || 1;
    B = [B[0] / bNorm, B[1] / bNorm, B[2] / bNorm];

    const N: [number, number, number] = [
      T[1] * B[2] - T[2] * B[1],
      T[2] * B[0] - T[0] * B[2],
      T[0] * B[1] - T[1] * B[0],
    ];

    for (let j = 0; j <= radialSegments; j += 1) {
      const v = j / radialSegments;
      const angle = v * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      const normX = cosA * N[0] + sinA * B[0];
      const normY = cosA * N[1] + sinA * B[1];
      const normZ = cosA * N[2] + sinA * B[2];

      const posX = p1[0] + tube * normX;
      const posY = p1[1] + tube * normY;
      const posZ = p1[2] + tube * normZ;

      positions[vertexIndex * 3] = posX;
      positions[vertexIndex * 3 + 1] = posY;
      positions[vertexIndex * 3 + 2] = posZ;

      normals[vertexIndex * 3] = normX;
      normals[vertexIndex * 3 + 1] = normY;
      normals[vertexIndex * 3 + 2] = normZ;

      uvs[vertexIndex * 2] = u;
      uvs[vertexIndex * 2 + 1] = v;

      vertexIndex += 1;
    }
  }

  let indexOffset = 0;
  for (let j = 0; j < tubularSegments; j += 1) {
    for (let i = 0; i < radialSegments; i += 1) {
      const a = (radialSegments + 1) * j + i;
      const b = (radialSegments + 1) * (j + 1) + i;
      const c = (radialSegments + 1) * (j + 1) + i + 1;
      const d = (radialSegments + 1) * j + i + 1;

      indices[indexOffset] = a;
      indices[indexOffset + 1] = b;
      indices[indexOffset + 2] = d;
      indices[indexOffset + 3] = b;
      indices[indexOffset + 4] = c;
      indices[indexOffset + 5] = d;
      indexOffset += 6;
    }
  }

  return buildMesh(positions, normals, uvs, indices);
}
