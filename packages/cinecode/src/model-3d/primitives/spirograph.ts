import { buildMesh, type MeshGeometry } from "./mesh-builder.js";

export interface SpirographOptions {
  readonly fixedRadius?: number;
  readonly movingRadius?: number;
  readonly distance?: number;
  readonly loops?: number;
  readonly ribbonWidth?: number;
  readonly zAmplitude?: number;
  readonly zFrequency?: number;
  readonly steps?: number;
}

export function createSpirograph(options: SpirographOptions = {}): MeshGeometry {
  const R = options.fixedRadius ?? 2.0;
  const r = options.movingRadius ?? 0.6;
  const d = options.distance ?? 0.8;
  const loops = options.loops ?? 5;
  const width = options.ribbonWidth ?? 0.15;
  const zAmp = options.zAmplitude ?? 0.5;
  const zFreq = options.zFrequency ?? 3;
  const steps = Math.max(32, Math.round(options.steps ?? 256));

  const vertexCount = (steps + 1) * 2;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(steps * 6);

  const calculatePoint = (theta: number): [number, number, number] => {
    const k = (R - r) / r;
    const x = (R - r) * Math.cos(theta) + d * Math.cos(k * theta);
    const y = (R - r) * Math.sin(theta) - d * Math.sin(k * theta);
    const z = zAmp * Math.sin(zFreq * theta);
    return [x, y, z];
  };

  const totalAngle = loops * Math.PI * 2;

  let vertexIndex = 0;
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    const theta = u * totalAngle;
    const p1 = calculatePoint(theta);
    const p2 = calculatePoint(theta + 0.001);

    const tx = p2[0] - p1[0];
    const ty = p2[1] - p1[1];
    const tz = p2[2] - p1[2];
    const tLen = Math.hypot(tx, ty, tz) || 1;
    const T: [number, number, number] = [tx / tLen, ty / tLen, tz / tLen];

    const up: [number, number, number] = [0, 0, 1];
    let B: [number, number, number] = [
      T[1] * up[2] - T[2] * up[1],
      T[2] * up[0] - T[0] * up[2],
      T[0] * up[1] - T[1] * up[0],
    ];
    const bLen = Math.hypot(B[0], B[1], B[2]);
    if (bLen < 1e-4) B = [1, 0, 0];
    const bNorm = Math.hypot(B[0], B[1], B[2]) || 1;
    B = [B[0] / bNorm, B[1] / bNorm, B[2] / bNorm];

    const N: [number, number, number] = [
      T[1] * B[2] - T[2] * B[1],
      T[2] * B[0] - T[0] * B[2],
      T[0] * B[1] - T[1] * B[0],
    ];

    const halfWidth = width / 2;

    positions[vertexIndex * 3] = p1[0] - B[0] * halfWidth;
    positions[vertexIndex * 3 + 1] = p1[1] - B[1] * halfWidth;
    positions[vertexIndex * 3 + 2] = p1[2] - B[2] * halfWidth;
    normals[vertexIndex * 3] = N[0];
    normals[vertexIndex * 3 + 1] = N[1];
    normals[vertexIndex * 3 + 2] = N[2];
    uvs[vertexIndex * 2] = u;
    uvs[vertexIndex * 2 + 1] = 0;
    vertexIndex += 1;

    positions[vertexIndex * 3] = p1[0] + B[0] * halfWidth;
    positions[vertexIndex * 3 + 1] = p1[1] + B[1] * halfWidth;
    positions[vertexIndex * 3 + 2] = p1[2] + B[2] * halfWidth;
    normals[vertexIndex * 3] = N[0];
    normals[vertexIndex * 3 + 1] = N[1];
    normals[vertexIndex * 3 + 2] = N[2];
    uvs[vertexIndex * 2] = u;
    uvs[vertexIndex * 2 + 1] = 1;
    vertexIndex += 1;
  }

  let indexOffset = 0;
  for (let i = 0; i < steps; i += 1) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;

    indices[indexOffset] = a;
    indices[indexOffset + 1] = c;
    indices[indexOffset + 2] = b;
    indices[indexOffset + 3] = b;
    indices[indexOffset + 4] = c;
    indices[indexOffset + 5] = d;
    indexOffset += 6;
  }

  return buildMesh(positions, normals, uvs, indices);
}
