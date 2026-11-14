import { buildMesh, type MeshGeometry } from "./mesh-builder.js";

export interface MobiusStripOptions {
  readonly radius?: number;
  readonly width?: number;
  readonly twists?: number;
  readonly uSegments?: number;
  readonly vSegments?: number;
}

export function createMobiusStrip(options: MobiusStripOptions = {}): MeshGeometry {
  const radius = options.radius ?? 1;
  const width = options.width ?? 0.4;
  const twists = options.twists ?? 1;
  const uSegments = Math.max(8, Math.round(options.uSegments ?? 64));
  const vSegments = Math.max(1, Math.round(options.vSegments ?? 8));

  const vertexCount = (uSegments + 1) * (vSegments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(uSegments * vSegments * 6);

  let vertexIndex = 0;
  for (let ui = 0; ui <= uSegments; ui += 1) {
    const uNorm = ui / uSegments;
    const u = uNorm * Math.PI * 2;
    const halfTwistAngle = (twists * u) / 2;
    const cosHalf = Math.cos(halfTwistAngle);
    const sinHalf = Math.sin(halfTwistAngle);
    const cosU = Math.cos(u);
    const sinU = Math.sin(u);

    for (let vi = 0; vi <= vSegments; vi += 1) {
      const vNorm = vi / vSegments;
      const v = (vNorm - 0.5) * width;

      const r = radius + v * cosHalf;
      const x = r * cosU;
      const y = v * sinHalf;
      const z = r * sinU;

      positions[vertexIndex * 3] = x;
      positions[vertexIndex * 3 + 1] = y;
      positions[vertexIndex * 3 + 2] = z;

      const duX = -radius * sinU - v * cosHalf * sinU - 0.5 * twists * v * sinHalf * cosU;
      const duY = 0.5 * twists * v * cosHalf;
      const duZ = radius * cosU + v * cosHalf * cosU - 0.5 * twists * v * sinHalf * sinU;

      const dvX = cosHalf * cosU;
      const dvY = sinHalf;
      const dvZ = cosHalf * sinU;

      const nx = duY * dvZ - duZ * dvY;
      const ny = duZ * dvX - duX * dvZ;
      const nz = duX * dvY - duY * dvX;
      const nLen = Math.hypot(nx, ny, nz) || 1;

      normals[vertexIndex * 3] = nx / nLen;
      normals[vertexIndex * 3 + 1] = ny / nLen;
      normals[vertexIndex * 3 + 2] = nz / nLen;

      uvs[vertexIndex * 2] = uNorm;
      uvs[vertexIndex * 2 + 1] = vNorm;

      vertexIndex += 1;
    }
  }

  let indexOffset = 0;
  for (let u = 0; u < uSegments; u += 1) {
    for (let v = 0; v < vSegments; v += 1) {
      const a = (vSegments + 1) * u + v;
      const b = (vSegments + 1) * (u + 1) + v;
      const c = (vSegments + 1) * (u + 1) + v + 1;
      const d = (vSegments + 1) * u + v + 1;

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
