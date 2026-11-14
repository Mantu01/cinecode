export interface MeshGeometry {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly tangents: Float32Array;
}

export function computeTangents(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  indices: Uint32Array,
): Float32Array {
  const vertexCount = positions.length / 3;
  const tan1 = new Float32Array(vertexCount * 3);
  const tan2 = new Float32Array(vertexCount * 3);
  const tangents = new Float32Array(vertexCount * 4);

  for (let i = 0; i < indices.length; i += 3) {
    const i1 = indices[i]!;
    const i2 = indices[i + 1]!;
    const i3 = indices[i + 2]!;

    const v1x = positions[i1 * 3]!, v1y = positions[i1 * 3 + 1]!, v1z = positions[i1 * 3 + 2]!;
    const v2x = positions[i2 * 3]!, v2y = positions[i2 * 3 + 1]!, v2z = positions[i2 * 3 + 2]!;
    const v3x = positions[i3 * 3]!, v3y = positions[i3 * 3 + 1]!, v3z = positions[i3 * 3 + 2]!;

    const w1u = uvs[i1 * 2]!, w1v = uvs[i1 * 2 + 1]!;
    const w2u = uvs[i2 * 2]!, w2v = uvs[i2 * 2 + 1]!;
    const w3u = uvs[i3 * 2]!, w3v = uvs[i3 * 2 + 1]!;

    const x1 = v2x - v1x, x2 = v3x - v1x;
    const y1 = v2y - v1y, y2 = v3y - v1y;
    const z1 = v2z - v1z, z2 = v3z - v1z;

    const s1 = w2u - w1u, s2 = w3u - w1u;
    const t1 = w2v - w1v, t2 = w3v - w1v;

    const r = 1.0 / (s1 * t2 - s2 * t1 || 1e-6);
    const sdirX = (t2 * x1 - t1 * x2) * r;
    const sdirY = (t2 * y1 - t1 * y2) * r;
    const sdirZ = (t2 * z1 - t1 * z2) * r;

    const tdirX = (s1 * x2 - s2 * x1) * r;
    const tdirY = (s1 * y2 - s2 * y1) * r;
    const tdirZ = (s1 * z2 - s2 * z1) * r;

    tan1[i1 * 3] = (tan1[i1 * 3] ?? 0) + sdirX;
    tan1[i1 * 3 + 1] = (tan1[i1 * 3 + 1] ?? 0) + sdirY;
    tan1[i1 * 3 + 2] = (tan1[i1 * 3 + 2] ?? 0) + sdirZ;

    tan1[i2 * 3] = (tan1[i2 * 3] ?? 0) + sdirX;
    tan1[i2 * 3 + 1] = (tan1[i2 * 3 + 1] ?? 0) + sdirY;
    tan1[i2 * 3 + 2] = (tan1[i2 * 3 + 2] ?? 0) + sdirZ;

    tan1[i3 * 3] = (tan1[i3 * 3] ?? 0) + sdirX;
    tan1[i3 * 3 + 1] = (tan1[i3 * 3 + 1] ?? 0) + sdirY;
    tan1[i3 * 3 + 2] = (tan1[i3 * 3 + 2] ?? 0) + sdirZ;

    tan2[i1 * 3] = (tan2[i1 * 3] ?? 0) + tdirX;
    tan2[i1 * 3 + 1] = (tan2[i1 * 3 + 1] ?? 0) + tdirY;
    tan2[i1 * 3 + 2] = (tan2[i1 * 3 + 2] ?? 0) + tdirZ;

    tan2[i2 * 3] = (tan2[i2 * 3] ?? 0) + tdirX;
    tan2[i2 * 3 + 1] = (tan2[i2 * 3 + 1] ?? 0) + tdirY;
    tan2[i2 * 3 + 2] = (tan2[i2 * 3 + 2] ?? 0) + tdirZ;

    tan2[i3 * 3] = (tan2[i3 * 3] ?? 0) + tdirX;
    tan2[i3 * 3 + 1] = (tan2[i3 * 3 + 1] ?? 0) + tdirY;
    tan2[i3 * 3 + 2] = (tan2[i3 * 3 + 2] ?? 0) + tdirZ;
  }

  for (let a = 0; a < vertexCount; a += 1) {
    const nx = normals[a * 3]!, ny = normals[a * 3 + 1]!, nz = normals[a * 3 + 2]!;
    const tx = tan1[a * 3]!, ty = tan1[a * 3 + 1]!, tz = tan1[a * 3 + 2]!;

    const dotNT = nx * tx + ny * ty + nz * tz;
    let ox = tx - nx * dotNT;
    let oy = ty - ny * dotNT;
    let oz = tz - nz * dotNT;
    const len = Math.hypot(ox, oy, oz) || 1;
    ox /= len; oy /= len; oz /= len;

    const cx = ny * tz - nz * ty;
    const cy = nz * tx - nx * tz;
    const cz = nx * ty - ny * tx;
    const dotC = cx * tan2[a * 3]! + cy * tan2[a * 3 + 1]! + cz * tan2[a * 3 + 2]!;
    const w = dotC < 0 ? -1.0 : 1.0;

    tangents[a * 4] = ox;
    tangents[a * 4 + 1] = oy;
    tangents[a * 4 + 2] = oz;
    tangents[a * 4 + 3] = w;
  }

  return tangents;
}

export function buildMesh(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  indices: Uint32Array,
): MeshGeometry {
  const tangents = computeTangents(positions, normals, uvs, indices);
  return { positions, normals, uvs, indices, tangents };
}
