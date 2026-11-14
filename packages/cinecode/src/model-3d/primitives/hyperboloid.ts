import { buildMesh, type MeshGeometry } from "./mesh-builder.js";

export interface HyperboloidOptions {
  readonly waistRadius?: number;
  readonly height?: number;
  readonly radialSegments?: number;
  readonly heightSegments?: number;
  readonly flare?: number;
  readonly sheets?: 1 | 2;
}

export function createHyperboloid(options: HyperboloidOptions = {}): MeshGeometry {
  const waist = options.waistRadius ?? 0.5;
  const height = options.height ?? 2;
  const flare = options.flare ?? 1.2;
  const radialSegments = Math.max(3, Math.round(options.radialSegments ?? 32));
  const heightSegments = Math.max(2, Math.round(options.heightSegments ?? 20));

  const vertexCount = (heightSegments + 1) * (radialSegments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(heightSegments * radialSegments * 6);

  let vertexIndex = 0;
  for (let yIndex = 0; yIndex <= heightSegments; yIndex += 1) {
    const v = yIndex / heightSegments;
    const y = (v - 0.5) * height;
    const normalizedY = (y / (height / 2));
    const radiusAtY = waist * Math.sqrt(1 + flare * normalizedY * normalizedY);

    for (let xIndex = 0; xIndex <= radialSegments; xIndex += 1) {
      const u = xIndex / radialSegments;
      const angle = u * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      const x = radiusAtY * cosA;
      const z = radiusAtY * sinA;

      positions[vertexIndex * 3] = x;
      positions[vertexIndex * 3 + 1] = y;
      positions[vertexIndex * 3 + 2] = z;

      const drDy = (waist * flare * normalizedY) / (Math.sqrt(1 + flare * normalizedY * normalizedY) * (height / 2));
      const nx = cosA;
      const ny = -drDy;
      const nz = sinA;
      const nLen = Math.hypot(nx, ny, nz) || 1;

      normals[vertexIndex * 3] = nx / nLen;
      normals[vertexIndex * 3 + 1] = ny / nLen;
      normals[vertexIndex * 3 + 2] = nz / nLen;

      uvs[vertexIndex * 2] = u;
      uvs[vertexIndex * 2 + 1] = v;

      vertexIndex += 1;
    }
  }

  let indexOffset = 0;
  for (let y = 0; y < heightSegments; y += 1) {
    for (let x = 0; x < radialSegments; x += 1) {
      const a = (radialSegments + 1) * y + x;
      const b = (radialSegments + 1) * (y + 1) + x;
      const c = (radialSegments + 1) * (y + 1) + x + 1;
      const d = (radialSegments + 1) * y + x + 1;

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
